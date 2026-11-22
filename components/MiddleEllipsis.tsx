"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How many characters of the end stay visible, extension included. */
const MIN_TAIL_CHARS = 10;

/**
 * Where a name loses its middle instead of its end.
 *
 * A file pill shrunk by CSS `truncate` gives `foo.co…`: the extension, the one
 * part that says what the file is, goes first. This keeps the whole tail (the
 * extension plus the last path segment's end) and cuts the front, which reads
 * the same for CJK names — unlike the `direction: rtl` trick, it does not
 * reverse punctuation.
 *
 * The cut is measured, not guessed: the browser lays the string out once to
 * learn the available width, then a canvas with the element's own font finds
 * the longest head that still fits. No DOM thrash, no per-frame reflow.
 */
export function MiddleEllipsis({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState(text);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const context = document.createElement("canvas").getContext("2d");
    // No canvas (an exotic embedder) is no reason to hide the name: the CSS
    // fallback below ellipses the end as every other row does.
    if (!context) {
      setLabel(text);
      return;
    }
    const fit = () => {
      const width = element.clientWidth;
      if (width <= 0) return;
      context.font = getComputedStyle(element).font;
      const measure = (value: string) => context.measureText(value).width;
      if (measure(text) <= width) {
        setLabel(text);
        return;
      }
      const extension = /\.[^./\\]{1,8}$/.exec(text)?.[0] ?? "";
      const tailLength = Math.min(text.length, Math.max(extension.length + 8, MIN_TAIL_CHARS));
      const tail = text.slice(-tailLength);
      const headBudget = text.length - tailLength;
      let low = 0;
      let high = headBudget;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (measure(`${text.slice(0, middle)}…${tail}`) <= width) low = middle;
        else high = middle - 1;
      }
      // Not even `…<tail>` fits: hand the whole job to the CSS fallback.
      setLabel(low > 0 ? `${text.slice(0, low)}…${tail}` : text);
    };
    fit();
    // A window resize or a wider column changes the answer without a re-render.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}>
      {label}
    </span>
  );
}
