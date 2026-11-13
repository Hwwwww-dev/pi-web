"use client";

/**
 * Overlay scrollbars: the thumb is transparent at rest and fades in while the
 * user actually scrolls (wheel/touch/scroll keys) or hovers its container.
 * WebKit's scrollbar pseudo-elements ignore transitions,
 * so the fade is driven by hand: each visible container carries `--sb-alpha`,
 * which the thumb reads as its color strength, and one rAF loop ramps it
 * between 0 and 1. A container stays lit while it scrolls or sits under the
 * pointer, and dims shortly after the last of either, over 400ms.
 */
const HIDE_DELAY_MS = 700;
const FADE_MS = 400;

let installed = false;

const scrollableCache = new WeakSet<Element>();

function isScrollable(element: Element): boolean {
  if (scrollableCache.has(element)) return true;
  let result = false;
  if (element instanceof HTMLElement) {
    const style = getComputedStyle(element);
    const scrollsY = style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "overlay";
    const scrollsX = style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowX === "overlay";
    result =
      (scrollsY && element.scrollHeight > element.clientHeight + 1) ||
      (scrollsX && element.scrollWidth > element.clientWidth + 1);
  }
  if (result) scrollableCache.add(element);
  return result;
}

function fadeAlpha(element: HTMLElement): number {
  const value = element.style.getPropertyValue("--sb-alpha");
  return value === "" ? 0 : Number(value) || 0;
}

const isScrollableElement = (node: EventTarget | Element): node is Element =>
  node instanceof Element && isScrollable(node);

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
      const progress = Math.min(1, (now - fade.start) / FADE_MS);
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

  // 只认真实用户手势，不监听 scroll：流式输出的 RO 贴尾跟随、发消息后的跳底
  // 都是程序化滚动，会每个 tick 触发 reveal，把滚动条永远点亮（用户没滚，
  // 滚动条却一直亮）。滚轮/触摸/翻页键/悬停才亮。
  document.addEventListener(
    "wheel",
    (event) => {
      if (event.target instanceof Element) reveal(event.composedPath().filter(isScrollableElement).slice(0, 3));
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.target instanceof Element) reveal(event.composedPath().filter(isScrollableElement).slice(0, 3));
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
      if (!SCROLL_KEYS.has(event.key) || !(event.target instanceof Element)) return;
      reveal(event.composedPath().filter(isScrollableElement).slice(0, 3));
    },
    { capture: true, passive: true },
  );

  // Hover keeps a container's bar up without waiting for a scroll. pointerover
  // fires on element-boundary crossings, so this costs a few style reads per
  // crossing rather than one per pixel of movement.
  document.addEventListener(
    "pointerover",
    (event) => {
      const scrollable = event
        .composedPath()
        .filter((node): node is Element => node instanceof Element && isScrollable(node))
        .slice(0, 3);
      reveal(scrollable);
    },
    { capture: true, passive: true },
  );
}
