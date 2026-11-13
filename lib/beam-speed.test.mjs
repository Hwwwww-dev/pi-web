import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAM_BASE_SECONDS,
  BEAM_FASTEST_RATE,
  BEAM_FASTEST_SECONDS,
  BEAM_FALL_CAP_SHARE,
  BEAM_IDLE_SHARE,
  BEAM_RISE_FLOOR,
  BEAM_SLOWEST_SECONDS,
  beamDurationSeconds,
  beamPlaybackRate,
  beamTargetRate,
  clampBeamRise,
  slewBeamRate,
} from "./beam-speed.ts";

test("the trip length runs exponentially between the two ends", () => {
  assert.equal(beamDurationSeconds(0), BEAM_SLOWEST_SECONDS);
  assert.equal(beamDurationSeconds(BEAM_FASTEST_RATE), BEAM_FASTEST_SECONDS);
  // Exponential: the low end stays slow, the top end closes the last half second.
  // Half the fastest rate is already a quick trip — well under a linear midpoint.
  const middle = beamDurationSeconds(BEAM_FASTEST_RATE / 2);
  assert.ok(middle < (BEAM_SLOWEST_SECONDS + BEAM_FASTEST_SECONDS) / 2, `half the rate rested at ${middle}s`);
  // A slow reply is still visibly slower than a resting one.
  assert.ok(beamDurationSeconds(30) > 3, `30 t/s rested at ${beamDurationSeconds(30)}s`);
  // Monotonic, and a sampled curve rather than a step function.
  let previous = Number.POSITIVE_INFINITY;
  const durations = new Set();
  for (let rate = 0; rate <= BEAM_FASTEST_RATE; rate += 1) {
    const seconds = beamDurationSeconds(rate);
    assert.ok(seconds <= previous, `rose at ${rate} t/s`);
    previous = seconds;
    durations.add(seconds);
  }
  assert.ok(durations.size > 100);
});

test("nonsense rates rest the beam", () => {
  assert.equal(beamDurationSeconds(-5), BEAM_SLOWEST_SECONDS);
  assert.equal(beamDurationSeconds(Number.NaN), BEAM_SLOWEST_SECONDS);
  assert.equal(beamDurationSeconds(Number.POSITIVE_INFINITY), BEAM_SLOWEST_SECONDS);
});

test("the playback rate turns the fixed period into that trip", () => {
  assert.equal(beamPlaybackRate(0), 1);
  assert.ok(Math.abs(beamPlaybackRate(BEAM_FASTEST_RATE) - BEAM_BASE_SECONDS / BEAM_FASTEST_SECONDS) < 1e-9);
});

test("the rate climbs fast and falls slowly", () => {
  // One second of rise covers the whole ramp (the target is pinned at the fastest rate).
  assert.equal(slewBeamRate(0, 5_000, 1000), BEAM_FASTEST_RATE);
  assert.ok(slewBeamRate(0, BEAM_FASTEST_RATE, 250) > BEAM_FASTEST_RATE * 0.15);
  // A quarter second of falling barely moves: 6 t/s per second.
  const fell = slewBeamRate(300, 0, 250);
  assert.ok(fell > 297, `fell to ${fell}`);
  // It never overshoots the measured rate.
  assert.equal(slewBeamRate(0, 10, 1000), 10);
});

test("no single step drops more than the cap, however long the step", () => {
  const fell = slewBeamRate(10, 0, 10_000);
  assert.ok(Math.abs(fell - 10 * (1 - BEAM_FALL_CAP_SHARE)) < 1e-9, `fell to ${fell}`);
});

test("a pause asks for a share of the current rate, not zero", () => {
  assert.equal(beamTargetRate(0, 300), 300 * BEAM_IDLE_SHARE);
  assert.equal(beamTargetRate(Number.NaN, 300), 300 * BEAM_IDLE_SHARE);
  assert.equal(beamTargetRate(120, 300), 120);
});

test("a reply that speeds up mid-slowdown climbs straight back", () => {
  let rate = BEAM_FASTEST_RATE;
  // Two idle steps: the beam eases down but keeps almost all of its speed.
  rate = slewBeamRate(rate, beamTargetRate(0, rate), 250);
  rate = slewBeamRate(rate, beamTargetRate(0, rate), 250);
  assert.ok(rate < BEAM_FASTEST_RATE && rate > BEAM_FASTEST_RATE - 4, `idled down to ${rate}`);
  // Chunks return well above the fastest rate: the very next steps climb, they do
  // not wait for the floor to be reached first.
  const before = rate;
  rate = slewBeamRate(rate, beamTargetRate(450, rate), 250);
  assert.equal(rate, BEAM_FASTEST_RATE);
  assert.ok(beamPlaybackRate(rate) > beamPlaybackRate(before));
});


test("one batched sample cannot lift the rate to the fastest", () => {
  // A bucket handed several chunks at once reads as a huge spike; the cap keeps
  // the reply's real 50 t/s from being taken for 180+.
  assert.equal(clampBeamRise(4000, 50), 150);
  assert.equal(clampBeamRise(4000, 0), BEAM_RISE_FLOOR);
  assert.equal(clampBeamRise(50, 120), 50);
  // Climbing still works: the ceiling is relative to where the rate is.
  let rate = BEAM_RISE_FLOOR;
  for (let step = 0; step < 4; step += 1) {
    rate = slewBeamRate(rate, clampBeamRise(4000, rate), 250);
  }
  assert.equal(rate, BEAM_FASTEST_RATE);
});
