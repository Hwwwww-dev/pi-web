import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createWheelGesture,
  WHEEL_LEAVE_THRESHOLD_PX,
  WHEEL_REATTACH_THRESHOLD_PX,
} = await jiti.import("./chat-follow.ts");

/** 构造按给定时刻序列推进的判定器（超出序列后停在最后一个时刻）。 */
function gestureAt(times) {
  let i = 0;
  return createWheelGesture(() => {
    const t = times[Math.min(i, times.length - 1)];
    i += 1;
    return t;
  });
}

test("a single full-notch wheel tick leaves immediately", () => {
  const g = gestureAt([0]);
  assert.equal(g.feed(-100), "leave");
});

test("trackpad noise below the threshold never leaves", () => {
  const g = gestureAt([0, 50, 100]);
  assert.equal(g.feed(-4), "none");
  assert.equal(g.feed(-4), "none");
  assert.equal(g.feed(-4), "none");
});

test("accumulated deltas inside the window do leave", () => {
  const g = gestureAt([0, 100]);
  assert.equal(g.feed(-(WHEEL_LEAVE_THRESHOLD_PX - 1)), "none");
  assert.equal(g.feed(-2), "leave");
});

test("accumulation resets after the window elapses", () => {
  const g = gestureAt([0, 1000]);
  assert.equal(g.feed(-30), "none");
  // 超窗（400ms），累计清零后再来一笔小额仍是噪声。
  assert.equal(g.feed(-30), "none");
});

test("opposite direction resets the accumulation", () => {
  const g = gestureAt([0, 10, 20]);
  assert.equal(g.feed(-20), "none");
  // 向下到回挂阈值即报告回挂（顺带覆盖回挂阈值），向上累计同时清零。
  assert.equal(g.feed(10), "reattach");
  assert.equal(g.feed(-20), "none");
});

test("downward deltas past the reattach threshold report reattach", () => {
  const g = gestureAt([0, 10, 20]);
  assert.equal(g.feed(WHEEL_REATTACH_THRESHOLD_PX - 3), "none");
  assert.equal(g.feed(3), "reattach");
});

test("line-mode deltas are scaled to pixels before thresholds apply", () => {
  const g = gestureAt([0]);
  // Firefox 行模式一格 deltaY=-2，×16 = -32px，恰好达到脱离阈值。
  assert.equal(g.feed(-2, 16), "leave");
});

test("zero delta is ignored", () => {
  const g = gestureAt([0]);
  assert.equal(g.feed(0), "none");
});
