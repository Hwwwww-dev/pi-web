"use client";

import { useEffect, useState } from "react";
import { loadPrismLanguages, prismLanguagesLoaded } from "@/lib/prism-languages";

/**
 * True once the code's language is registered into the shared refractor core
 * (lib/prism-languages.ts). While `enabled` and a language is named, a
 * highlighter mounting before that starts the load and renders again when it
 * is done; until then it should render its code as plain text. Baseline
 * languages (refractor's common build) are registered from the start.
 */
export function usePrismLanguages(language: string | undefined, enabled = true): boolean {
  const loaded = prismLanguagesLoaded(language);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (loaded || !enabled || !language) return;
    let active = true;
    loadPrismLanguages(language).then(
      () => { if (active && prismLanguagesLoaded(language)) setReady(true); },
      () => { /* Stays plain text; the next highlighter to mount retries. */ },
    );
    return () => { active = false; };
  }, [enabled, language, loaded]);
  return ready || loaded;
}
