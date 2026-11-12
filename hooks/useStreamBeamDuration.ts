"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BEAM_SLOWEST_SECONDS, beamDurationSeconds } from "@/lib/beam-speed";
import { getStreamCharacters, subscribeStreamCharacters } from "@/lib/stream-beam";

/** How often the arriving characters are measured; per-chunk sampling made the beam twitch. */
const SAMPLE_MS = 200;
/** pi's own rough conversion, so the beam and the t/s badge agree on what a token is. */
const CHARS_PER_TOKEN = 4;
/**
 * Consecutive samples that must agree on a new band before the beam is retimed.
 * A single burst — the chunk that carries a whole tool result — crosses bands
 * for an instant and must not jolt a running animation.
 */
const BAND_HOLD_SAMPLES = 2;

/**
 * How long the running beam takes to go round the composer, in the band the
 * reply's rate currently falls in.
 *
 * The reply's length is read from `lib/stream-beam` instead of a prop — a chunk
 * lands dozens of times a second and the composer is memoized.
 */
export function useStreamBeamDuration(active: boolean): number {
  const [duration, setDuration] = useState(BEAM_SLOWEST_SECONDS);
  const characters = useSyncExternalStore(subscribeStreamCharacters, getStreamCharacters, getStreamCharacters);
  const lastRef = useRef<{ at: number; tokens: number } | null>(null);
  const pendingRef = useRef<{ seconds: number; samples: number } | null>(null);

  useEffect(() => {
    if (!active) {
      lastRef.current = null;
      pendingRef.current = null;
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

    const seconds = beamDurationSeconds(measured);
    if (seconds === duration) {
      pendingRef.current = null;
      return;
    }
    const pending = pendingRef.current;
    if (pending && pending.seconds === seconds) {
      pending.samples += 1;
      if (pending.samples >= BAND_HOLD_SAMPLES) {
        pendingRef.current = null;
        setDuration(seconds);
      }
      return;
    }
    pendingRef.current = { seconds, samples: 1 };
  }, [active, characters, duration]);

  return duration;
}
