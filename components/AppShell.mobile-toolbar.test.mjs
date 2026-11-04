import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const mobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

test("keeps action pills inline in medium mobile toolbars", () => {
  assert.match(mobileHookSource, /NARROW_MOBILE_QUERY = "\(max-width: 480px\)"/);
  assert.match(source, /const isNarrowMobile = useIsNarrowMobile\(\);/);
  // The toolbar row renders the same pills on every width; a narrow phone's
  // branch/history segments live in its ⋯ menu instead of the capsule.
  assert.match(source, /\{renderAgentsButton\(true\)\}/);
  assert.match(source, /\{renderToolbarBGroup\(true\)\}/);
  assert.match(source, /\{\(!mobile \|\| !isNarrowMobile\) && sessionHasBranches && \(/);
  assert.match(source, /\{\(!mobile \|\| !isNarrowMobile\) && \(\n        <button/);
  assert.match(source, /data-mobile-toolbar-more="true"/);
});

test("uses a compact mobile toolbar row with a Radix overflow menu", () => {
  // The row is a column item of the title row's wrapper (items-stretch), so
  // it takes the free width and may shrink (min-w-0), and wraps under the
  // title row on a phone.
  assert.match(source, /data-mobile-toolbar="true"\s+className="flex h-10 min-w-0 flex-wrap items-center gap-1\.5 pb-1"/);
  // The menu is Radix-controlled and end-aligned to its ⋯ trigger; the old
  // slide-in layer is gone.
  assert.doesNotMatch(source, /position: "absolute",\s*top: 0,\s*right: 0,\s*bottom: 0/);
  assert.match(source, /<DropdownMenu open=\{mobileToolbarMoreOpen\} onOpenChange=\{handleMobileToolbarMoreOpenChange\}>/);
  assert.match(source, /align="end"\s+id="mobile-toolbar-actions"/);
  assert.match(source, /data-mobile-toolbar-actions="true"/);

  for (const action of ["history", "name", "agents", "branches", "system", "tools", "debug"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
});

test("only renders the Agents switcher when the active session family has subagents", () => {
  assert.match(source, /const agentsBadge = activeSessionFamily \? getAgentsBadge\(activeSessionFamily\.subagents, runningSessionIds\) : null;/);
  // Upstream v0.14.2: on a narrow phone the Agents pill leaves the More menu, so it
  // passes mobile && !isNarrowMobile and keeps that menu's state untouched.
  assert.match(
    source,
    /onOpenChange=\{\(\) => toggleTopPanel\("agents", mobile && !isNarrowMobile\)\}\s*>\s*<PopoverTrigger asChild>\s*<button\s+type="button"\s+disabled=\{!activeSessionFamily\}/,
  );
  // The panel itself renders only while the family and the selected session exist.
  assert.match(source, /\{activeSessionFamily && selectedSession && \(\n            <AgentSessionPanel/);
});

test("keeps the Agents panel open while switching sessions and bounds it to the bar's width budget", () => {
  assert.match(source, /const AGENT_PANEL_WIDTH = 420/);
  // The Popover is driven by the single active-panel state; its transparent
  // content carries the panel at the AGENT_PANEL_WIDTH budget.
  assert.match(source, /open=\{activeTopPanel === "agents" && Boolean\(activeSessionFamily\)\}/);
  assert.match(source, /w-\[var\(--agent-panel-width\)\] max-w-\[calc\(100vw-1\.5rem\)\]/);
  assert.match(source, /"\-\-agent-panel-width": `\$\{AGENT_PANEL_WIDTH\}px`/);
  assert.match(source, /<AgentSessionPanel[\s\S]*?onSelectSession=\{handleSelectSession\}/);
});

test("only renders branch toolbar controls for sessions with branches", () => {
  assert.match(source, /const sessionHasBranches = hasSessionBranches\(branchTree\)/);
  assert.match(source, /\{sessionHasBranches && \(\n            <BranchNavigator/);
  assert.match(source, /panel === "branches" \? null : panel/);
  assert.match(source, /hideInlineButton/);
});

test("the ⋯ menu is Radix-controlled: outside clicks and Escape close it", () => {
  // The old document-level capture listeners are gone; Radix owns dismissal.
  assert.doesNotMatch(source, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.doesNotMatch(source, /event\.key !== "Escape"[\s\S]*?setMobileToolbarMoreOpen\(false\)/);
  // Opening folds the drawer on a phone and closes any top panel; closing is
  // a plain state write.
  assert.match(source, /const handleMobileToolbarMoreOpenChange = useCallback\(\(open: boolean\) => \{\s*if \(isMobile && open\) setSidebarOpen\(false\);\s*if \(open\) setActiveTopPanel\(null\);\s*setMobileToolbarMoreOpen\(open\);/);
  // Layout and session changes still close it.
  assert.match(source, /\}, \[isMobile, isNarrowMobile, selectedSession\?\.id, newSessionDraftId\]\);/);
});

test("keeps the naming menu open while the title generates", () => {
  // The generate-title item cancels its select so Radix leaves the menu open
  // and the status (generating / updated / failed) stays visible.
  const nameItem = source.match(/<DropdownMenuItem\s*\/\/ Generating keeps its feedback visible in the menu[\s\S]*?data-mobile-toolbar-action=\{mobile \? "name" : undefined\}/)?.[0];
  assert.ok(nameItem);
  assert.match(nameItem, /event\.preventDefault\(\);\s*void handleAutoName\(\);/);
  assert.doesNotMatch(nameItem, /setMobileToolbarMoreOpen\(false\)/);
  assert.match(source, /toggleTopPanel\("branches", true\)/);
  assert.match(source, /handleSystemInfoToggle\("system"\)/);
  assert.match(source, /handleSystemInfoToggle\("tools"\)/);
  assert.match(source, /onClick=\{\(\) => toggleTopPanel\("session"\)\}/);
});

test("keeps language out of the chat toolbar; the theme pill writes the shared preference", () => {
  assert.doesNotMatch(source, /renderLanguageButton/);
  assert.doesNotMatch(source, /toggleTopPanel\("language"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "language"/);
  assert.match(source, /import \{ useTheme \} from "@\/hooks\/useTheme"/);
  assert.match(source, /setThemePreference\(theme === "dark" \? "light" : "dark"\)/);
  assert.match(source, /title=\{translate\("settings\.appearance"\)\}/);
});

test("mobile statistics collapse to a context+cost chip with the rest in the popover", () => {
  // Fixed-content chip: no container-query tiers to reflow segments by width.
  assert.doesNotMatch(source, /@container \(max-width: 220px\)/);
  assert.doesNotMatch(source, /@container \(max-width: 158px\)/);
  assert.doesNotMatch(source, /@container \(max-width: 88px\)/);
  assert.match(source, /<span className="opacity-75">ctx<\/span> \{contextUsage\.percent\.toFixed\(1\)\}%/);
  assert.match(source, /cost >= 0\.01 \? `\$\$\{cost\.toFixed\(2\)\}`/);
  // Hover paint stays off touch devices: the hover: variant is media-gated
  // (@media (hover: hover)) now that the canHover JS guards went with the
  // inline styles; enabled: keeps disabled controls unlit.
  assert.match(source, /enabled:hover:(?:bg-secondary|bg-accent|text-foreground)/);
});

test("places trust warnings below the mobile toolbar and the file toggle in toolbar flow", () => {
  assert.match(source, /\{isMobile && renderProjectTrustWarning\(true\)\}/);
  assert.match(source, /data-mobile-trust-banner=\{mobileBanner \? "true" : undefined\}/);
  assert.match(source, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
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
