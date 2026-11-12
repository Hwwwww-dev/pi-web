import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAM_FASTEST_RATE,
  BEAM_FASTEST_SECONDS,
  BEAM_SLOWEST_SECONDS,
  beamDurationSeconds,
} from "./beam-speed.ts";

test("a rate takes the band it reaches, fastest first", () => {
  assert.equal(beamDurationSeconds(BEAM_FASTEST_RATE), BEAM_FASTEST_SECONDS);
  assert.equal(beamDurationSeconds(400), BEAM_FASTEST_SECONDS);
  assert.equal(beamDurationSeconds(120), 0.9);
  assert.equal(beamDurationSeconds(60), 1.4);
  assert.equal(beamDurationSeconds(25), 2.2);
  assert.equal(beamDurationSeconds(7), 3.2);
});

test("nothing at all streams at rest, and bad samples do not retime the beam", () => {
  assert.equal(beamDurationSeconds(0), BEAM_SLOWEST_SECONDS);
  assert.equal(beamDurationSeconds(-5), BEAM_SLOWEST_SECONDS);
  assert.equal(beamDurationSeconds(Number.NaN), BEAM_SLOWEST_SECONDS);
  assert.equal(beamDurationSeconds(Number.POSITIVE_INFINITY), BEAM_SLOWEST_SECONDS);
});

test("the bands are a step function: one duration per band, never a curve", () => {
  const seen = new Set();
  for (let rate = -10; rate <= 300; rate += 1) seen.add(beamDurationSeconds(rate));
  assert.deepEqual([...seen].sort((a, b) => a - b), [0.6, 0.9, 1.4, 2.2, 3.2, 4]);
});
