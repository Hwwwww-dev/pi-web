"use client";

import { useEffect, useRef, useState } from "react";
import { beamPlaybackRate, beamTargetRate, clampBeamRise, slewBeamRate } from "@/lib/beam-speed";
import { getStreamCharacters } from "@/lib/stream-beam";

/**
 * How often the arriving characters are integrated. A quarter second is short
 * enough that the change looks continuous and long enough that the gap between
 * two chunks is not mistaken for a pause.
 */
const SAMPLE_MS = 250;
/**
 * The window the rate is measured over. A single 250ms bucket would read a
 * pause between chunks as "0 tokens/s"; a one-second window only sees a real
 * pause.
 */
const WINDOW_MS = 1000;
/**
 * The longer window the same rate is measured over, and the shorter of the two
 * wins. A reply's chunks arrive in batches — a render hiccup hands one bucket
 * several chunks at once — and a one-second window would read that bucket as a
 * reply four times faster than it is. Two seconds barely notice it, while a
 * reply that really speeds up still shows within two seconds.
 */
const LONG_WINDOW_MS = 2000;
/** pi's own rough conversion, so the beam and the t/s badge agree on what a token is. */
const CHARS_PER_TOKEN = 4;

/**
 * The running beam's playback rate for the reply's current token rate.
 *
 * The rate is integrated on a fixed timer rather than recomputed per chunk: a
 * paused stream has to decelerate too, and a chunk-driven sample would simply
 * stop updating (and freeze the beam at its last speed). The reply's length is
 * read from `lib/stream-beam` instead of a prop — a chunk lands dozens of times
 * a second and the composer is memoized — keyed by the session, so a background
 * session's stream is not read as this one's.
 *
 * A sample can only lift the rate so far (`clampBeamRise`): the window average
 * smooths chunks that arrive in batches, but one batched bucket is not a reply
 * that suddenly runs 4× faster.
 *
 * When the reply ends the beam does not snap back to its resting speed: the
 * same slew keeps bleeding the rate off, so the trip visibly eases out.
 */
export function useStreamBeamPlaybackRate(active: boolean, sessionKey: string): number {
  const [playbackRate, setPlaybackRate] = useState(1);
  // The rate survives the effect: a stream that ends must bleed off from where it
  // was, not restart at rest — the effect re-runs on `active` alone.
  const rateRef = useRef(0);

  useEffect(() => {
    let rate = active ? 0 : rateRef.current;
    const samples: { at: number; chars: number }[] = [];
    let last = performance.now();
    if (active) setPlaybackRate(beamPlaybackRate(0));
    const step = () => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      const chars = getStreamCharacters(sessionKey) / CHARS_PER_TOKEN;
      samples.push({ at: now, chars });
      // Keep one sample from before the long window: it is the baseline both
      // windows are measured against, so the first step of a stream never reads
      // the whole pre-stream length as one enormous burst.
      while (samples.length > 2 && now - samples[1].at >= LONG_WINDOW_MS) samples.shift();
      const rateOver = (base: { at: number; chars: number }) => {
        const span = now - base.at;
        return active && span > 0 ? Math.max(0, ((chars - base.chars) / span) * 1000) : 0;
      };
      const longBase = samples[0];
      const shortBase = samples.find((sample) => now - sample.at >= WINDOW_MS) ?? longBase;
      const measured = Math.min(rateOver(shortBase), rateOver(longBase));
      const target = clampBeamRise(beamTargetRate(measured, rate), rate);
      rate = slewBeamRate(rate, target, elapsed);
      rateRef.current = rate;
      setPlaybackRate(beamPlaybackRate(rate));
      return active || rate > 0.5;
    };
    const timer = window.setInterval(() => {
      if (step()) return;
      // The stream is over and the rate has bled down to rest.
      window.clearInterval(timer);
      rateRef.current = 0;
      setPlaybackRate(beamPlaybackRate(0));
    }, SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [active, sessionKey]);

  return playbackRate;
}
