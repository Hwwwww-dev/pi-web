import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { splitTurnParts } = await jiti.import("./turn-view.ts");

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
