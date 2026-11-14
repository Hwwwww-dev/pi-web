"use client";

/**
 * 会话列表贴底跟随状态机（从 components/ChatWindow.tsx 原位抽出，契约见
 * lib/chat-follow.ts）：`atTail` 是唯一的跟随信号，官方 scroller 以
 * `autoScroll={false}` 运行，贴底跟随、完成时刻的保持都只消费这一个状态。
 *
 * - 贴底判定：距底 ≤ CHAT_TAIL_TOLERANCE 即贴底；滚轮上滚 / 触摸上滑 /
 *   ArrowUp·PageUp·Home 到达即脱离（手势压制）。
 * - 程序化滚动（跟随回写、折叠保位、浏览器钳制）不参与意图判定，状态按
 *   几何位置自愈。
 * - **收缩保位**：非跟随态下内容缩短（完成重组、行折叠）时，浏览器钳制会把
 *   读者拉向尾端；这里按收缩量回退 scrollTop，读者距底距离不变，且本次事件
 *   不做贴底重算、不解除压制——钳制不会被误读成"用户滚回尾部"（完成时刻
 *   强行跳底的根因）。
 * - reattachToTail()：回底按钮的入口——解除压制并置贴底；调用方随后自行平滑
 *   滚动，飞行中与之后的内容增长由 FollowTailWhenAtTail 即时校正到真底。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { isAtTail, isUpwardGesture } from "@/lib/chat-follow";

export function useChatFollow(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  sessionKey: string | undefined,
  loading: boolean,
) {
  const [atTail, setAtTail] = useState(true);
  const reattachRef = useRef<() => void>(() => {});
  // 跨事件记忆上次 scrollHeight（判定收缩）；effect 重建时重置为当前值。
  const lastScrollHeightRef = useRef<number>(0);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    lastScrollHeightRef.current = container.scrollHeight;
    // 手势压制：向上输入脱离后，带内几何事件不得重挂跟随——否则滚轮/触摸上滑的
    // 前几帧被 update() 改回 true，effect 随 false→true 重挂立即 scrollToEnd 弹回
    // 底部，与手势反复拉锯（贴底上滑抖几下、越近底越抖的根因）。只有从带外重新
    // 进入带内（滚回底部、滚动条拖回）才解除压制恢复跟随；折叠保位、钳制等
    // 程序化滚动仍按几何自愈，不受影响。
    let suppressed = false;
    let wasInBand = true;
    let following = true;
    // 上一次事件时的距底距离：收缩事件据此判断钳制是否拖近了尾端。
    let lastDistance = Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
    const update = () => {
      const height = container.scrollHeight;
      const shrank = height < lastScrollHeightRef.current;
      lastScrollHeightRef.current = height;
      const distance = Math.max(0, height - container.scrollTop - container.clientHeight);
      if (shrank && !following) {
        // 钳制把 scrollTop 拉小了：退回原距离，读者原地不动；本事件不改状态。
        if (distance < lastDistance - 0.5) {
          container.scrollTop = Math.max(0, height - container.clientHeight - lastDistance);
          const restored = Math.max(0, height - container.scrollTop - container.clientHeight);
          lastDistance = restored;
          return;
        }
        // 缩的是尾端以远（读者距底距离反而变大）：照常走几何重算。
        lastDistance = distance;
      } else {
        lastDistance = distance;
      }
      const inBand = isAtTail(container.scrollTop, container.clientHeight, container.scrollHeight);
      if (suppressed) {
        if (inBand && !wasInBand) {
          // 带外→带内跃迁 = 用户自己回到尾部，解除压制并重挂。
          suppressed = false;
          following = true;
          setAtTail(true);
        } else {
          setAtTail(false);
        }
      } else {
        following = inBand;
        setAtTail(inBand);
      }
      wasInBand = inBand;
    };
    const release = () => {
      suppressed = true;
      following = false;
      setAtTail(false);
    };
    reattachRef.current = () => {
      suppressed = false;
      following = true;
      setAtTail(true);
    };
    const onWheel = (event: WheelEvent) => {
      if (isUpwardGesture(event.deltaY)) release();
    };
    let touchStartY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      // 手指下移（clientY 变大）= 内容上滚看历史 = 离开跟随。
      if (touchStartY !== null && y !== undefined && y > touchStartY) release();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") release();
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("scroll", update);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("keydown", onKeyDown);
    };
    // lastScrollHeightRef 只做跨事件记忆，不参与 effect 依赖。
  }, [scrollContainerRef, sessionKey, loading]);

  const reattachToTail = useCallback(() => {
    reattachRef.current();
  }, []);

  return { atTail, reattachToTail };
}
