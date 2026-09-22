"use client";

import { useEffect } from "react";

interface ViewportHeightState {
  hasFocusedEditable: boolean;
  /** Tallest on-screen viewport height seen so far, i.e. the no-keyboard height. */
  fullHeight: number;
  /** Current on-screen viewport height. */
  visibleHeight: number;
  viewportScale: number;
}

export function shouldUseVisualViewportHeight({
  hasFocusedEditable,
  fullHeight,
  visibleHeight,
  viewportScale,
}: ViewportHeightState): boolean {
  const isUnscaled = Math.abs(viewportScale - 1) < 0.01;
  // iOS PWAs shrink window.innerHeight, documentElement.clientHeight, and
  // visualViewport.height together when the keyboard opens, so a live delta
  // between any two of them is always ~0 and never fires. Comparing against
  // the tallest height observed with no keyboard open is the only signal that
  // survives. Android with interactive-widget=resizes-content shrinks the
  // layout viewport itself and needs no override; its visible height equals
  // its full height there, so this check stays false as well.
  return hasFocusedEditable && isUnscaled && fullHeight - visibleHeight > 1;
}

function hasFocusedEditableElement(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  return activeElement.isContentEditable
    || activeElement.tagName === "INPUT"
    || activeElement.tagName === "SELECT"
    || activeElement.tagName === "TEXTAREA";
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable
      || target.tagName === "INPUT"
      || target.tagName === "TEXTAREA");
}

/**
 * Keep the app height aligned with the visual viewport while a mobile keyboard
 * is open. iOS standalone PWAs can leave 100dvh at the layout viewport height,
 * which puts the composer behind the keyboard and may scroll the page itself.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let frameId: number | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    // High-water mark of the on-screen viewport height: the no-keyboard height.
    let fullHeight = 0;

    const update = () => {
      frameId = null;
      const visibleHeight = Math.min(document.documentElement.clientHeight, viewport.height);
      if (visibleHeight > fullHeight) fullHeight = visibleHeight;
      const keyboardOpen = shouldUseVisualViewportHeight({
        hasFocusedEditable: hasFocusedEditableElement(),
        fullHeight,
        visibleHeight,
        viewportScale: viewport.scale,
      });
      if (keyboardOpen) {
        root.style.setProperty("--app-viewport-height", `${visibleHeight}px`);
      } else {
        root.style.removeProperty("--app-viewport-height");
      }

      const pageWasShifted = window.scrollX !== 0 || window.scrollY !== 0;
      const isUnscaled = Math.abs(viewport.scale - 1) < 0.01;
      if (pageWasShifted && isUnscaled) {
        window.scrollTo(0, 0);
      }
    };

    // WebKit can dispatch the resize event before visualViewport.height has
    // settled, especially when an installed PWA dismisses the keyboard. Reading
    // it on the next animation frame prevents the keyboard-height CSS value
    // from remaining after the keyboard has closed.
    const scheduleUpdate = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(update);
    };

    // iOS PWAs can settle the keyboard layout without ever dispatching the
    // trailing visualViewport events, so nothing recomputes until the next
    // user gesture shifts the viewport. Poll briefly after an editable gains
    // focus: the keyboard animation finishes within ~300ms, so a few checks
    // catch the shrunken viewport without waiting for events that may never come.
    const stopKeyboardPoll = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const startKeyboardPoll = () => {
      stopKeyboardPoll();
      let checks = 0;
      pollTimer = setInterval(() => {
        scheduleUpdate();
        if (++checks >= 12) stopKeyboardPoll();
      }, 50);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isEditableTarget(event.target)) startKeyboardPoll();
      scheduleUpdate();
    };
    const handleFocusOut = () => {
      stopKeyboardPoll();
      scheduleUpdate();
    };

    scheduleUpdate();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    window.addEventListener("pageshow", scheduleUpdate);

    return () => {
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("pageshow", scheduleUpdate);
      stopKeyboardPoll();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);
}
