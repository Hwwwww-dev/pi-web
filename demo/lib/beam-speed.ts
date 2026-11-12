/**
 * The composer's running beam, driven by how fast tokens arrive.
 *
 * `border-beam` takes a `duration` in seconds for one trip around the card. A
 * reply that streams fast should look fast, so the duration follows the rate —
 * but a raw per-sample rate jitters (a burst of tool calls, one long chunk), and
 * a beam that snaps back and forth reads as broken. Speed therefore moves like a
 * car: it picks up quickly and coasts down slowly.
 */

/** One trip at rest, in seconds: slow enough to read as "still working", not as a spinner. */
export const BEAM_SLOWEST_SECONDS = 2.5;
/** One trip on a fast reply, in seconds. */
export const BEAM_FASTEST_SECONDS = 0.5;
/** The rate that already counts as "fast" (tokens per second). */
const BEAM_FASTEST_RATE = 120;

/** How much of a gap one sample closes when speeding up / slowing down. */
const ACCELERATE = 0.5;
const DECELERATE = 0.08;

/**
 * One trip around the card for a smoothed rate: linear between the slowest and
 * fastest, clamped at both ends so neither reads as frozen or as a blur.
 */
export function beamDurationSeconds(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return BEAM_SLOWEST_SECONDS;
  const clamped = Math.min(rate, BEAM_FASTEST_RATE);
  const span = BEAM_SLOWEST_SECONDS - BEAM_FASTEST_SECONDS;
  return BEAM_SLOWEST_SECONDS - (span * clamped) / BEAM_FASTEST_RATE;
}

/**
 * The next smoothed rate: a faster reading is taken up in one large step, a
 * slower one only drifts down, so bursts register and stalls fade.
 */
export function nextBeamRate(previous: number, target: number): number {
  if (!Number.isFinite(previous) || previous <= 0) return target;
  if (!Number.isFinite(target) || target <= 0) target = 0;
  const gap = target - previous;
  return previous + gap * (gap > 0 ? ACCELERATE : DECELERATE);
}
