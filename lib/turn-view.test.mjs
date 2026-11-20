import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { splitTurnParts, summarizeSegmentActivity } = await jiti.import("./turn-view.ts");

// 活动按中途回复切段（2026-11-20）：回复显示在外面，两段回复之间的
// 思考/工具各自成一个行内大折叠。活跃期与完成态共用这把刀，段序号才能
// 逐段对上折叠键。

test("no replies: everything lands in one fold", () => {
  const parts = splitTurnParts([
    { kind: "thinking", key: "t1", block: { type: "thinking", thinking: "a" } },
    { kind: "tool", key: "c1", block: { type: "toolCall", toolCallId: "c1", toolName: "bash", input: {} } },
  ]);
  assert.deepEqual(parts.map((p) => p.kind), ["fold"]);
  assert.equal(parts[0].items.length, 2);
});

test("a reply splits the activities into folds around it", () => {
  const parts = splitTurnParts([
    { kind: "thinking", key: "t1", block: { type: "thinking", thinking: "a" } },
    { kind: "text", key: "r1", block: { type: "text", text: "中途回复" } },
    { kind: "tool", key: "c1", block: { type: "toolCall", toolCallId: "c1", toolName: "bash", input: {} } },
  ]);
  assert.deepEqual(parts.map((p) => p.kind), ["fold", "reply", "fold"]);
  assert.equal(parts[0].items.length, 1);
  assert.equal(parts[1].block.text, "中途回复");
  assert.equal(parts[2].items.length, 1);
});

test("leading and trailing replies produce no empty folds", () => {
  const parts = splitTurnParts([
    { kind: "text", key: "r1", block: { type: "text", text: "先说结论" } },
    { kind: "tool", key: "c1", block: { type: "toolCall", toolCallId: "c1", toolName: "bash", input: {} } },
    { kind: "text", key: "r2", block: { type: "text", text: "再说细节" } },
  ]);
  assert.deepEqual(parts.map((p) => p.kind), ["reply", "fold", "reply"]);
});

test("search targets ride along on both folds and replies", () => {
  const parts = splitTurnParts([
    { kind: "tool", key: "c1", block: { type: "toolCall", toolCallId: "c1", toolName: "bash", input: {} }, searchTarget: true },
    { kind: "text", key: "r1", block: { type: "text", text: "回复" }, searchTarget: true },
  ]);
  assert.equal(parts[0].items[0].searchTarget, true);
  assert.equal(parts[1].searchTarget, true);
});

// 段摘要原料（2026-11-20）：一遍遍历算四大类计数、失败数、首尾时间戳与条目自报
// 时长之和。口径与旧的组件内实现逐项一致，这里锁住分类与兜底规则。

const tool = (name, extra = {}) => ({
  kind: "tool",
  key: name + Math.random(),
  block: { type: "toolCall", toolCallId: "c", toolName: name, input: {} },
  ...extra,
});

test("segment summary counts categories, failures and spans", () => {
  const summary = summarizeSegmentActivity([
    { kind: "thinking", key: "t1", block: { type: "thinking", thinking: "a" }, ts: 1000, duration: 2 },
    tool("read", { ts: 2000, duration: 500 }),
    tool("grep", { ts: 2500, duration: 100 }),
    tool("webfetch", { ts: 2600, duration: 100 }),
    tool("edit", { ts: 3000, duration: 700 }),
    tool("bash", { ts: 4000, duration: 900, result: { isError: true } }),
    tool("agent", { ts: 5000, duration: 200 }),
    tool("todo_write", { ts: 6000, duration: 50 }),
  ]);
  // todo_write 归 edit（名字以 `_write` 结尾，与 isWriteToolName 同口径），plan
  // 类工具不进摘要。
  assert.deepEqual(summary.counts, { read: 3, edit: 2, run: 1, subagent: 1 });
  assert.equal(summary.failed, 1);
  assert.equal(summary.firstTs, 1000);
  assert.equal(summary.lastTs, 6000);
  // thinking 记秒（2s→2000ms），tool 记毫秒，其余分类不计数但时长照加。
  assert.equal(summary.durationMs, 2000 + 500 + 100 + 100 + 700 + 900 + 200 + 50);
});

test("segment summary tolerates items without timestamps or durations", () => {
  const summary = summarizeSegmentActivity([
    { kind: "thinking", key: "t1", block: { type: "thinking", thinking: "a" } },
    tool("read"),
  ]);
  assert.deepEqual(summary.counts, { read: 1, edit: 0, run: 0, subagent: 0 });
  assert.equal(summary.failed, 0);
  assert.equal(summary.firstTs, undefined);
  assert.equal(summary.lastTs, undefined);
  assert.equal(summary.durationMs, 0);
});
