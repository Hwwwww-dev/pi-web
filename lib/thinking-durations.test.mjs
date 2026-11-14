// 思考行的时长在「流式气泡 → 列表 → 读文件」的重挂载之间必须还是同一个数：
// 重挂载后组件内的测量 state 归零，模块级表按稳定渲染键接住它。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { measuredThinkingDuration, recordThinkingDuration, thinkingDurationKey } = await jiti.import("./thinking-durations.ts");

test("a block's seconds come back after the remount that lost the component state", () => {
  const key = thinkingDurationKey("live:entry-1:1", 2);
  assert.equal(measuredThinkingDuration(key), undefined);
  recordThinkingDuration(key, 3);
  assert.equal(measuredThinkingDuration(key), 3);
  // 重挂载算出的还是同一个键（消息渲染键 + 块序号），读回同一个数而不是整条回复的时长。
  assert.equal(measuredThinkingDuration(thinkingDurationKey("live:entry-1:1", 2)), 3);
});

test("a message without a stable render key measures nothing", () => {
  assert.equal(thinkingDurationKey(undefined, 0), undefined);
  recordThinkingDuration(undefined, 4);
  assert.equal(measuredThinkingDuration(undefined), undefined);
});

test("blocks of one message stay apart", () => {
  recordThinkingDuration(thinkingDurationKey("live:a:0", 0), 1);
  recordThinkingDuration(thinkingDurationKey("live:a:0", 2), 7);
  assert.equal(measuredThinkingDuration(thinkingDurationKey("live:a:0", 0)), 1);
  assert.equal(measuredThinkingDuration(thinkingDurationKey("live:a:0", 2)), 7);
});

test("re-measuring a block replaces its number", () => {
  const key = thinkingDurationKey("live:a:1", 0);
  recordThinkingDuration(key, 3);
  recordThinkingDuration(key, 5);
  assert.equal(measuredThinkingDuration(key), 5);
});
