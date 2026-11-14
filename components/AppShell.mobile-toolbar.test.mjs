import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const mobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

test("keeps action pills inline in medium mobile toolbars", () => {
  assert.match(mobileHookSource, /NARROW_MOBILE_QUERY = "\(max-width: 480px\)"/);
  assert.match(source, /const isNarrowMobile = useIsNarrowMobile\(\);/);
  // The dashboard-header rule: the row holds only the Agents pill and the file
  // toggle; branches, history, Debug and the theme flip live in the ⋯ menu on
  // every width.
  assert.match(source, /\{renderAgentsButton\(true\)\}/);
  assert.match(source, /\{renderToolbarBGroup\(true\)\}/);
  assert.doesNotMatch(source, /\{\(!mobile \|\| !isNarrowMobile\) && sessionHasBranches/);
  assert.doesNotMatch(source, /\{\(!mobile \|\| !isNarrowMobile\) && \(\n        <Tooltip>/);
  assert.match(source, /data-mobile-toolbar-more="true"/);
});

test("uses a compact mobile toolbar row with a Radix overflow menu", () => {
  // A phone's header is one row: ☰, the truncating title, then the stats and
  // the controls on the same line. The title takes the free width and yields
  // first when space runs out; the row itself may shrink (min-w-0).
  assert.match(source, /<header className="flex min-h-\(--header-height\)[\s\S]*?<div className="flex h-10 min-w-0 flex-1 items-center gap-1">/);
  assert.match(source, /<span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">/);
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
  // The Agents control opens/toggles its own top panel and leaves the ⋯ menu's
  // state alone: since the menu-driven panels defer their open past the menu's
  // unmount (openFlyoutFromMenu), no keepMobileToolbarOpen flag is needed.
  assert.match(
    source,
    /onOpenChange=\{\(\) => toggleFlyout\("agents"\)\}\s*>\s*<Tooltip>\s*<TooltipTrigger asChild>\s*<PopoverTrigger asChild>\s*<Button\s+variant="ghost"\s+size="sm"\s+disabled=\{!activeSessionFamily\}/,
  );
  const agentsButton = source.slice(
    source.indexOf("const renderAgentsButton = (mobile: boolean) => ("),
    source.indexOf("const renderToolbarBGroup = (mobile: boolean) => ("),
  );
  assert.doesNotMatch(agentsButton, /setMobileToolbarMoreOpen/);
  // The panel itself renders only while the family and the selected session exist.
  assert.match(source, /\{activeSessionFamily && selectedSession && \(\n          <AgentSessionPanel/);
});

test("keeps the Agents panel open while switching sessions and bounds it to the bar's width budget", () => {
  assert.match(source, /const AGENT_PANEL_WIDTH = 420/);
  // The Popover is driven by the single active-panel state; its transparent
  // content carries the panel at the AGENT_PANEL_WIDTH budget.
  assert.match(source, /open=\{activeFlyout === "agents" && Boolean\(activeSessionFamily\)\}/);
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
  // Opening folds the drawer on a phone; the flyout toggles live in this
  // menu (Debug/系统/工具定义), so opening must not kill the open panel —
  // otherwise a panel opened from the menu could never be closed again.
  assert.match(source, /const handleMobileToolbarMoreOpenChange = useCallback\(\(open: boolean\) => \{\s*if \(isMobile && open\) setSidebarOpen\(false\);/);
  assert.match(source, /setMobileToolbarMoreOpen\(open\);\s*\}, \[isMobile\]\);/);
  assert.doesNotMatch(source, /if \(open\) setActiveFlyout\(null\);/);
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
  // The other menu items defer their panel open past the menu's unmount, so
  // the synchronous select-close does not read as focus-outside and close the
  // panel again; the deferral replaces the retired keepMobileToolbarOpen flag.
  assert.match(source, /openFlyoutFromMenu\(\(\) => toggleFlyout\("branches"\)\)/);
  assert.match(source, /const openFlyoutFromMenu = useCallback\(\(open: \(\) => void\) => \{\s*window\.setTimeout\(open, 0\);\s*\}, \[\]\);/);
  assert.match(source, /handleSystemInfoToggle\("system"\)/);
  assert.match(source, /handleSystemInfoToggle\("tools"\)/);
  assert.match(source, /onClick=\{\(\) => toggleFlyout\("session"\)\}/);
});

test("keeps language out of the chat toolbar; the theme control writes the shared preference", () => {
  assert.doesNotMatch(source, /renderLanguageButton/);
  assert.doesNotMatch(source, /toggleFlyout\("language"/);
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
  assert.match(source, /<span className="opacity-75">ctx<\/span> \{ctxText\}/);
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
    /const handleRightPanelExpandToggle = useCallback\(\(\) => \{\s*setActiveFlyout\(null\);\s*setRightPanelExpanded\(\(expanded\) => !expanded\);/,
  );
  assert.match(source, /onClick=\{handleRightPanelExpandToggle\}/);
  assert.match(source, /if \(rightPanelFullWidth\) setActiveFlyout\(null\);/);
});

test("a sidebar pick closes the phone's drawer unless it asks to stay open (the sidebar's Fork)", () => {
  assert.match(source, /const handleSelectSession = useCallback\(\(session: SessionInfo, isRestore = false, entryId\?: string, blockIndex\?: number, options\?: SelectSessionOptions\) => \{/);
  assert.match(source, /if \(isMobile && !isRestore && !options\?\.keepSidebarOpen\) setSidebarOpen\(false\);/);
});
