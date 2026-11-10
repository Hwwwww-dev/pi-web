"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps a conditionally-rendered panel mounted through its exit animation:
 * true while `open`, and for `ms` after it closes. Render the panel while
 * this is true and drive its classes with `open` (data-state open/closed),
 * so the closing frame plays tw-animate-css's animate-out instead of the
 * panel vanishing between renders.
 */
export function useDelayedUnmount(open: boolean, ms = 150): boolean {
  const [mounted, setMounted] = useState(open);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (open) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setMounted(true);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setMounted(false);
    }, ms);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, ms]);
  return mounted;
}
