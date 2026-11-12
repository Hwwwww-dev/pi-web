import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAM_BASE_SECONDS,
  BEAM_FASTEST_RATE,
  BEAM_FASTEST_SECONDS,
  BEAM_FALL_CAP_SHARE,
  BEAM_IDLE_SHARE,
  BEAM_RISE_PER_SECOND,
  BEAM_SLOWEST_SECONDS,
  beamDurationSeconds,
  beamPlaybackRate,
  beamTargetRate,
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
  // One second of rise covers the whole ramp; a quarter second already moves it.
  assert.equal(slewBeamRate(0, BEAM_FASTEST_RATE, 1000), BEAM_RISE_PER_SECOND);
  assert.ok(slewBeamRate(0, BEAM_FASTEST_RATE, 250) > BEAM_FASTEST_RATE * 0.15);
  // A quarter second of falling barely moves: 18 t/s per second.
  const fell = slewBeamRate(300, 0, 250);
  assert.ok(fell > 290, `fell to ${fell}`);
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
  let rate = 300;
  // Two idle steps: the beam eases down but stays in the fast range.
  rate = slewBeamRate(rate, beamTargetRate(0, rate), 250);
  rate = slewBeamRate(rate, beamTargetRate(0, rate), 250);
  assert.ok(rate < 300 && rate > 200, `idled down to ${rate}`);
  // Chunks return at 450 t/s: the next steps rise, they do not wait for the floor.
  const before = rate;
  rate = slewBeamRate(rate, beamTargetRate(450, rate), 250);
  assert.ok(rate > before + 90, `climbed to ${rate}`);
  assert.ok(beamPlaybackRate(rate) > beamPlaybackRate(before));
});
