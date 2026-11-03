/**
 * True only where the pointer can actually hover (a mouse/trackpad). Touch
 * devices fire a synthetic `mouseenter` on tap and never deliver
 * `mouseleave`, so JS-painted hover backgrounds would latch until the next
 * tap elsewhere. Handlers that paint hover styles check this first; the
 * return value is stable for the page's lifetime, so handlers may call it
 * per event.
 */
export function canHover(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: hover)").matches;
}
