"use client";

import { useEffect, useState, type RefObject } from "react";

/** Wrapper padding (20px per side) the dialog has to leave free. */
const DIALOG_MARGIN_PX = 40;
const DIALOG_MAX_HEIGHT_PX = 760;
const DIALOG_MIN_HEIGHT_PX = 160;

/**
 * Max height for a dialog anchored inside the element held by `ref`.
 *
 * The dialogs used `calc(var(--app-viewport-height, 100dvh) - 40px)`, but they
 * are anchored inside the chat panel, which on mobile is far shorter than the
 * visual viewport once the toolbar, composer and software keyboard are laid
 * out — the dialog grew past the panel and its top was clipped away. A
 * percentage max-height against the panel is not dependable either: the
 * wrapper's height chain is not guaranteed definite, and an unresolvable
 * percentage drops the declaration entirely, which lets a huge preview stretch
 * the dialog past the viewport again. Measuring the wrapper keeps the bound
 * honest and follows rotation, the keyboard and panel resizes.
 */
export function useDialogMaxHeight(ref: RefObject<HTMLElement | null>): number | string {
  const [containerHeight, setContainerHeight] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setContainerHeight(node.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  if (containerHeight === null) return `calc(var(--app-viewport-height, 100dvh) - ${DIALOG_MARGIN_PX}px)`;
  return Math.min(DIALOG_MAX_HEIGHT_PX, Math.max(DIALOG_MIN_HEIGHT_PX, containerHeight - DIALOG_MARGIN_PX));
}
