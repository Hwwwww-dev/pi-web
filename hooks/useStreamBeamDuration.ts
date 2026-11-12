"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BEAM_SLOWEST_SECONDS, advanceBeamRate, beamDurationSeconds } from "@/lib/beam-speed";
import { getStreamCharacters, subscribeStreamCharacters } from "@/lib/stream-beam";

/** How often the arriving characters are measured; per-chunk sampling made the beam twitch. */
const SAMPLE_MS = 200;
/** pi's own rough conversion, so the beam and the t/s badge agree on what a token is. */
const CHARS_PER_TOKEN = 4;

/**
 * How long the running beam takes to go round the composer, from the rate the
 * reply is streaming at: it picks up quickly and eases down slowly.
 *
 * The reply's length is read from `lib/stream-beam` instead of a prop — a chunk
 * lands dozens of times a second and the composer is memoized.
 */
export function useStreamBeamDuration(active: boolean): number {
  const [duration, setDuration] = useState(BEAM_SLOWEST_SECONDS);
  const characters = useSyncExternalStore(subscribeStreamCharacters, getStreamCharacters, getStreamCharacters);
  const lastRef = useRef<{ at: number; tokens: number } | null>(null);
  const rateRef = useRef(0);

  useEffect(() => {
    if (!active) {
      lastRef.current = null;
      rateRef.current = 0;
      setDuration(BEAM_SLOWEST_SECONDS);
      return;
    }
    const now = Date.now();
    const tokens = characters / CHARS_PER_TOKEN;
    const last = lastRef.current;
    if (!last) {
      lastRef.current = { at: now, tokens };
      return;
    }
    const elapsed = now - last.at;
    if (elapsed < SAMPLE_MS) return;
    const measured = Math.max(0, ((tokens - last.tokens) / elapsed) * 1000);
    lastRef.current = { at: now, tokens };
    const rate = advanceBeamRate(rateRef.current, measured, elapsed / 1000);
    rateRef.current = rate;
    setDuration(beamDurationSeconds(rate));
  }, [active, characters]);

  return duration;
}
