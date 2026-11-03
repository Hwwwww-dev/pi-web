import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const mobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

test("keeps action icons inline in medium mobile sidebars", () => {
  assert.match(mobileHookSource, /NARROW_MOBILE_QUERY = "\(max-width: 480px\)"/);
  assert.match(source, /const isNarrowMobile = useIsNarrowMobile\(\);/);
  assert.match(source, /\{!isNarrowMobile && renderChatToolbarActions\(true, "primary"\)\}/);
  assert.match(source, /\{!isNarrowMobile && renderToolbarMoreButton\(\)\}/);
  assert.match(source, /\{isNarrowMobile && renderToolbarMoreButton\(\)\}/);
  assert.match(source, /data-mobile-toolbar-more="true"/);
});

test("uses a compact narrow-mobile toolbar with a floating action layer", () => {
  assert.match(source, /data-mobile-toolbar="true"[\s\S]*?flex: 1,[\s\S]*?minWidth: 0/);
  assert.match(
    source,
    /data-mobile-toolbar-actions="true"[\s\S]*?position: "absolute"[\s\S]*?right: 0,[\s\S]*?left: isNarrowMobile \? `calc\(2 \* \$\{TOP_BAR_ICON_BUTTON_SIZE\}\)` : 0/,
  );

  for (const action of ["history", "name", "agents", "branches", "system", "tools"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
});

test("only renders the Agents switcher when the active session family has subagents", () => {
  assert.match(source, /const agentsBadge = activeSessionFamily \? getAgentsBadge\(activeSessionFamily\.subagents, runningSessionIds\) : null;/);
  // Upstream v0.14.2: on a narrow phone the Agents button leaves the More menu, so it
  // passes mobile && !isNarrowMobile and keeps that menu's state untouched.
  assert.match(source, /onClick=\{\(\) => toggleTopPanel\("agents", mobile && !isNarrowMobile\)\}\s*disabled=\{!activeSessionFamily\}/);
  assert.match(source, /activeTopPanel === "agents" && activeSessionFamily && selectedSession/);
});

test("keeps the Agents panel open while switching sessions and positions it at the left", () => {
  assert.match(source, /const AGENT_PANEL_WIDTH = 420/);
  assert.match(
    source,
    /if \(activeTopPanel === "agents"\)[\s\S]*?left: topBarRect\.left[\s\S]*?width: Math\.min\(AGENT_PANEL_WIDTH, topBarRect\.width\)/,
  );
  assert.match(source, /<AgentSessionPanel[\s\S]*?onSelectSession=\{handleSelectSession\}/);
});

test("only renders branch toolbar controls for sessions with branches", () => {
  assert.match(source, /const sessionHasBranches = hasSessionBranches\(branchTree\)/);
  assert.match(source, /\{section === "primary" && sessionHasBranches && \(mobile \? \(/);
  assert.match(source, /\{isMobile && sessionHasBranches && \(/);
  assert.match(source, /panel === "branches" \? null : panel/);
});

test("keeps covered statistics and file controls out of interaction and focus", () => {
  assert.match(source, /const covered = mobile && mobileToolbarMoreOpen;/);
  assert.match(source, /disabled=\{!showChat \|\| covered\}[\s\S]*?tabIndex=\{covered \? -1 : undefined\}/);
  assert.match(source, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}[\s\S]*?visibility: covered \? "hidden" : "visible"/);
  assert.match(source, /aria-hidden=\{covered \? true : undefined\}/);
});

test("closes the mobile action layer on outside click, Escape, layout changes, and session changes", () => {
  assert.match(source, /event\.composedPath\(\)\.includes\(toolbar\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.match(source, /event\.key !== "Escape"[\s\S]*?setMobileToolbarMoreOpen\(false\)/);
  assert.match(source, /\}, \[isMobile, isNarrowMobile, selectedSession\?\.id, newSessionDraftId\]\);/);
});

test("keeps the mobile action layer open after using an expanded action", () => {
  const toggleTopPanel = source.match(/const toggleTopPanel = useCallback\([\s\S]*?\n  \}, \[isMobile, isNarrowMobile\]\);/)?.[0];
  const historyHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?handleViewFullHistory\(\);[\s\S]*?\n          \}\}/)?.[0];
  const autoNameHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?void handleAutoName\(\);[\s\S]*?\n              \}\}/)?.[0];

  for (const handler of [toggleTopPanel, historyHandler, autoNameHandler]) {
    assert.ok(handler);
    assert.doesNotMatch(handler, /setMobileToolbarMoreOpen\(false\)/);
    assert.match(handler, /setMobileToolbarMoreOpen\(true\)/);
  }

  assert.match(source, /toggleTopPanel\("branches", true\)/);
  assert.match(source, /handleSystemInfoToggle\("system", mobile\)/);
  assert.match(source, /handleSystemInfoToggle\("tools", mobile\)/);
  assert.match(source, /onClick=\{\(\) => toggleTopPanel\("session"\)\}/);
});

test("keeps theme and language in settings instead of the chat toolbar", () => {
  assert.doesNotMatch(source, /renderThemeButton/);
  assert.doesNotMatch(source, /renderLanguageButton/);
  assert.doesNotMatch(source, /toggleTopPanel\("language"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "theme"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "language"/);
  assert.match(source, /import \{ useTheme \} from "@\/hooks\/useTheme"/);
  assert.match(source, /useTheme\(\);/);
});

test("mobile statistics collapse to a context+cost chip with the rest in the popover", () => {
  // Fixed-content chip: no container-query tiers to reflow segments by width.
  assert.doesNotMatch(source, /@container \(max-width: 220px\)/);
  assert.doesNotMatch(source, /@container \(max-width: 158px\)/);
  assert.doesNotMatch(source, /@container \(max-width: 88px\)/);
  assert.match(source, /<span style=\{\{ opacity: 0\.75 \}\}>ctx<\/span> \{contextUsage\.percent\.toFixed\(1\)\}%/);
  assert.match(source, /cost >= 0\.01 \? `\$\$\{cost\.toFixed\(2\)\}`/);
  // Hover paint is guarded: touch devices latch synthetic mouseenter.
  assert.match(source, /if \(!canHover\(\)\) return;/);
});

test("places trust warnings below the mobile toolbar and the file toggle in toolbar flow", () => {
  assert.match(source, /\{isMobile && renderProjectTrustWarning\(true\)\}/);
  assert.match(source, /data-mobile-trust-banner=\{mobileBanner \? "true" : undefined\}/);
  assert.doesNotMatch(source, /File panel toggle — always visible at top-right/);
  assert.doesNotMatch(source, /position: "fixed", top: "env\(safe-area-inset-top\)"/);
});

test("closes top-bar dropdowns when the file panel expands to full width", () => {
  assert.match(
    source,
    /const handleRightPanelExpandToggle = useCallback\(\(\) => \{\s*setActiveTopPanel\(null\);\s*setRightPanelExpanded\(\(expanded\) => !expanded\);/,
  );
  assert.match(source, /onClick=\{handleRightPanelExpandToggle\}/);
  assert.match(source, /if \(rightPanelFullWidth\) setActiveTopPanel\(null\);/);
});

test("a sidebar pick closes the phone's drawer unless it asks to stay open (the sidebar's Fork)", () => {
  assert.match(source, /const handleSelectSession = useCallback\(\(session: SessionInfo, isRestore = false, entryId\?: string, blockIndex\?: number, options\?: SelectSessionOptions\) => \{/);
  assert.match(source, /if \(isMobile && !isRestore && !options\?\.keepSidebarOpen\) setSidebarOpen\(false\);/);
});
