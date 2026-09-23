import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const tabBarSource = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("the Git tab is a persistent, non-closable panel tab", () => {
  assert.match(appShellSource, /const GIT_TAB_ID = "git";/);
  assert.match(appShellSource, /const GIT_PANEL_TAB: Tab = \{ id: GIT_TAB_ID, label: "", filePath: "", kind: "git" \};/);
  assert.match(appShellSource, /const panelTabs: Tab\[\] = \[GIT_PANEL_TAB, \.\.\.fileTabs/);
  assert.match(appShellSource, /if \(tabId === GIT_TAB_ID\) return;/);
});

test("the Git tab renders GitPanel and file tabs keep rendering FileViewer", () => {
  assert.match(appShellSource, /\{activeFileTabId === GIT_TAB_ID \? \(\s*<GitPanel cwd=\{selectedSession\?\.cwd \?\? newSessionCwd \?\? null\} fullWidth=\{rightPanelFullWidth\} \/>/);
  assert.match(appShellSource, /\) : activeFileTab\?\.filePath \? \(\s*<FileViewer/);
});

test("the explorer header button opens the right panel on the Git tab", () => {
  assert.match(appShellSource, /const handleOpenGitPanel = useCallback\(\(\) => \{\s*setActiveFileTabId\(GIT_TAB_ID\);\s*setRightPanelOpen\(true\);/);
  assert.match(appShellSource, /onOpenGitPanel=\{handleOpenGitPanel\}/);
  assert.match(sidebarSource, /onOpenGitPanel\?: \(\) => void;/);
  assert.match(sidebarSource, /\{onOpenGitPanel && \(\s*<ToolbarIconButton\s*onClick=\{onOpenGitPanel\}/);
});

test("the tab bar renders the Git tab with a branch icon and no close button", () => {
  assert.match(tabBarSource, /kind\?: "terminal" \| "git";/);
  assert.match(tabBarSource, /tab\.kind === "git" \? \(\s*<svg[\s\S]*?<circle cx="18" cy="6" r="3" \/>/);
  assert.match(tabBarSource, /\{tab\.kind !== "git" && \(\s*<button[\s\S]*?onCloseTab\(tab\.id\);/);
});
