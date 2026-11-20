import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const { isHiddenRelation } = await createJiti(import.meta.url).import("../lib/session-family.ts");

function callbackBody(name, endAnchor) {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(endAnchor, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `end anchor not found after ${name}`);
  return source.slice(start, end);
}

function runHandleAgentEnd({ end, selectedSession, attention, sessions = [] }) {
  const notifications = [];
  const toasts = [];
  const context = vm.createContext({
    useCallback: (callback) => callback,
    setRefreshKey: () => {},
    setExplorerRefreshKey: () => {},
    hydrateSelectedSession: () => {},
    selectedSession,
    isHiddenRelation,
    shouldShowBrowserNotification: () => attention,
    deliverSessionNotification: (notice) => notifications.push(notice),
    showSessionEventToast: (session, kind, message) => toasts.push({ session, kind, message }),
    latestSessionsRef: { current: sessions },
    translate: (key) => key,
    // 标题按事件类型来（待回答 / 任务完成 / 任务失败），VM 里给个等价的桩。
    sessionToastTitle: (kind) => `title:${kind}`,
    hiddenFinishedSessionIds: new Set(),
    setHiddenFinishedSessionIds: (updater) => {
      context.hiddenFinishedSessionIds = updater(context.hiddenFinishedSessionIds);
    },
  });
  vm.runInContext(
    stripTypeScriptTypes(`${callbackBody("handleAgentEnd", "\n  // The badge is for an unseen tab")}\nglobalThis.handleAgentEnd = handleAgentEnd;`),
    context,
  );
  context.handleAgentEnd(end);
  return { notifications, toasts, hiddenFinishedSessionIds: context.hiddenFinishedSessionIds };
}

test("a selected session that finishes while the tab is hidden badges the favicon (#1484)", () => {
  const selectedSession = { id: "open", name: "open" };
  const { notifications, hiddenFinishedSessionIds } = runHandleAgentEnd({
    end: { aborted: false },
    selectedSession,
    attention: true,
  });
  assert.equal(notifications.length, 1, "the browser Notification still fires");
  assert.deepEqual([...hiddenFinishedSessionIds], ["open"], "kept for the favicon until the tab opens");

  // The same finish while looking leaves no badge and no system notification.
  const seen = runHandleAgentEnd({ end: { aborted: false }, selectedSession, attention: false });
  assert.equal(seen.notifications.length, 0);
  assert.equal(seen.toasts.length, 0, "the watched session's own finish is no toast");
  assert.deepEqual([...seen.hiddenFinishedSessionIds], []);

  // A background session's finish while the page is on screen is the in-page
  // toast's case: clickable, carrying the jump to that session.
  const background = runHandleAgentEnd({
    end: { aborted: false, sessionId: "bg" },
    selectedSession,
    attention: false,
    sessions: [{ id: "bg", name: "bg" }],
  });
  assert.equal(background.notifications.length, 0);
  assert.equal(background.toasts.length, 1);
  assert.equal(background.toasts[0].session.id, "bg");
  assert.equal(background.toasts[0].kind, "complete");
});

test("a stopped run, an unfinished task, a subagent or a side chat never badges (#1484)", () => {
  const selectedSession = { id: "open", name: "open" };
  for (const [label, end, session] of [
    ["aborted", { aborted: true }, selectedSession],
    ["subagents active", { aborted: false, subagentsActive: true }, selectedSession],
    ["subagent session", { aborted: false }, { ...selectedSession, relation: { kind: "subagent" } }],
    ["side chat", { aborted: false }, { ...selectedSession, relation: { kind: "side", parentSessionId: "parent" } }],
  ]) {
    const { hiddenFinishedSessionIds } = runHandleAgentEnd({ end, selectedSession: session, attention: true });
    assert.deepEqual([...hiddenFinishedSessionIds], [], label);
  }
});

test("opening the tab drops the hidden finishes (#1484)", () => {
  assert.match(source, /document\.addEventListener\("visibilitychange", clearIfSeen\);/);
  assert.match(source, /window\.addEventListener\("focus", clearIfSeen\);/);
  assert.match(source, /setHiddenFinishedSessionIds\(\(prev\) => \(prev\.size === 0 \? prev : new Set\(\)\)\);/);
});
