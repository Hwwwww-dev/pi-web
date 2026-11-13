"use client";

import { useEffect } from "react";

/**
 * How far the shell has to slide up for its bottom edge to sit on the visible
 * viewport: the rendered shell height minus what the keyboard hides. The pan
 * counts separately: `visualViewport.offsetTop` grows when iOS shifts the
 * visible part down to reveal the focused field, and that shift already moved
 * the shell, so counting it twice would overshoot. Measuring the shell itself
 * keeps every platform correct — iOS standalone keeps 100dvh at the full
 * height while the keyboard covers it, Android's resizes-content already
 * shrank both, and an installed app's bottom bar leaves a few pixels.
 */
export function viewportInset({ shellHeight, visibleHeight, pan = 0 }: { shellHeight: number; visibleHeight: number; pan?: number }): number {
  return Math.max(0, Math.round(shellHeight - visibleHeight - pan));
}

/** Below this the visual viewport moved for its own reasons — collapsing
 * browser chrome, a scroll gesture — not because a keyboard opened. */
const KEYBOARD_MIN_INSET = 80;

interface KeyboardLayoutState {
  open: boolean;
  inset: number;
  pan: number;
  visibleHeight: number;
}

/**
 * Writes the keyboard layout onto :root, skipping writes that change nothing:
 * the keyboard animation streams one resize event per frame, and each write
 * invalidates style.
 */
function writeKeyboardLayout(root: HTMLElement, state: KeyboardLayoutState, next: KeyboardLayoutState): void {
  if (next.inset !== state.inset) {
    state.inset = next.inset;
    if (next.inset === 0) root.style.removeProperty("--keyboard-inset");
    else root.style.setProperty("--keyboard-inset", `${next.inset}px`);
  }
  if (next.pan !== state.pan) {
    state.pan = next.pan;
    if (next.pan === 0) root.style.removeProperty("--keyboard-pan");
    else root.style.setProperty("--keyboard-pan", `${next.pan}px`);
  }
  if (next.visibleHeight !== state.visibleHeight) {
    state.visibleHeight = next.visibleHeight;
    if (next.visibleHeight === 0) root.style.removeProperty("--app-viewport-height");
    else root.style.setProperty("--app-viewport-height", `${next.visibleHeight}px`);
  }
  if (next.open !== state.open) {
    state.open = next.open;
    if (next.open) root.dataset.keyboardOpen = "true";
    else delete root.dataset.keyboardOpen;
  }
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
    // Last written values, so a per-frame resize pass does not invalidate style
    // when nothing changed.
    const layoutState: KeyboardLayoutState = { open: false, inset: 0, pan: 0, visibleHeight: 0 };

    const update = () => {
      frameId = null;
      const visibleHeight = Math.min(document.documentElement.clientHeight, viewport.height);
      // 采用壳层实际渲染高度而非 100dvh / clientHeight：壳层高度即布局真值，
      // 位移量为壳层高度与可视高度之差。键盘、底部工具条、PWA 状态栏均由该值覆盖。
      const shell = document.querySelector<HTMLElement>(".app-shell");
      const shellHeight = shell?.getBoundingClientRect().height ?? document.documentElement.clientHeight;
      const typing = hasFocusedEditableElement() && Math.abs(viewport.scale - 1) < 0.01;
      // iOS reports a short height mid-animation while it pans further down to
      // reveal the focused field; the pan cancels that dip, so the inset tracks
      // the keyboard instead of dipping and snapping back.
      const covered = viewportInset({ shellHeight, visibleHeight, pan: viewport.offsetTop });
      const inset = typing && covered > KEYBOARD_MIN_INSET ? covered : 0;
      writeKeyboardLayout(root, layoutState, {
        open: inset > 0,
        inset,
        pan: inset > 0 ? Math.round(viewport.offsetTop) : 0,
        visibleHeight,
      });

      const pageWasShifted = window.scrollX !== 0 || window.scrollY !== 0;
      const isUnscaled = Math.abs(viewport.scale - 1) < 0.01;
      if (pageWasShifted && isUnscaled) {
        window.scrollTo(0, 0);
      }
    };

    // WebKit can dispatch the resize event before visualViewport.height has
    // settled, especially when an installed PWA dismisses the keyboard. Reading
    // it on the next animation frame prevents the keyboard-height CSS value
    // from remaining after the keyboard has closed. The keyboard's own animation
    // streams resize events frame by frame, so each one also applies straight
    // away: waiting for a frame would lag a frame behind the keyboard all the
    // way down, which reads as judder.
    const scheduleUpdate = () => {
      update();
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

    // IME candidate bars can resize the keyboard without any visualViewport
    // event; restarting the focus poll from input activity covers those.
    const onEditableActivity = () => {
      if (!hasFocusedEditableElement()) return;
      startKeyboardPoll();
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
    document.addEventListener("compositionstart", onEditableActivity);
    document.addEventListener("compositionupdate", onEditableActivity);
    document.addEventListener("compositionend", onEditableActivity);
    document.addEventListener("input", onEditableActivity);
    document.addEventListener("keyup", onEditableActivity);

    return () => {
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("pageshow", scheduleUpdate);
      document.removeEventListener("compositionstart", onEditableActivity);
      document.removeEventListener("compositionupdate", onEditableActivity);
      document.removeEventListener("compositionend", onEditableActivity);
      document.removeEventListener("input", onEditableActivity);
      document.removeEventListener("keyup", onEditableActivity);
      stopKeyboardPoll();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--keyboard-pan");
    };
  }, []);
}
