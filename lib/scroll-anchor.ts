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
  for (const child of content.children) {
    if (!(child instanceof HTMLElement)) continue;
    // A virtual window's spacer is not a row: its height stands for turns that
    // are not in the DOM.
    if (child.dataset.spacer) continue;
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
