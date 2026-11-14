// A run's messages keep their React keys when the session file is read again
// (#1184). The client side of each case is what useAgentSession holds during the
// run: the loaded window plus the optimistic prompt and the `message_end`
// appends, none with an entry id. The reloaded side is the real reader's output.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const { normalizeToolCalls } = await jiti.import("./normalize.ts");
const { messageRenderKeys, carryMessageKeys, streamingMessageKey, mergeLoadedTail } = await jiti.import("./message-keys.ts");

function session() {
  const entries = [];
  const add = (fields) => {
    const entry = {
      id: `e${String(entries.length).padStart(7, "0")}`,
      parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date(1_000_000 + entries.length * 1000).toISOString(),
      ...fields,
    };
    entries.push(entry);
    return entry;
  };
  const addMessage = (message) => add({ type: "message", message });
  return { entries, add, addMessage };
}

const user = (content, timestamp) => ({ role: "user", content, timestamp });
const assistant = (timestamp, content, extra = {}) => ({
  role: "assistant", content, timestamp, stopReason: "stop", provider: "p", model: "m", api: "x", usage: {}, ...extra,
});
const text = (timestamp, value, extra) => assistant(timestamp, [{ type: "text", text: value }], extra);
const toolCall = (timestamp, id) => assistant(timestamp, [
  { type: "thinking", thinking: "plan ".repeat(80) },
  { type: "toolCall", id, name: "read", arguments: { path: "a" } },
], { stopReason: "toolUse" });
const toolResult = (toolCallId, timestamp) => ({
  role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: "file" }], isError: false, timestamp,
});

// What loadSession reads (tail 50, deferred thinking and media).
const read = (entries, leafId = entries.at(-1).id) => buildSessionContext(entries, leafId, {
  deferThinking: true, deferToolResultImages: true, tail: 50, sessionId: "s",
});
const loaded = (entries) => ({ ...read(entries), aliases: new Map() });
// message_end appends normalized messages; handleSend appends the prompt as is.
const appended = (state, ...messages) => ({
  ...state, messages: [...state.messages, ...messages.map((m) => m.role === "assistant" ? normalizeToolCalls(m) : m)],
});
const reload = (state, entries, leafId) => {
  const next = read(entries, leafId);
  return { ...next, aliases: carryMessageKeys(state, next) };
};
const keysOf = (state) => messageRenderKeys(state.entryIds, state.messages.length, state.aliases);
const assertUnique = (keys) => assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);

function history() {
  const s = session();
  s.addMessage(user("earlier", 1));
  s.addMessage(text(2, "earlier answer"));
  return s;
}

test("a run's messages keep their keys when the run end reads the file", () => {
  const s = history();
  // The prompt goes out with the browser's timestamp, a custom message's entry
  // with its own: neither matches the file's, the rest is pi's message as is.
  const during = appended(
    loaded(s.entries),
    user("long ".repeat(500), 1_700_000_000_000),
    toolCall(3000, "c1"),
    toolResult("c1", 3100),
    { role: "custom", customType: "note", content: "hi", display: true, timestamp: 3150 },
    text(3200, "done"),
  );
  s.addMessage(user("long ".repeat(500), 1_700_000_000_123));
  s.addMessage(toolCall(3000, "c1"));
  s.addMessage(toolResult("c1", 3100));
  s.add({ type: "custom_message", customType: "note", content: "hi", display: true });
  s.addMessage(text(3200, "done"));
  const after = reload(during, s.entries);

  // The old rule, `entryIds[idx] ?? idx`, re-keyed the sent bubble from 2 to its id.
  const oldRule = (state) => state.messages.map((_, idx) => String(state.entryIds[idx] ?? idx));
  assert.notEqual(oldRule(during)[2], oldRule(after)[2]);

  assert.deepEqual(keysOf(after), keysOf(during));
  assert.deepEqual(keysOf(after).slice(0, 2), ["e0000000", "e0000001"]);
  assertUnique(keysOf(after));
});

test("a new session's first run keeps its keys", () => {
  const s = session();
  const during = appended({ messages: [], entryIds: [], aliases: new Map() }, user("q", 10), text(4000, "a"));
  s.add({ type: "model_change", provider: "p", modelId: "m" });
  s.addMessage(user("q", 11));
  s.addMessage(text(4000, "a"));
  assert.deepEqual(keysOf(reload(during, s.entries)), keysOf(during));
});

test("auto-retry: the reload before the retry and the one at the end keep every key", () => {
  const s = history();
  const failed = text(4000, "", { stopReason: "error", errorMessage: "429" });
  let state = appended(loaded(s.entries), user("q", 10), failed);
  const firstKeys = keysOf(state);
  s.addMessage(user("q", 11));
  const failedEntry = s.addMessage(failed);
  s.add({ type: "context_edit", targetId: failedEntry.id, replacement: null });
  state = reload(state, s.entries);
  assert.deepEqual(keysOf(state), firstKeys);

  state = appended(state, text(9000, "ok"));
  const retriedKeys = keysOf(state);
  assertUnique(retriedKeys);
  s.addMessage(text(9000, "ok"));
  state = reload(state, s.entries);
  assert.deepEqual(keysOf(state), retriedKeys);
});

test("a compaction in the middle of a run keeps the run's keys; the summary card takes its id", () => {
  const s = history();
  const during = appended(loaded(s.entries), user("q", 10), toolCall(5000, "c9"), toolResult("c9", 5001));
  const prompt = s.addMessage(user("q", 12));
  s.addMessage(toolCall(5000, "c9"));
  s.addMessage(toolResult("c9", 5001));
  const compaction = s.add({ type: "compaction", summary: "sum", firstKeptEntryId: prompt.id, tokensBefore: 1000 });
  let state = reload(during, s.entries);
  assert.deepEqual(keysOf(state), [...keysOf(during), compaction.id]);

  state = appended(state, text(6000, "after"));
  const runKeys = keysOf(state);
  s.addMessage(text(6000, "after"));
  assert.deepEqual(keysOf(reload(state, s.entries)), runKeys);
});

test("the prompt matches as pi delivered it: a skill swapped in at message_end, an image in pi's format", () => {
  const s = history();
  const skill = user("<skill name=\"x\">body</skill>\n\nargs", 20);
  const during = appended(loaded(s.entries), skill);
  s.addMessage(skill);
  assert.deepEqual(keysOf(reload(during, s.entries)), keysOf(during));

  const t = history();
  const optimistic = user([
    { type: "text", text: "see" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  ], 1);
  const withImage = appended(loaded(t.entries), optimistic);
  t.addMessage(user([{ type: "text", text: "see" }, { type: "image", data: "AAAA", mimeType: "image/png" }], 2));
  assert.deepEqual(keysOf(reload(withImage, t.entries)), keysOf(withImage));
});

test("a message the browser missed ends the carry there: the rest take their ids, never a duplicate key", () => {
  const s = history();
  const during = appended(loaded(s.entries), user("q", 10), text(7002, "done"));
  const before = keysOf(during);
  s.addMessage(user("q", 11));
  const missed = s.addMessage(toolCall(7000, "cx"));
  s.addMessage(toolResult("cx", 7001));
  const done = s.addMessage(text(7002, "done"));
  const extra = s.addMessage(text(7003, "not received yet"));
  const after = reload(during, s.entries);
  const keys = keysOf(after);
  assert.equal(keys[2], before[2]);
  assert.deepEqual([keys[3], keys[5], keys[6]], [missed.id, done.id, extra.id]);
  assertUnique(keys);
  // The extra message's late message_end appends it a second time.
  assertUnique(keysOf(appended(after, text(7003, "not received yet"))));
});

test("a run past the first page: its start leaves the window, so the keys fall back to the ids", () => {
  const s = history();
  let during = appended(loaded(s.entries), user("q", 10));
  s.addMessage(user("q", 11));
  for (let i = 0; i < 60; i++) {
    during = appended(during, toolCall(10_000 + i * 2, `t${i}`), toolResult(`t${i}`, 10_001 + i * 2));
    s.addMessage(toolCall(10_000 + i * 2, `t${i}`));
    s.addMessage(toolResult(`t${i}`, 10_001 + i * 2));
  }
  const after = reload(during, s.entries);
  assert.equal(after.entryIds.includes("e0000001"), false);
  assert.deepEqual(keysOf(after), after.entryIds);
});

test("an older page prepended leaves the live keys alone", () => {
  const s = history();
  const page = read(s.entries);
  const recent = { messages: page.messages.slice(1), entryIds: page.entryIds.slice(1), aliases: new Map() };
  const during = appended(recent, user("q", 10), text(8000, "a"));
  const prepended = {
    ...during,
    messages: [page.messages[0], ...during.messages],
    entryIds: [page.entryIds[0], ...during.entryIds],
  };
  assert.deepEqual(keysOf(prepended).slice(1), keysOf(during));
});

test("a run on another branch from the same entry takes over its places, never a key twice", () => {
  const s = history();
  const branchPoint = s.entries.at(-1).id;
  let state = appended(loaded(s.entries), user("q", 10), text(4000, "a"));
  s.addMessage(user("q", 11));
  s.addMessage(text(4000, "a"));
  state = reload(state, s.entries);
  assert.equal(state.aliases.size, 2);

  // navigate_tree back to the earlier answer drops the other branch's aliases.
  state = reload(state, s.entries, branchPoint);
  assert.equal(state.aliases.size, 0);
  state = appended(state, user("other", 20), text(5000, "b"));
  const during = keysOf(state);
  s.add({ type: "message", parentId: branchPoint, message: user("other", 21) });
  s.addMessage(text(5000, "b"));
  state = reload(state, s.entries);
  assert.deepEqual(keysOf(state), during);
  assertUnique(keysOf(state));
});

test("the streaming bubble predicts the key its own row will use, and the read keeps it", () => {
  const s = history();
  let state = appended(loaded(s.entries), user("q", 10));
  const liveCount = state.messages.length - state.entryIds.length;
  // 流式气泡不在列表里：它落进去的位置就是 messages.length，键必须与那一行逐字相同。
  const predicted = streamingMessageKey(state.entryIds, liveCount);

  state = appended(state, text(2000, "answer"));
  const landed = keysOf(state).at(-1);
  assert.equal(landed, predicted);

  // 读文件后 carryMessageKeys 把同一个键交给它的条目 id：折叠选择与实测时长靠这串键。
  s.addMessage(user("q", 11));
  s.addMessage(text(2000, "answer"));
  state = reload(state, s.entries);
  assert.equal(state.aliases.get(state.entryIds.at(-1)), predicted);
});

test("mergeLoadedTail upgrades matched tail rows once and never duplicates them", () => {
  // 回合结束的整载：本地尾部持有 message_end 追加的流式行（无 id），窗口里
  // 是同一条消息的落盘版。对上的行就地升级为持久条目，不得出现两份。
  const prevIds = ["e1", "e2"];
  const prevMessages = [
    { role: "user", content: "q", timestamp: 1 },
    text(10, "seed"),
    text(20, "streamed reply"),
  ];
  const nextIds = ["e1", "e2", "e3"];
  const nextMessages = [
    { role: "user", content: "q", timestamp: 1 },
    text(10, "seed"),
    text(20, "streamed reply"),
  ];
  const merged = mergeLoadedTail(prevIds, prevMessages, nextIds, nextMessages);
  assert.ok(merged);
  assert.deepEqual(merged.entryIds, ["e1", "e2", "e3"]);
  assert.equal(merged.messages.length, 3);
  assert.deepEqual(merged.messages.at(-1), nextMessages[2]);
});

test("mergeLoadedTail consumes the landed prompt and keeps queued rows the window lacks", () => {
  // 运行中重连回填：乐观 prompt 已落盘（窗口里有它的持久版，消费升级、
  // 不重复）；排在它后面、尚未落盘的排队行原样保留在尾部。
  const optPrompt = { role: "user", content: "mid-run prompt", timestamp: 99 };
  const queued = { role: "user", content: "queued second", timestamp: 120 };
  const landed = { role: "user", content: "mid-run prompt", timestamp: 98 };
  const merged = mergeLoadedTail(
    ["e1"],
    [{ role: "user", content: "q", timestamp: 1 }, optPrompt, queued],
    ["e1", "e2", "e3"],
    [{ role: "user", content: "q", timestamp: 1 }, landed, toolResult("t1", 30)],
  );
  assert.ok(merged);
  assert.deepEqual(merged.entryIds, ["e1", "e2", "e3"]);
  assert.equal(merged.messages.length, 4);
  assert.deepEqual(merged.messages[1], landed);
  assert.equal(merged.messages[2].role, "toolResult");
  assert.deepEqual(merged.messages[3], queued);
});

test("mergeLoadedTail appends window rows past an alignment break without duplicating held rows", () => {
  // 位置对齐断裂（本地尾部顺序与窗口不同）：窗口条目不得整段重复追加，
  // 已持有的行按 sameMessage 消费。
  const held = text(20, "landed mid-run");
  const extra = toolResult("t9", 40);
  const merged = mergeLoadedTail(
    ["e1"],
    [{ role: "user", content: "q", timestamp: 1 }, held],
    ["e1", "e2", "e3"],
    [{ role: "user", content: "q", timestamp: 1 }, extra, held],
  );
  assert.ok(merged);
  assert.deepEqual(merged.entryIds, ["e1", "e2", "e3"]);
  assert.equal(merged.messages.length, 3);
  assert.ok(merged.messages.includes(extra));
  assert.equal(merged.messages.filter((m) => m.timestamp === 20).length, 1);
});

test("mergeLoadedTail returns null when the loaded ids are not a prefix of the window", () => {
  assert.equal(
    mergeLoadedTail(["e1", "eX"], [text(10, "a")], ["e1", "e2"], [text(10, "a"), text(20, "b")]),
    null,
  );
  assert.equal(
    mergeLoadedTail(["e1"], [{ role: "user", content: "q", timestamp: 1 }], ["e1"], [{ role: "user", content: "q", timestamp: 1 }]),
    null,
  );
});
