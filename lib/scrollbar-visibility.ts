"use client";

/**
 * Overlay scrollbars: the thumb is transparent at rest, appears in one step the
 * moment a real user gesture starts (before the content moves), and is gone
 * again 3s after the scrolling stops. WebKit's scrollbar pseudo-elements ignore
 * transitions and repaint lazily while the compositor scrolls, so the alpha is
 * not animated in — a lit container carries `--sb-alpha: 1` (the thumb reads it
 * as its color strength) and only the final fade-out, 180ms, runs on rAF.
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
const HIDE_DELAY_MS = 3000;
/** 淡出只是收尾，不靠它做“亮起”，所以短一点。 */
const FADE_OUT_MS = 180;
/** Wheel/keys: momentumless, so a short window suffices. */
const WHEEL_SCROLL_WINDOW_MS = 200;
/** Touch: momentum scrolling continues after the last touchmove. */
const TOUCH_SCROLL_WINDOW_MS = 1200;

let installed = false;

/** 淡出用 ease-out：起手就走了大半，尾巴拖得轻。 */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function installGlobalScrollbarVisibility(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  /** 正在淡出的容器 → 起始时间。亮起不进入这里：它是一步到位的。 */
  const fades = new Map<HTMLElement, number>();
  let frame = 0;

  const tick = (now: number) => {
    frame = 0;
    for (const [element, start] of fades) {
      const progress = Math.min(1, (now - start) / FADE_OUT_MS);
      if (progress >= 1) {
        element.style.removeProperty("--sb-alpha");
        fades.delete(element);
        continue;
      }
      element.style.setProperty("--sb-alpha", (1 - easeOut(progress)).toFixed(3));
    }
    if (fades.size > 0) frame = requestAnimationFrame(tick);
  };

  const marked = new Set<HTMLElement>();
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const hideAll = () => {
    hideTimer = null;
    for (const element of marked) {
      element.classList.remove("scrollbar-visible");
      fades.set(element, performance.now());
    }
    marked.clear();
    if (fades.size > 0 && frame === 0) frame = requestAnimationFrame(tick);
  };

  /**
   * 手势起点最近的可滚动祖先：滚动条必须在内容开始移动之前就亮，不能等到 scroll
   * 事件（WebKit 在合成器滚动期间对滚动条伪元素的重绘是惰性的，等 scroll 来了再
   * 把 alpha 从 0 推上去，常常要到手指/滚轮停下才真正画出来）。只取**最近的一个**，
   * 不沿链条全部点亮。
   */
  const nearestScrollable = (from: EventTarget | null): Element[] => {
    let node = from instanceof Element ? from : null;
    while (node) {
      if (node instanceof HTMLElement && node.scrollHeight - node.clientHeight > 1) return [node];
      node = node.parentElement;
    }
    return [];
  };

  const reveal = (elements: Element[]) => {
    if (elements.length === 0) return;
    if (hideTimer !== null) clearTimeout(hideTimer);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      // 一步到位，不做淡入：滚动期间的这条重绘 WebKit 是惰性的，分几帧往上推
      // 常常要等滚动停下才真的画出来（"滑着看不见、停下才出现"）。
      element.classList.add("scrollbar-visible");
      fades.delete(element);
      element.style.setProperty("--sb-alpha", "1");
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

  document.addEventListener(
    "wheel",
    (event) => {
      markGesture(WHEEL_SCROLL_WINDOW_MS);
      reveal(nearestScrollable(event.target));
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      markGesture(TOUCH_SCROLL_WINDOW_MS);
      reveal(nearestScrollable(event.target));
    },
    { capture: true, passive: true },
  );

  // 键盘滚动容器（焦点内的方向键/翻页/空格）。主输入框打字不经过这里。
  const SCROLL_KEYS = new Set([
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "PageUp", "PageDown", "Home", "End", " ",
  ]);
  document.addEventListener(
    "keydown",
    (event) => {
      if (!SCROLL_KEYS.has(event.key)) return;
      markGesture(WHEEL_SCROLL_WINDOW_MS);
      reveal(nearestScrollable(document.activeElement));
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
