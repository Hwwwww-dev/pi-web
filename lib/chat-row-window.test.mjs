import assert from "node:assert/strict";
import test from "node:test";

import { computeRowWindow, sameRowWindow } from "./chat-row-window.ts";

const rows = [
  { id: "a", top: 0, height: 1000 },
  { id: "b", top: 1000, height: 400 },
  { id: "c", top: 1400, height: 400 },
  { id: "d", top: 1800, height: 400 },
];

test("视口上下 1.5 屏之外的行收成占位，占位高度等于原行高", () => {
  // 视口 400，滚到 0：窗口 = [-600, 1000]，c/d 在窗口外。
  const { collapsed } = computeRowWindow(rows, 0, 400);
  assert.deepEqual([...collapsed.keys()], ["c", "d"]);
  assert.equal(collapsed.get("c"), 400);
});

test("滚到中段时上下的远处行都被收起", () => {
  // 滚到 2000：窗口 = [1400, 3000]，只有最上面那行整个落在窗口之上。
  const { collapsed } = computeRowWindow(rows, 2000, 400);
  assert.deepEqual([...collapsed.keys()], ["a"]);
});

test("隐藏的保活槽（可视高度 0）不折叠任何行", () => {
  assert.equal(computeRowWindow(rows, 0, 0).collapsed.size, 0);
});

test("keep 里的行永不折叠", () => {
  const { collapsed } = computeRowWindow(rows, 0, 400, new Set(["c"]));
  assert.deepEqual([...collapsed.keys()], ["d"]);
});

test("折叠结果比较按内容而非引用", () => {
  assert.equal(sameRowWindow(new Map([["a", 1]]), new Map([["a", 1]])), true);
  assert.equal(sameRowWindow(new Map([["a", 1]]), new Map([["a", 2]])), false);
  assert.equal(sameRowWindow(new Map([["a", 1]]), new Map()), false);
});
