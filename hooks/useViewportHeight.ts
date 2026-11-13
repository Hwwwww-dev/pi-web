"use client";

import { useEffect } from "react";

/**
 * 水位跟随规则：未聚焦且 1s 内无焦点变化时跟随当前布局高。否则冻结——
 * 聚焦期布局可能被键盘缩小；失焦后 1s 内是边界回涨的收起动画窗口。
 * 必须有这条跟随：启动瞬间可能读到虚高的 clientHeight（如状态栏挤占生效前），
 * 虚高水位会让"布局 < 水位"永远成立，键盘期永远退不出来——高度钉住摘不掉、
 * 文档多出一段滚动量，顶栏被推走回不来、输入框沉底。
 */
export function nextFullHeight({
  fullHeight,
  layoutHeight,
  focused,
  recentlyFocused,
}: {
  fullHeight: number;
  layoutHeight: number;
  focused: boolean;
  recentlyFocused: boolean;
}): number {
  // 0 = 未知（首次/转屏后重学）：无条件采用当前布局高。
  if (fullHeight === 0) return layoutHeight;
  // 键盘缩小的布局永远不配当水位：键盘收缩幅度 ~55%，虚高噪声 ~7%。若把缩小的
  // 383 学成水位，钉高塌到 383，滚动量归零——顶栏推不出去且闪（焦点被 IME/附件
  // 栏瞬时吃掉时真的会发生）。只跟随“未聚焦 + 1s 内无焦点事件 + 幅度 <30%”的静止变化。
  if (!focused && !recentlyFocused && layoutHeight >= Math.round(fullHeight * 0.7)) {
    return layoutHeight;
  }
  return fullHeight;
}

/** 键盘期判定：聚焦中，或布局仍比全高水位矮（收起动画未结束）。 */
export function isKeyboardPeriod({
  layoutHeight,
  fullHeight,
  focused,
}: {
  layoutHeight: number;
  fullHeight: number;
  focused: boolean;
}): boolean {
  return focused || layoutHeight < fullHeight - 1;
}

function isEditableElement(element: Element | null): boolean {
  return element instanceof HTMLElement
    && (element.isContentEditable
      || element.tagName === "INPUT"
      || element.tagName === "TEXTAREA"
      || element.tagName === "SELECT");
}

/**
 * iOS standalone PWA 的键盘会直接缩小 WKWebView 边界（clientHeight 844→508）。
 * 本钩子只做一件事：把全高水位写进 --keyboard-full-height，CSS 在键盘期
 * （data-keyboard-open）把 html/body/.app-shell 钉在这个 px 常量上——文档因此
 * 比缩小后的视口多出键盘那一截，iOS 会按它自己的键盘动画原生滚动 scrollView
 * 把聚焦输入框滚到键盘上沿，整个页面（含页头）被原生推上去、原生滑回。
 *
 * 绝不要加 transform/位移去"帮忙"：iOS 按未变换的布局位置算滚动量，壳层一旦
 * 被移走，滚到的窗口下半就是空的——那就是白屏。也绝不要让高度跟随 dvh 缩小
 * （文档与视口等高，iOS 无处可滚，页头永远钉在顶部）。
 *
 * Safari 普通标签页与桌面端布局不缩：水位恒等于当前高，属性只在聚焦时短暂
 * 存在，无任何视觉效果。
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    // 0 = 未知：第一次静止同步立即跟随真实布局高，不用挂载瞬间的可能虚高值。
    let fullHeight = 0;
    let lastFocusAt = -Infinity;
    let frame = 0;

    const sync = () => {
      frame = 0;
      const layoutHeight = root.clientHeight;
      const focused = isEditableElement(document.activeElement);
      const recentlyFocused = Date.now() - lastFocusAt < 1000;
      const keyboardPeriod = isKeyboardPeriod({
        layoutHeight,
        fullHeight,
        focused,
      });
      fullHeight = nextFullHeight({
        fullHeight,
        layoutHeight,
        focused,
        recentlyFocused,
      });
      root.style.setProperty("--keyboard-full-height", `${fullHeight}px`);
      if (keyboardPeriod || focused) root.dataset.keyboardOpen = "true";
      else delete root.dataset.keyboardOpen;
    };

    const scheduleSync = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const handleFocusChange = () => {
      lastFocusAt = Date.now();
      scheduleSync();
    };
    const handleOrientationChange = () => {
      // 转屏后旧水位必然失真，置 0 强制重学（键盘开着转屏也走这里）。
      fullHeight = 0;
      scheduleSync();
    };

    sync();
    window.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);
    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("pageshow", scheduleSync);
    // 静止期水位自愈：启动早期布局变化（状态栏挤占生效前后）不发 resize 事件，
    // 没有事件就不重测——虚高水位会卡到下次聚焦为止。1Hz 兑底，rAF 去重 + 死区，代价可忽略。
    const restHealTimer = window.setInterval(scheduleSync, 1000);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("pageshow", scheduleSync);
      window.clearInterval(restHealTimer);
      root.style.removeProperty("--keyboard-full-height");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
