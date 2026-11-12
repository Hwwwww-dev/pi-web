/**
 * The composer's running beam, driven by how fast tokens arrive.
 *
 * `border-beam` takes a `duration` in seconds for one trip around the card. A
 * reply that streams fast should look fast, so the duration follows the rate —
 * but a raw per-sample rate jitters (a burst of tool calls, one long chunk), and
 * a beam that snaps back and forth reads as broken. Speed therefore moves like a
 * car: it picks up quickly and coasts down slowly, and the pedals are time
 * constants rather than per-sample steps, so a different sampling interval does
 * not change the feel.
 */

/** One trip at rest, in seconds: the beam's default before any sample says otherwise. */
export const BEAM_SLOWEST_SECONDS = 4;
/** One trip on a fast reply, in seconds. */
export const BEAM_FASTEST_SECONDS = 0.3;
/** The rate that already counts as "as fast as it gets" (tokens per second). */
export const BEAM_FASTEST_RATE = 150;
/** Curvature of the ease-out: how early the approach to the fast trip tapers off. */
const BEAM_CURVE_K = 30;

/**
 * How much time constant governs one sample's move toward the measured rate.
 * Rising is nearly instant (a burst registers at once), falling is a coast.
 */
const RATE_RISE_TAU = 0.12;
const RATE_FALL_TAU = 1.2;

/**
 * One trip around the card for a rate: an ease-out from 4s at rest to 0.3s,
 * landing exactly on 0.3 at `BEAM_FASTEST_RATE` and staying there. Exponentially
 * rather than linearly, so the slow end reacts immediately (0 → 30 t/s is
 * already 4s → 1.4s) and the fast end tapers instead of hitting a wall.
 */
export function beamDurationSeconds(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return BEAM_SLOWEST_SECONDS;
  if (rate >= BEAM_FASTEST_RATE) return BEAM_FASTEST_SECONDS;
  // Normalized so the curve is 1 at rest and 0 at BEAM_FASTEST_RATE — the
  // asymptote is subtracted rather than left hanging below the floor.
  const floorShare = Math.exp(-BEAM_FASTEST_RATE / BEAM_CURVE_K);
  const share = (Math.exp(-rate / BEAM_CURVE_K) - floorShare) / (1 - floorShare);
  return BEAM_FASTEST_SECONDS + (BEAM_SLOWEST_SECONDS - BEAM_FASTEST_SECONDS) * share;
}

/**
 * The next smoothed rate after `dtSeconds`: a faster reading is taken up almost
 * at once, a slower one only drifts down, so bursts register and stalls fade.
 */
export function advanceBeamRate(previous: number, target: number, dtSeconds: number): number {
  const next = Number.isFinite(target) && target > 0 ? target : 0;
  if (!Number.isFinite(previous) || previous <= 0) return next;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return previous;
  const tau = next > previous ? RATE_RISE_TAU : RATE_FALL_TAU;
  return next + (previous - next) * Math.exp(-dtSeconds / tau);
}
