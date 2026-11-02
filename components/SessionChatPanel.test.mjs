import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const activityRows = await readFile(new URL("./ActivityRows.tsx", import.meta.url), "utf8");

test("AppShell hosts subagent tabs in the right panel next to file and terminal tabs", () => {
  assert.match(appShell, /const \[agentTabs, setAgentTabs\] = useState<\{ sessionId: string; label: string; side\?: boolean \}\[\]>\(\[\]\)/);
  assert.match(appShell, /const handleOpenSubagentTab = useCallback\(\(sessionId: string, label: string, side\?: boolean\) => \{/);
  assert.match(appShell, /setActiveFileTabId\(`agent:\$\{sessionId\}`\)/);
  assert.match(appShell, /kind: \(tab\.side \? "side" : "agent"\) as "agent" \| "side",/);
  // The tab's content is the shared SessionChatPanel: the full chat scoped to
  // that session, for subagents and side chats alike.
  assert.match(appShell, /<SessionChatPanel[\s\S]*?sessionId=\{activeAgentTab\.sessionId\}[\s\S]*?running=\{runningSessionIds\.has\(activeAgentTab\.sessionId\)\}/);
  // Closing the last tab of any kind folds the panel.
  assert.match(appShell, /if \(fileTabs\.length === 0 && terminalTabs\.length === 0 && remainingAgents\.length === 0\) setRightPanelOpen\(false\)/);
  // Every project switch (cwd change, session pick, new session) goes through
  // changeFileWorkspace(), which parks the file tabs and drops the agent tabs.
  assert.match(appShell, /setFileTabs\(next\.tabs\);[\s\S]{0,120}setAgentTabs\(\[\]\);/);
  assert.match(appShell, /if \(!activeFileTabId \|\| activeFileId \|\| activeFileTabId\.startsWith\("agent:"\)\) \{/);
  // The "no files open" placeholder must not show behind an active agent tab.
  assert.match(appShell, /!terminalTabs\.some\(\(tab\) => tab\.id === activeFileTabId\) && !activeAgentTab \? \(/);
});

test("closing a tab falls back without a ?? chain swallowed by a ternary", () => {
  // `a ?? b ?? c ? x : null` parses as `(a ?? b ?? c) ? x : null`: closing a
  // file tab with another one open read `.sessionId` of a missing agent tab.
  assert.doesNotMatch(appShell, /\?\? \w+\.at\(-1\) \?/);
  assert.equal((appShell.match(/lastAgentTabId\(/g) ?? []).length, 4);
});

test("the subagent card in a tool call opens the side tab with a label", () => {
  assert.match(messageView, /onOpenSubagent\?: \(sessionId: string, label: string\) => void/);
  // The card lives in the activity row (dev's rendering); it passes the tool call's label along.
  assert.match(activityRows, /onClick=\{\(\) => onOpenSubagent\(subagent\.sessionId, subagent\.description \|\| subagent\.profile\)\}/);
  assert.doesNotMatch(messageView, /onOpenSession/);
});
