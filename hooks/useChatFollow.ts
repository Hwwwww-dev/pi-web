"use client";

/**
 * 会话列表贴底跟随状态机（从 components/ChatWindow.tsx 原位抽出，契约见
 * lib/chat-follow.ts）：`atTail` 是唯一的跟随信号，官方 scroller 以
 * `autoScroll={false}` 运行，贴底跟随、完成时刻的保持都只消费这一个状态。
 *
 * - 贴底判定：距底 ≤ CHAT_TAIL_TOLERANCE 即贴底；滚轮向上累计 ≥
 *   WHEEL_LEAVE_THRESHOLD_PX、触摸上滑 > 6px、ArrowUp·PageUp·Home 到达即
 *   脱离（手势压制）。触控板单帧几个 px 的负 delta 属噪声，不再误杀跟随。
 * - 程序化滚动（跟随回写、折叠保位、浏览器钳制）不参与意图判定，状态按
 *   几何位置自愈。
 * - 带内回挂：压制期间滚轮向下 ≥ 6px、触摸下拉 > 6px 且几何仍在带内 →
 *   立即解除压制重挂跟随。否则带内脱离后滚回底部既无按钮也不跟随，
 *   读者须先滚出距离带再滚回来才有一条活路。
 * - **收缩保位**：非跟随态下内容缩短（完成重组、行折叠）时，浏览器钳制会把
 *   读者拉向尾端；这里按收缩量回退 scrollTop，读者距底距离不变，且本次事件
 *   不做贴底重算、不解除压制——钳制不会被误读成"用户滚回尾部"（完成时刻
 *   强行跳底的根因）。
 * - reattachToTail()：回底按钮与发送后贴底的入口——解除压制并置贴底；调用方
 *   随后自行滚动，飞行中与之后的内容增长由 FollowTailWhenAtTail 即时校正到真底。
 * - 压制/跟随状态存于组件级 ref：`loading` 翻转重建监听时不丢压制，只有会话
 *   切换（sessionKey 变化）才整体重置。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createWheelGesture, isAtTail } from "@/lib/chat-follow";

interface FollowState {
  suppressed: boolean;
  following: boolean;
  wasInBand: boolean;
  touching: boolean;
  lastDistance: number;
}

function initialFollowState(distance: number): FollowState {
  return { suppressed: false, following: true, wasInBand: true, touching: false, lastDistance: distance };
}

export function useChatFollow(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  sessionKey: string | undefined,
  loading: boolean,
) {
  const [atTail, setAtTail] = useState(true);
  const reattachRef = useRef<() => void>(() => {});
  const followStateRef = useRef<FollowState>(initialFollowState(0));
  // 跨事件记忆上次 scrollHeight（判定收缩）。
  const lastScrollHeightRef = useRef(0);
  const lastSessionKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const readDistance = () => Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
    // 会话切换整体重置；loading 翻转只重建监听，压制不丢（否则加载完成瞬间
    // 上一会话读史中的压制被静默清零）。
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey;
      followStateRef.current = initialFollowState(readDistance());
    }
    lastScrollHeightRef.current = container.scrollHeight;
    const state = followStateRef.current;
    const gesture = createWheelGesture();
    // 触摸手势进行中的起点 Y：effect 局部即可，监听重建时本就应重置。
    let touchStartY: number | null = null;
    const reattach = () => {
      state.suppressed = false;
      state.following = true;
      state.wasInBand = true;
      setAtTail(true);
    };
    reattachRef.current = reattach;
    const release = () => {
      state.suppressed = true;
      state.following = false;
      setAtTail(false);
    };
    const update = () => {
      const height = container.scrollHeight;
      const shrank = height < lastScrollHeightRef.current;
      lastScrollHeightRef.current = height;
      const dist = readDistance();
      if (shrank && !state.following && !state.touching) {
        // 钳制把 scrollTop 拉小了：退回原距离，读者原地不动；本事件不改状态。
        if (dist < state.lastDistance - 0.5) {
          container.scrollTop = Math.max(0, height - container.clientHeight - state.lastDistance);
          state.lastDistance = readDistance();
          return;
        }
        // 缩的是尾端以远（读者距底距离反而变大）：照常走几何重算。
        state.lastDistance = dist;
      } else {
        state.lastDistance = dist;
      }
      const inBand = isAtTail(container.scrollTop, container.clientHeight, container.scrollHeight);
      if (state.suppressed) {
        if (inBand && !state.wasInBand) {
          // 带外→带内跃迁 = 用户自己回到尾部，解除压制并重挂。
          reattach();
        } else {
          setAtTail(false);
        }
      } else {
        state.following = inBand;
        setAtTail(inBand);
      }
      state.wasInBand = inBand;
    };
    const onWheel = (event: WheelEvent) => {
      // deltaMode 非 0 时把行/页单位换算成像素（行 ×16、页 ×视口高）。
      let scale = 1;
      if (event.deltaMode === 1) scale = 16;
      else if (event.deltaMode === 2) scale = container.clientHeight;
      const action = gesture.feed(event.deltaY, scale);
      if (action === "leave") {
        release();
      } else if (action === "reattach" && state.suppressed
        && isAtTail(container.scrollTop, container.clientHeight, container.scrollHeight)) {
        reattach();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      state.touching = true;
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (touchStartY === null || y === undefined) return;
      const dy = y - touchStartY;
      // 手指下移（clientY 变大）= 内容上滚看历史 = 离开跟随；小于 6px 的位移是
      // 点按抖动，不是手势，不脱离（否则一次误杀就永久压制，停在底部也不再跟随）。
      if (dy > 6) {
        release();
        return;
      }
      // 反向手势（手指上移 = 内容向下）立即重挂：压制期间停在带内的读者想回尾，
      // 不必先滚出带再滚回来。
      if (dy < -6 && state.suppressed
        && isAtTail(container.scrollTop, container.clientHeight, container.scrollHeight)) {
        reattach();
      }
    };
    const onTouchEnd = () => {
      state.touching = false;
      touchStartY = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") release();
    };
    // 脱离态下内容增长不产生 scroll 事件（没人写 scrollTop），只靠 scroll 更新的
    // lastDistance 会在流式期间停更：完成重组收缩触发浏览器钳制时，收缩保位用
    // 陈旧基准回退，读者被拉向尾部（脱离后增长多少拉多少）。这里以 ResizeObserver
    // 跟踪内容高度：非跟随、非触摸、且未贴底（钳制未发生）时刷新基准——读者
    // 没动，他的真实距底距离就是内容变化后的值。已贴底时不刷新：那正是钳制征兆，
    // 收缩保位须用旧基准把读者退回钳制前的位置。跟随态不介入（那是
    // FollowTailWhenAtTail 的职责）。
    let contentFrame = 0;
    const contentEl = contentRef.current;
    const contentObserver = contentEl && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        if (contentFrame) return;
        contentFrame = requestAnimationFrame(() => {
          contentFrame = 0;
          if (state.following || state.touching) return;
          const height = container.scrollHeight;
          if (height === lastScrollHeightRef.current) return;
          if (container.scrollTop + container.clientHeight < container.scrollHeight) {
            lastScrollHeightRef.current = height;
            state.lastDistance = Math.max(0, height - container.scrollTop - container.clientHeight);
          }
        });
      })
      : null;
    if (contentObserver && contentEl) contentObserver.observe(contentEl);
    update();
    container.addEventListener("scroll", update, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    return () => {
      if (contentFrame) cancelAnimationFrame(contentFrame);
      contentObserver?.disconnect();
      container.removeEventListener("scroll", update);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      container.removeEventListener("keydown", onKeyDown);
    };
    // lastScrollHeightRef 只做跨事件记忆，不参与 effect 依赖；contentRef 引用稳定，
    // 列入依赖仅为满足 exhaustive-deps（loading 翻转重建时重新 observe 新 content）。
  }, [scrollContainerRef, contentRef, sessionKey, loading]);

  const reattachToTail = useCallback(() => {
    reattachRef.current();
  }, []);

  return { atTail, reattachToTail };
}
