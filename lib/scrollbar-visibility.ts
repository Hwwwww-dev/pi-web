"use client";

/**
 * Overlay scrollbars: the thumb is transparent at rest and fades in while the
 * user actually scrolls, out again shortly after. WebKit's scrollbar
 * pseudo-elements ignore transitions, so the fade is driven by hand: each lit
 * container carries `--sb-alpha`, which the thumb reads as its color strength,
 * and one rAF loop ramps it between 0 and 1 over 400ms.
 *
 * macOS semantics: a bar lights only when a real user gesture scrolls THAT
 * container. Two failed designs fixed here:
 * 1) revealing on scroll events alone — streaming's resize-observer tail
 *    follow and jump-to-bottom are programmatic scrolls whose events fire
 *    every tick, so bars never dimmed;
 * 2) revealing gesture event paths (plus hover) — sweeping the mouse across
 *    the page lit every scrollable it crossed and one wheel tick lit a whole
 *    nested chain: "everything shows".
 *
 * The gesture listeners only stamp a timestamp; the scroll listener reveals
 * `event.target` — exactly the container that moved — when the stamp is
 * fresh. Programmatic scrolling carries no gesture stamp and never lights.
 */
const HIDE_DELAY_MS = 700;
/** 亮起要快（手势即刻反馈）；淡出保留慢节奏。 */
const FADE_IN_MS = 120;
const FADE_OUT_MS = 400;
/** Wheel/keys: momentumless, so a short window suffices. */
const WHEEL_SCROLL_WINDOW_MS = 200;
/** Touch: momentum scrolling continues after the last touchmove. */
const TOUCH_SCROLL_WINDOW_MS = 1200;

let installed = false;

function fadeAlpha(element: HTMLElement): number {
  const value = element.style.getPropertyValue("--sb-alpha");
  return value === "" ? 0 : Number(value) || 0;
}

type Fade = {
  element: HTMLElement;
  from: number;
  to: number;
  start: number;
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

export function installGlobalScrollbarVisibility(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const fades = new Map<HTMLElement, Fade>();
  let frame = 0;

  const tick = (now: number) => {
    frame = 0;
    for (const [element, fade] of fades) {
      const duration = fade.to === 0 ? FADE_OUT_MS : FADE_IN_MS;
      const progress = Math.min(1, (now - fade.start) / duration);
      const alpha = fade.from + (fade.to - fade.from) * easeInOut(progress);
      if (progress >= 1) {
        if (fade.to === 0) {
          element.style.removeProperty("--sb-alpha");
          fades.delete(element);
          continue;
        }
        element.style.setProperty("--sb-alpha", "1");
        fades.delete(element);
        continue;
      }
      element.style.setProperty("--sb-alpha", alpha.toFixed(3));
    }
    if (fades.size > 0) frame = requestAnimationFrame(tick);
  };

  const animate = (element: HTMLElement, target: number) => {
    const current = fadeAlpha(element);
    if (current === target && !fades.has(element)) return;
    fades.set(element, { element, from: current, to: target, start: performance.now() });
    if (frame === 0) frame = requestAnimationFrame(tick);
  };

  const marked = new Set<HTMLElement>();
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const hideAll = () => {
    hideTimer = null;
    for (const element of marked) {
      element.classList.remove("scrollbar-visible");
      animate(element, 0);
    }
    marked.clear();
  };

  const reveal = (elements: Element[]) => {
    if (elements.length === 0) return;
    if (hideTimer !== null) clearTimeout(hideTimer);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      element.classList.add("scrollbar-visible");
      animate(element, 1);
      marked.add(element);
    }
    hideTimer = setTimeout(hideAll, HIDE_DELAY_MS);
  };

  let lastGestureAt = 0;
  let gestureWindowMs = WHEEL_SCROLL_WINDOW_MS;
  const markGesture = (windowMs: number) => {
    lastGestureAt = performance.now();
    gestureWindowMs = windowMs;
  };

  document.addEventListener("wheel", () => markGesture(WHEEL_SCROLL_WINDOW_MS), { capture: true, passive: true });
  document.addEventListener("touchmove", () => markGesture(TOUCH_SCROLL_WINDOW_MS), { capture: true, passive: true });

  // 键盘滚动容器（焦点内的方向键/翻页/空格）。主输入框打字不经过这里。
  const SCROLL_KEYS = new Set([
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "PageUp", "PageDown", "Home", "End", " ",
  ]);
  document.addEventListener(
    "keydown",
    (event) => {
      if (SCROLL_KEYS.has(event.key)) markGesture(WHEEL_SCROLL_WINDOW_MS);
    },
    { capture: true, passive: true },
  );

  // scroll 事件的 target 就是真正滚动的那一个容器；只有伴随真实手势才点亮。
  document.addEventListener(
    "scroll",
    (event) => {
      if (performance.now() - lastGestureAt > gestureWindowMs) return;
      const target = event.target;
      if (target instanceof HTMLElement) reveal([target]);
    },
    { capture: true, passive: true },
  );
}
