// 分页窗口从回合中间开始时，被截断的回合头也要一条用量行（ChatWindow 把窗口内的
// 那一段渲染成活动行，走到回合终点却没有用量行）。整轮求和要用窗口外的助手消息，
// 所以由服务端随窗口下发 headTurn。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");

const stamp = (second) => new Date(1_700_000_000_000 + second * 1000).toISOString();
const usage = (input, output, total, cacheRead = 0, cacheWrite = 0) => ({
  input, output, cacheRead, cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});
const assistant = (id, parentId, second, text, numbers) => ({
  id, parentId, type: "message", timestamp: stamp(second),
  message: {
    role: "assistant", content: [{ type: "text", text }], provider: "prov", model: "model-1",
    timestamp: Date.parse(stamp(second)), usage: numbers,
  },
});

// 两轮：e0..e1 是上一轮，e3..e6 是本轮（中间夹一条思考等级变更），e7 是下一轮提问。
function twoTurns() {
  return [
    { id: "e0", parentId: null, type: "message", timestamp: stamp(0), message: { role: "user", content: "上一轮提问" } },
    assistant("e1", "e0", 1, "上一轮回答", usage(100, 10, 0.01)),
    { id: "e2", parentId: "e1", type: "thinking_level_change", timestamp: stamp(2), thinkingLevel: "high" },
    { id: "e3", parentId: "e2", type: "message", timestamp: stamp(3), message: { role: "user", content: "本轮提问" } },
    assistant("e4", "e3", 4, "先读文件", usage(1000, 20, 0.02, 800, 50)),
    {
      id: "e5", parentId: "e4", type: "message", timestamp: stamp(5),
      message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "ok" }] },
    },
    assistant("e6", "e5", 6, "最终答复", usage(2000, 200, 0.03, 900, 60)),
    { id: "e7", parentId: "e6", type: "message", timestamp: stamp(7), message: { role: "user", content: "下一轮提问" } },
  ];
}

test("a page that begins mid-turn carries the whole turn's usage", () => {
  const entries = twoTurns();
  const ctx = buildSessionContext(entries, "e7", { tail: 3 });
  // 窗口 = [先读文件, toolResult, 最终答复, 下一轮提问]（toolResult 不占 tail 名额）：
  // 第一条不是回合锚点，回合头被截断。
  assert.deepEqual(ctx.entryIds, ["e4", "e5", "e6", "e7"]);
  assert.equal(ctx.hasMore, true);

  const head = ctx.headTurn;
  assert.ok(head, "missing headTurn");
  // 两个请求之和（e4 + e6），窗口里只有 e6。
  assert.equal(head.usage.input, 3000);
  assert.equal(head.usage.output, 220);
  assert.ok(Math.abs(head.usage.cost.total - 0.05) < 1e-9);
  // 缓存读写取该轮最后一次请求，不做累加。
  assert.equal(head.usage.cacheRead, 900);
  assert.equal(head.usage.cacheWrite, 60);
  // 模型与时间来自本轮最后一个助手消息；思考等级随 thinking_level_change 前向携带。
  assert.equal(head.provider, "prov");
  assert.equal(head.model, "model-1");
  assert.equal(head.thinkingLevel, "high");
  assert.equal(head.timestamp, Date.parse(stamp(6)));
});

test("a window that stops at the leaf inside the last turn carries it too", () => {
  const entries = twoTurns();
  const ctx = buildSessionContext(entries, "e6", { tail: 2 });
  assert.deepEqual(ctx.entryIds, ["e4", "e5", "e6"]);
  assert.equal(ctx.hasMore, true);
  assert.equal(ctx.headTurn?.usage.input, 3000);
  assert.equal(ctx.headTurn?.timestamp, Date.parse(stamp(6)));
});

test("a page that begins on a turn anchor has no headTurn", () => {
  const entries = twoTurns();
  const ctx = buildSessionContext(entries, "e7", { anchor: "e3", tail: 10, after: 4 });
  assert.equal(ctx.entryIds[0], "e0");
  assert.equal(ctx.headTurn, undefined);
});

test("the whole branch (no window) has no headTurn", () => {
  const entries = twoTurns();
  const ctx = buildSessionContext(entries, "e7");
  assert.equal(ctx.headTurn, undefined);
});
