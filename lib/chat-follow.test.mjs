import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CHAT_TAIL_EPSILON,
  createWheelGesture,
  initialFollowState,
  isAtTail,
  nextFollowState,
  WHEEL_LEAVE_THRESHOLD_PX,
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

test("downward deltas never produce an action", () => {
  const g = gestureAt([0, 10, 20]);
  assert.equal(g.feed(-20), "none");
  // 向下滚只清零累计：回底只有"滚到真底"或"点按钮"两条路，不存在轻推即跳。
  assert.equal(g.feed(10), "none");
  assert.equal(g.feed(500), "none");
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

test("only the real tail counts as attached", () => {
  assert.equal(isAtTail(400, 600, 1000), true);
  assert.equal(isAtTail(399.5, 600, 1000), true);
  assert.equal(isAtTail(398, 600, 1000), false);
  // 容差只吸收取整，不是设计余量：150px 以内不再算贴底。
  assert.equal(isAtTail(250, 600, 1000), false);
  assert.equal(isAtTail(0, 600, 400), true);
  assert.equal(CHAT_TAIL_EPSILON, 1);
});

test("a reader 100px above the bottom is not following, and growth leaves them alone", () => {
  const scrolled = nextFollowState(initialFollowState(0, 1000), {
    kind: "user-scroll",
    distance: 100,
  });
  assert.equal(scrolled.state.pinned, false);
  assert.equal(scrolled.action, "none");

  // 内容长高 40px、读者没动：既不补位也不判成贴底——这就是"零吸附"的保证。
  const grown = nextFollowState(scrolled.state, { kind: "resize", distance: 140, height: 1040 });
  assert.equal(grown.state.pinned, false);
  assert.equal(grown.action, "none");
});

test("growth while pinned only补 the grown amount", () => {
  const pinned = nextFollowState(initialFollowState(0, 1000), { kind: "user-scroll", distance: 0 });
  assert.equal(pinned.state.pinned, true);
  const grown = nextFollowState(pinned.state, { kind: "resize", distance: 40, height: 1040 });
  // 补位落点 = scrollHeight（真底），位移恰为这一帧的 40px。
  assert.equal(grown.action, "pin-bottom");
  assert.equal(grown.state.pinned, true);
});

test("an upward wheel leaves without scrolling", () => {
  const pinned = nextFollowState(initialFollowState(0, 1000), { kind: "user-scroll", distance: 0 });
  const left = nextFollowState(pinned.state, { kind: "wheel-leave" });
  assert.equal(left.state.pinned, false);
  assert.equal(left.action, "none");
});

test("shrinking content keeps a free reader in place", () => {
  const reading = nextFollowState(initialFollowState(0, 2000), { kind: "user-scroll", distance: 500 });
  // 完成重组：内容从 2000 缩到 1400，浏览器把 scrollTop 钳到底（距底变 0）。
  const shrunk = nextFollowState(reading.state, { kind: "resize", distance: 0, height: 1400 });
  assert.equal(shrunk.action, "restore-distance");
  assert.equal(shrunk.state.baseline, 500);
  assert.equal(shrunk.state.pinned, false);
});

test("shrinking content while pinned stays pinned to the tail", () => {
  const pinned = nextFollowState(initialFollowState(0, 2000), { kind: "user-scroll", distance: 0 });
  const shrunk = nextFollowState(pinned.state, { kind: "resize", distance: 600, height: 1400 });
  assert.equal(shrunk.action, "pin-bottom");
  assert.equal(shrunk.state.pinned, true);
});

test("a fold that pushes the tail out of view stops following, silently", () => {
  const pinned = nextFollowState(initialFollowState(0, 2000), { kind: "user-scroll", distance: 0 });
  const settled = nextFollowState(pinned.state, { kind: "settle", distance: 300, height: 2300 });
  assert.equal(settled.state.pinned, false);
  assert.equal(settled.action, "none");
  // 折叠后仍在底部（行收起）：继续跟随。
  const stillBottom = nextFollowState(pinned.state, { kind: "settle", distance: 0, height: 1400 });
  assert.equal(stillBottom.state.pinned, true);
  assert.equal(stillBottom.action, "none");
});

test("reach-bottom is the only command that jumps", () => {
  const reading = nextFollowState(initialFollowState(0, 2000), { kind: "user-scroll", distance: 900 });
  const back = nextFollowState(reading.state, { kind: "reach-bottom" });
  assert.equal(back.action, "pin-bottom");
  assert.equal(back.state.pinned, true);
});

test("no event other than reach-bottom or a pinned resize ever scrolls", () => {
  let state = initialFollowState(0, 1000);
  const events = [
    { kind: "user-scroll", distance: 700 },
    { kind: "resize", distance: 702, height: 1002 },
    { kind: "wheel-leave" },
    { kind: "settle", distance: 300, height: 1300 },
    { kind: "user-scroll", distance: 120 },
    { kind: "resize", distance: 160, height: 1040 },
  ];
  for (const event of events) {
    const result = nextFollowState(state, event);
    assert.equal(result.action, "none", `unexpected scroll on ${event.kind}`);
    state = result.state;
  }
});
