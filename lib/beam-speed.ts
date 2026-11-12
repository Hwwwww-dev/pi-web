/**
 * The composer's running beam, driven by how fast tokens arrive.
 *
 * `border-beam` takes a `duration` in seconds for one trip around the card. A
 * reply that streams fast should look fast, so the duration follows the rate —
 * but only in steps: a continuous curve would retime the animation on almost
 * every sample, and a restarted CSS animation jumps back to the start of its
 * trip, which reads as the beam stuttering and the badge flickering.
 *
 * So the rate is quantized into bands. Inside a band the animation keeps its
 * duration and runs uninterrupted; a new sample only matters when it lands in a
 * different band, and even then the caller waits for a second sample before
 * retiming (see `useStreamBeamDuration`), so one burst cannot jolt the beam.
 */

/** One trip at rest, in seconds: the beam's default before any sample says otherwise. */
export const BEAM_SLOWEST_SECONDS = 4;
/** One trip on the fastest reply, in seconds. */
export const BEAM_FASTEST_SECONDS = 0.6;
/** The rate that already counts as "as fast as it gets" (tokens per second). */
export const BEAM_FASTEST_RATE = 150;

/**
 * Band floors and their trip time, fastest first. A rate takes the first band
 * whose floor it reaches; anything below the lowest floor runs at rest.
 */
const BEAM_BANDS: ReadonlyArray<{ min: number; seconds: number }> = [
  { min: BEAM_FASTEST_RATE, seconds: BEAM_FASTEST_SECONDS },
  { min: 100, seconds: 0.9 },
  { min: 50, seconds: 1.4 },
  { min: 20, seconds: 2.2 },
  { min: 5, seconds: 3.2 },
  { min: 0, seconds: BEAM_SLOWEST_SECONDS },
];

/** One trip around the card for a rate. */
export function beamDurationSeconds(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return BEAM_SLOWEST_SECONDS;
  for (const band of BEAM_BANDS) {
    if (rate >= band.min) return band.seconds;
  }
  return BEAM_SLOWEST_SECONDS;
}
