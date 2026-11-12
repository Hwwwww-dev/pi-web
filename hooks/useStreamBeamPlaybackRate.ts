"use client";

import { useEffect, useState } from "react";
import { beamPlaybackRate, slewBeamRate } from "@/lib/beam-speed";
import { getStreamCharacters } from "@/lib/stream-beam";

/**
 * How often the arriving characters are integrated. Dense on purpose: a small
 * step every 100ms is what makes the change look continuous instead of arriving
 * in visible lumps.
 */
const SAMPLE_MS = 100;
/** pi's own rough conversion, so the beam and the t/s badge agree on what a token is. */
const CHARS_PER_TOKEN = 4;

/**
 * The running beam's playback rate for the reply's current token rate.
 *
 * The rate is integrated on a fixed timer rather than recomputed per chunk: a
 * paused stream has to decelerate too, and a chunk-driven sample would simply
 * stop updating (and freeze the beam at its last speed). The reply's length is
 * read from `lib/stream-beam` instead of a prop — a chunk lands dozens of times
 * a second and the composer is memoized.
 */
export function useStreamBeamPlaybackRate(active: boolean): number {
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (!active) {
      setPlaybackRate(1);
      return;
    }
    let rate = 0;
    let tokens = getStreamCharacters() / CHARS_PER_TOKEN;
    let at = performance.now();
    // The first tick only establishes the baseline; measuring against the
    // pre-stream length would read the whole session as one enormous burst.
    setPlaybackRate(beamPlaybackRate(0));
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - at;
      const next = getStreamCharacters() / CHARS_PER_TOKEN;
      const measured = elapsed > 0 ? Math.max(0, ((next - tokens) / elapsed) * 1000) : 0;
      tokens = next;
      at = now;
      rate = slewBeamRate(rate, measured, elapsed);
      setPlaybackRate(beamPlaybackRate(rate));
    }, SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return playbackRate;
}
