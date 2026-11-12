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
 * exponentially: it moves toward the measured rate at a constant slope —
 * quickly upward, very slowly downward — and every step re-compares the two, so
 * a reply that speeds up again midway through a slowdown climbs straight back.
 */

/** One trip at rest, in seconds: the CSS animation's period, never changed at runtime. */
export const BEAM_SLOWEST_SECONDS = 4;
/** The same period, named for what it is at runtime: the playback-rate base. */
export const BEAM_BASE_SECONDS = BEAM_SLOWEST_SECONDS;
/** One trip on the fastest reply, in seconds. */
export const BEAM_FASTEST_SECONDS = 0.6;
/** The rate that counts as "as fast as it gets" (tokens per second). */
export const BEAM_FASTEST_RATE = 180;

/**
 * The curve's exponent between a resting beam and the fastest one.
 *
 * `rate / BEAM_FASTEST_RATE` is how much of that travel is done; the shortfall
 * raised to this power keeps the low end flat — a 60 t/s reply still looks
 * unhurried — and closes the last half second at 180 t/s, with no step at the
 * knee.
 */
export const BEAM_CURVE_EXPONENT = 1.5;

/** How many tokens/s the rate may gain per second: a stream that starts should look fast almost at once. */
export const BEAM_RISE_PER_SECOND = 400;

/**
 * How many tokens/s it may lose per second. Deliberately small — a gap between
 * chunks is not a slowdown, and the beam must not look like it hit the brakes.
 */
export const BEAM_FALL_PER_SECOND = 18;

/** No single step may drop more than this share of the current rate, however long the step. */
export const BEAM_FALL_CAP_SHARE = 0.06;

/**
 * What a pause asks for: this share of the current rate, not zero.
 *
 * A reply that stops arriving for a second is a pause, not the end — the beam
 * glides down a little each step and recovers the moment chunks return.
 */
export const BEAM_IDLE_SHARE = 0.55;

/** One trip around the card for a rate. */
export function beamDurationSeconds(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return BEAM_SLOWEST_SECONDS;
  if (rate >= BEAM_FASTEST_RATE) return BEAM_FASTEST_SECONDS;
  const span = BEAM_SLOWEST_SECONDS - BEAM_FASTEST_SECONDS;
  const rest = 1 - rate / BEAM_FASTEST_RATE;
  return BEAM_FASTEST_SECONDS + span * rest ** BEAM_CURVE_EXPONENT;
}

/** The playback rate that turns the fixed period into the duration for a rate. */
export function beamPlaybackRate(rate: number): number {
  return BEAM_BASE_SECONDS / beamDurationSeconds(rate);
}

/** What a measured rate asks the integrated rate to become. */
export function beamTargetRate(measured: number, current: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return current * BEAM_IDLE_SHARE;
  return measured;
}

/** Move `current` toward `target` by at most one slew step for `elapsedMs`. */
export function slewBeamRate(current: number, target: number, elapsedMs: number): number {
  const dt = Math.max(0, elapsedMs) / 1000;
  const clampedTarget = Math.min(BEAM_FASTEST_RATE, Math.max(0, Number.isFinite(target) ? target : 0));
  if (clampedTarget >= current) return Math.min(clampedTarget, current + BEAM_RISE_PER_SECOND * dt);
  const drop = Math.min(current - clampedTarget, BEAM_FALL_PER_SECOND * dt, current * BEAM_FALL_CAP_SHARE);
  return current - drop;
}
