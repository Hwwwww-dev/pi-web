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
 *
 * Children marked `data-scroll-anchor-ignore` are skipped. The list's own
 * controls sit at the top of that content — the "load earlier" row above all —
 * and they never move when a page is prepended, so anchoring on one would report
 * a delta of zero while the reader's actual row slid thousands of pixels.
 */
export function captureScrollAnchor(container: HTMLElement, content: HTMLElement | null): ScrollAnchor | null {
  if (!content) return null;
  const containerTop = container.getBoundingClientRect().top;
  for (const child of Array.from(content.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.hasAttribute("data-scroll-anchor-ignore")) continue;
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
/** 按住一行：连续这么久没再移动就算长完了。 */
const HOLD_IDLE_MS = 400;
/** 按住一行的硬上限：一直长不完（流式输出）也不能把读者铉住。 */
const HOLD_MAX_MS = 4000;

/**
 * Hold the reader's row in place while a prepend settles.
 *
 * The row is picked and re-picked by its `data-entry-id`, not by node identity:
 * a prepend re-renders the list, and a row held by reference would go stale the
 * moment React replaced its wrapper. The row's absolute viewport position is the
 * baseline — measured against the container's own rect it can report zero while
 * the content underneath slides, which is exactly what made an earlier version
 * look like it did nothing.
 *
 * Every frame the row is looked up again and the scroll offset corrected, because
 * the prepended page keeps growing after the first frame (markdown, Prism colors,
 * images reporting their size). Without that, the reader drifts back to the top —
 * where the sentinel sits, so one upward gesture reads page after page.
 *
 * It lets go on a deliberate scroll (wheel, touch, key) and after
 * `SCROLL_ANCHOR_SETTLE_MS`, so the reader is never held hostage by it.
 */
export function holdScrollAnchor(container: HTMLElement, content: HTMLElement | null): () => void {
  const pick = () => {
    if (!content) return null;
    const containerTop = container.getBoundingClientRect().top;
    for (const row of Array.from(content.querySelectorAll<HTMLElement>("[data-entry-id]"))) {
      if (row.hasAttribute("data-scroll-anchor-ignore")) continue;
      if (row.getBoundingClientRect().bottom > containerTop) return row;
    }
    return null;
  };
  const first = pick();
  const entryId = first?.getAttribute("data-entry-id");
  if (!first || !entryId) return () => {};
  // 这一行原来的位置。每一帧都朝它校正，所以它本身不再变。
  const baseline = first.getBoundingClientRect().top;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    container.removeEventListener("wheel", stop);
    container.removeEventListener("touchstart", stop);
    container.removeEventListener("keydown", stop);
  };
  // 追加的一页不是一帧就长完的：接着每帧重测这名行，直到它连续几帧不再移动。
  // 固定时长的版本会在还没长完时就撒手，读者于是又漂回去一截。
  const startedAt = Date.now();
  let lastMove = startedAt;
  const keep = () => {
    if (stopped) return;
    const row = content?.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
    if (!row) {
      stop();
      return;
    }
    const delta = row.getBoundingClientRect().top - baseline;
    if (Math.abs(delta) > 0.5) {
      container.scrollTop += delta;
      lastMove = Date.now();
    }
    if (Date.now() - lastMove > HOLD_IDLE_MS || Date.now() - startedAt > HOLD_MAX_MS) {
      stop();
      return;
    }
    requestAnimationFrame(keep);
  };
  container.addEventListener("wheel", stop, { passive: true });
  container.addEventListener("touchstart", stop, { passive: true });
  container.addEventListener("keydown", stop);
  requestAnimationFrame(keep);
  return stop;
}
