import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const tabBarSource = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("the Git tab is opened from the sidebar and removed by its close button", () => {
  assert.match(appShellSource, /const GIT_TAB_ID = "git";/);
  assert.match(appShellSource, /const GIT_PANEL_TAB: Tab = \{ id: GIT_TAB_ID, label: "", filePath: "", kind: "git" \};/);
  // The tab only exists in the bar while open; × removes it instead of deactivating it.
  assert.match(appShellSource, /const \[gitPanelOpen, setGitPanelOpen\] = useState\(false\);/);
  assert.match(appShellSource, /const panelTabs: Tab\[\] = \[\.\.\.\(gitPanelOpen \? \[GIT_PANEL_TAB\] : \[\]\), \.\.\.fileTabs/);
  assert.match(appShellSource, /if \(tabId === GIT_TAB_ID\) \{\s*setGitPanelOpen\(false\);\s*setActiveFileTabId\(\(current\) => current === GIT_TAB_ID \? null : current\);\s*if \(!fileTabs\.length && !terminalTabs\.length\) setRightPanelOpen\(false\);\s*return;\s*\}/);
  // A page refresh with the Git tab active restores it (sessionStorage activeId).
  assert.match(appShellSource, /if \(saved\.activeId === GIT_TAB_ID\) setGitPanelOpen\(true\);/);
});

test("the Git tab renders GitPanel and file tabs keep rendering FileViewer", () => {
  assert.match(appShellSource, /\{activeFileTabId === GIT_TAB_ID \? \(\s*<GitPanel cwd=\{selectedSession\?\.cwd \?\? newSessionCwd \?\? null\} fullWidth=\{rightPanelFullWidth\} \/>/);
  assert.match(appShellSource, /\) : activeFileTab\?\.filePath \? \(\s*<FileViewer/);
});

test("the explorer header button opens the right panel on the Git tab", () => {
  assert.match(appShellSource, /const handleOpenGitPanel = useCallback\(\(\) => \{\s*setGitPanelOpen\(true\);\s*setActiveFileTabId\(GIT_TAB_ID\);\s*setRightPanelOpen\(true\);/);
  assert.match(appShellSource, /onOpenGitPanel=\{handleOpenGitPanel\}/);
  assert.match(sidebarSource, /onOpenGitPanel\?: \(\) => void;/);
  assert.match(sidebarSource, /\{onOpenGitPanel && \(\s*<ToolbarIconButton\s*onClick=\{onOpenGitPanel\}/);
});

test("the tab bar renders the Git tab with a localized title and a close button", () => {
  assert.match(tabBarSource, /kind\?: "terminal" \| "git";/);
  assert.match(tabBarSource, /tab\.kind === "git" \? \(\s*<svg[\s\S]*?<circle cx="18" cy="6" r="3" \/>/);
  assert.match(tabBarSource, /\{tab\.kind === "git" \? t\("gitPanel\.title"\) : tab\.label\}/);
  // No git close-button guard: every tab (including Git) shows the close button.
  assert.doesNotMatch(tabBarSource, /kind !== "git"/);
  assert.match(tabBarSource, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onCloseTab\(tab\.id\); \}\}/);
});
