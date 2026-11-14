// 被截断的回合头只在回合真的结束时补用量行：窗口后面还有条目说明下一个锚点出现，
// 回合到头了；窗口止于叶子时，运行中的那一轮还没结束，用量行要等整轮结束。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { headSegmentEndsTurn } = await jiti.import("./turn-view.ts");

test("another entry follows the head: the turn ended there", () => {
  assert.equal(headSegmentEndsTurn({ headEnd: 2, messageCount: 5, running: true }), true);
});

test("the head reaches the leaf while a run is active: not finished yet", () => {
  assert.equal(headSegmentEndsTurn({ headEnd: 5, messageCount: 5, running: true }), false);
});

test("the head reaches the leaf and nothing runs: the turn finished", () => {
  assert.equal(headSegmentEndsTurn({ headEnd: 5, messageCount: 5, running: false }), true);
});
