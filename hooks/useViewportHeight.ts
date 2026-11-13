"use client";

import { useEffect } from "react";

/**
 * 水位跟随规则（只服务 data-keyboard-open 标志位）：未聚焦且 1s 内无焦点变化时
 * 跟随当前布局高。否则冻结——聚焦期布局可能被键盘缩小；失焦后 1s 内是边界回涨
 * 的收起动画窗口。必须有这条跟随：启动瞬间可能读到虚高的 clientHeight（如状态
 * 栏挤占生效前），虚高水位会让"布局 < 水位"永远成立，标志位永不消退。
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
 * 本钩子把全高水位写进 --keyboard-full-height，CSS 在键盘期（data-keyboard-open）
 * 把 html/body/.app-shell 钉在这个 px 常量上——文档因此比缩小后的视口多出键盘
 * 那一截，iOS 会按它自己的键盘动画原生滚动 scrollView 把聚焦输入框滚到键盘
 * 上沿，整个页面（含页头）被原生推上去、原生滑回，无任何 JS 动画。
 *
 * 绝不要加 transform/位移去"帮忙"：iOS 按未变换的布局位置算滚动量，壳层一旦
 * 被移走，滚到的窗口下半就是空的——那正是白屏。也绝不要让高度跟随 dvh 缩小：
 * 文档与视口等高，iOS 无处可滚，页头永远钉在顶部。
 *
 * data-keyboard-open 另供键盘期安全区 padding 切换（globals.css）、终端附加键、
 * 新会话项目栏隐藏消费。水位规则：记住上次全高，布局仍矮于水位即视为键盘期（覆盖
 * 收起动画窗口，避免 padding 提前回归造成 composer 小跳）；键盘缩小的布局
 * 永不学为水位（收缩 ~55%，虚高噪声 ~7%），焦点事件与转屏后强制重学，
 * 静止期 1Hz 兑底自愈（挂载瞬间可能读到虚高值且无事件）。
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
