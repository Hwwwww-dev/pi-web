/**
 * Keeping the reader's place while messages are inserted above them.
 *
 * A page of older messages is prepended, and a scroll container only knows
 * `scrollTop` — so the browser keeps the *pixel* offset and the text the user
 * was reading slides down by the height of the new rows. Restoring by
 * `scrollHeight` delta fixes the first frame and then drifts: markdown expands,
 * Prism colors a fence, an image reports its size, and every one of those grows
 * the rows above after the restore has already run.
 *
 * So the anchor is an *element*: remember the row at the viewport's top edge and
 * how far its top sits from it, then keep re-measuring that same row. Whatever
 * happens above it, the row stays where it was.
 */

export interface ScrollAnchor {
  /** The row at the top edge; stays the same DOM node across a re-render. */
  element: HTMLElement;
  /** Its distance from the container's top edge when captured (negative when partly scrolled past). */
  top: number;
}

/**
 * The row the reader is looking at: the first child whose bottom edge is still
 * below the container's top. Rows are the message list's own children.
 */
export function captureScrollAnchor(container: HTMLElement, content: HTMLElement | null): ScrollAnchor | null {
  if (!content) return null;
  const containerTop = container.getBoundingClientRect().top;
  for (const child of Array.from(content.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const rect = child.getBoundingClientRect();
    if (rect.bottom > containerTop) return { element: child, top: rect.top - containerTop };
  }
  return null;
}

/** Put the anchored row back where it was; a no-op once it has left the DOM. */
export function applyScrollAnchor(container: HTMLElement, anchor: ScrollAnchor): void {
  if (!anchor.element.isConnected) return;
  const containerTop = container.getBoundingClientRect().top;
  const currentTop = anchor.element.getBoundingClientRect().top - containerTop;
  const delta = currentTop - anchor.top;
  if (delta !== 0) container.scrollTop += delta;
}

/** How long content above the anchor may keep changing height before we stop chasing it. */
export const SCROLL_ANCHOR_SETTLE_MS = 800;

/**
 * Hold an anchor in place every frame until the content above it settles.
 *
 * One application is not enough after a prepend: the new rows grow for several
 * frames (markdown, Prism colors, images reporting their size), and each growth
 * above the anchor pushes it back down. Chasing it frame by frame keeps the
 * reader on the row they were reading, which is also what stops a session that
 * opens at the top from reading page after page in one gesture — the top edge
 * stays where the prepend left it instead of crawling back to zero.
 *
 * It lets go on a deliberate scroll (wheel, touch, key) and after
 * `SCROLL_ANCHOR_SETTLE_MS`, so the reader can never be held hostage by it.
 */
export function holdScrollAnchor(container: HTMLElement, anchor: ScrollAnchor | null): () => void {
  if (!anchor) return () => {};
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    container.removeEventListener("wheel", stop);
    container.removeEventListener("touchstart", stop);
    container.removeEventListener("keydown", stop);
  };
  const keep = () => {
    if (stopped) return;
    if (!anchor.element.isConnected) {
      stop();
      return;
    }
    applyScrollAnchor(container, anchor);
    requestAnimationFrame(keep);
  };
  const timer = window.setTimeout(stop, SCROLL_ANCHOR_SETTLE_MS);
  container.addEventListener("wheel", stop, { passive: true });
  container.addEventListener("touchstart", stop, { passive: true });
  container.addEventListener("keydown", stop);
  requestAnimationFrame(keep);
  return stop;
}
