/**
 * The composer's running beam, driven by how fast tokens arrive.
 *
 * `border-beam` animates with a CSS keyframe whose period comes from its
 * `duration` prop, and the whole stylesheet (keyframes included) is regenerated
 * when that prop changes — so a per-sample duration restarts the trip and the
 * beam snaps back to the start. The period therefore stays fixed at
 * `BEAM_BASE_SECONDS` and only the animation's playback rate changes, which the
 * browser applies from wherever the beam currently is.
 *
 * The rate that drives it is integrated with a slew limit, not smoothed
 * exponentially: it moves toward the measured rate at a constant number of
 * tokens per second per second, quickly upward and slowly downward. That keeps
 * 1 → 0.1 a few seconds of steady deceleration instead of a step.
 */

/** One trip at rest, in seconds: the CSS animation's period, never changed at runtime. */
export const BEAM_SLOWEST_SECONDS = 4;
/** The same period, named for what it is at runtime: the playback-rate base. */
export const BEAM_BASE_SECONDS = BEAM_SLOWEST_SECONDS;
/** One trip on the fastest reply, in seconds. */
export const BEAM_FASTEST_SECONDS = 0.6;
/**
 * The rate that already counts as "as fast as it gets" (tokens per second).
 *
 * 150 太低：真实回包常在 150~300 t/s，一上来就顶到最快档，看起来反而“一直匀速”。
 */
export const BEAM_FASTEST_RATE = 400;

/**
 * How many tokens/s the rate may gain per second. Fast: a reply that starts
 * streaming should look fast almost at once.
 */
export const BEAM_RISE_PER_SECOND = 800;
/**
 * How many tokens/s it may lose per second. Much slower than the rise: a pause
 * between chunks must not read as the beam slamming to a crawl.
 */
export const BEAM_FALL_PER_SECOND = 45;

/** One trip around the card for a rate, linearly between the two ends. */
export function beamDurationSeconds(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return BEAM_SLOWEST_SECONDS;
  if (rate >= BEAM_FASTEST_RATE) return BEAM_FASTEST_SECONDS;
  const span = BEAM_SLOWEST_SECONDS - BEAM_FASTEST_SECONDS;
  const seconds = BEAM_SLOWEST_SECONDS - span * (rate / BEAM_FASTEST_RATE);
  return Math.min(BEAM_SLOWEST_SECONDS, Math.max(BEAM_FASTEST_SECONDS, seconds));
}

/** The playback rate that turns the fixed period into the duration for a rate. */
export function beamPlaybackRate(rate: number): number {
  return BEAM_BASE_SECONDS / beamDurationSeconds(rate);
}

/** Move `current` toward `target` by at most one slew step for `elapsedMs`. */
export function slewBeamRate(current: number, target: number, elapsedMs: number): number {
  const dt = Math.max(0, elapsedMs) / 1000;
  const clampedTarget = Math.min(BEAM_FASTEST_RATE, Math.max(0, Number.isFinite(target) ? target : 0));
  if (clampedTarget > current) return Math.min(clampedTarget, current + BEAM_RISE_PER_SECOND * dt);
  if (clampedTarget < current) return Math.max(clampedTarget, current - BEAM_FALL_PER_SECOND * dt);
  return current;
}
