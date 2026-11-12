import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAM_BASE_SECONDS,
  BEAM_FASTEST_RATE,
  BEAM_FASTEST_SECONDS,
  BEAM_SLOWEST_SECONDS,
  beamDurationSeconds,
  beamPlaybackRate,
  slewBeamRate,
} from "./beam-speed.ts";

test("the trip length is continuous between the two ends", () => {
  assert.equal(beamDurationSeconds(0), BEAM_SLOWEST_SECONDS);
  assert.ok(Math.abs(beamDurationSeconds(BEAM_FASTEST_RATE) - BEAM_FASTEST_SECONDS) < 1e-9);
  assert.equal(beamDurationSeconds(400), BEAM_FASTEST_SECONDS);
  // Linear: half the fastest rate is half the span, no bands anywhere.
  assert.ok(Math.abs(beamDurationSeconds(BEAM_FASTEST_RATE / 2) - (BEAM_SLOWEST_SECONDS + BEAM_FASTEST_SECONDS) / 2) < 1e-9);
  const durations = new Set();
  for (let rate = 0; rate <= 200; rate += 1) durations.add(beamDurationSeconds(rate));
  assert.ok(durations.size > 100, "a sampled curve, not a step function");
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

test("the rate climbs fast and falls slowly, in straight lines", () => {
  // One second at the rise slope from rest reaches the fastest rate's worth of travel.
  const afterRise = slewBeamRate(0, BEAM_FASTEST_RATE, 1000);
  assert.ok(afterRise > BEAM_FASTEST_RATE * 0.5, `rose to ${afterRise}`);
  // Falling is much slower than rising.
  const afterFall = slewBeamRate(BEAM_FASTEST_RATE, 0, 1000);
  assert.ok(afterFall > BEAM_FASTEST_RATE * 0.5, `fell to ${afterFall}`);
  // Linear, not exponential: equal time steps move equal amounts.
  const a = slewBeamRate(0, BEAM_FASTEST_RATE, 100);
  const b = slewBeamRate(a, BEAM_FASTEST_RATE, 100) - a;
  assert.ok(Math.abs(a - b) < 1e-9, `${a} then ${b}`);
  // It never overshoots the measured rate.
  assert.equal(slewBeamRate(0, 10, 1000), 10);
});
