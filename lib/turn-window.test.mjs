import assert from "node:assert/strict";
import test from "node:test";

import {
  TURN_ESTIMATE_HEIGHT,
  averageTurnHeight,
  computeTurnWindow,
  turnOffsets,
} from "./turn-window.ts";

test("offsets use measured heights and fall back to the estimate", () => {
  assert.deepEqual(turnOffsets([100, undefined, 50], 200), [0, 100, 300, 350]);
});

test("the window covers the viewport plus overscan, and the spacers add up", () => {
  const heights = new Array(100).fill(100);
  // Viewport at 2000..2600, overscan 1 screen = 600px.
  const window = computeTurnWindow(heights, TURN_ESTIMATE_HEIGHT, 2000, 600, 1);
  assert.ok(window.start > 0 && window.end < 100);
  // Turn 14 starts at 1400, turn 30 at 3000: the mounted range must span the
  // overscanned viewport [1400, 3200].
  assert.equal(window.start, 14);
  assert.equal(window.end, 32);
  // No pixels invented or lost: spacers + mounted turns = total height.
  const mounted = heights.slice(window.start, window.end).reduce((sum, height) => sum + height, 0);
  assert.equal(window.topHeight + mounted + window.bottomHeight, 10_000);
});

test("a short list is mounted whole and an empty one is empty", () => {
  const window = computeTurnWindow([100, 100], TURN_ESTIMATE_HEIGHT, 0, 600, 1);
  assert.deepEqual([window.start, window.end, window.topHeight, window.bottomHeight], [0, 2, 0, 0]);
  assert.deepEqual(computeTurnWindow([], TURN_ESTIMATE_HEIGHT, 0, 600), {
    start: 0, end: 0, topHeight: 0, bottomHeight: 0,
  });
});

test("the estimate is the measured average, or nothing before anything is measured", () => {
  assert.equal(averageTurnHeight([undefined, undefined]), null);
  assert.equal(averageTurnHeight([100, undefined, 300]), 200);
});
