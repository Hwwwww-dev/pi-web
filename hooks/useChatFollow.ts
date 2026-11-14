"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CHAT_TAIL_EPSILON,
  createWheelGesture,
  initialFollowState,
  nextFollowState,
  type FollowEvent,
  type FollowState,
} from "@/lib/chat-follow";

/** 折叠行自行锚定顶边时派发的事件（components/transcript/TraceRow.tsx）。 */
const FOLD_EVENT = "pi-web:trace-fold";
/** 折叠动画期内不补位：260ms 覆盖行高变化的过渡帧。 */
const FOLD_FREEZE_MS = 260;

/**
 * 把 DOM 事件翻译成 `lib/chat-follow.ts` 的状态机事件，并按返回的动作写 scrollTop。
 * 状态机之外这里不做任何判定：
 * - 读者滚动：几何（距离 ≤ 1px）决定贴不贴底，绝不因为"进了某个距离带"就贴底；
 * - 只有"收缩把非贴底的读者钳到尾部"这一种形状的事件不是读者动作，其余全部交给
 *   状态机（锚点调整保持距底距离不变，交出去也不会误判）；
 * - 自己写的 scrollTop 用标记排除，避免自我触发；
 * - 保活槽隐藏（clientHeight 为 0）时几何是假的：照常收基准，但不写 scrollTop；
 * - 贴底时内容/视口变化只补这一帧长出来的量，位移上界 = 增长量。
 */
export function useChatFollow(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  sessionKey: string | undefined,
  loading: boolean,
) {
  const [atTail, setAtTail] = useState(true);
  const stateRef = useRef<FollowState>(initialFollowState(0, 0));
  const reattachRef = useRef<() => void>(() => {});
  const resyncRef = useRef<() => void>(() => {});
  const sessionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const content = contentRef.current;
    const readDistance = () =>
      Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);

    // 会话切换整体重置；loading 翻转只重建监听，跟随状态不丢（否则读史完成瞬间
    // 上一会话的贴底判定被静默清零）。
    if (sessionRef.current !== sessionKey) {
      sessionRef.current = sessionKey;
      stateRef.current = initialFollowState(readDistance(), container.scrollHeight);
      setAtTail(stateRef.current.pinned);
    }

    // 自己写的 scrollTop 不算读者滚动。handler 里消费一次标记，rAF 再兜底清一次：
    // 写入若是空操作（已经到底）不会有 scroll 事件，标记不能留到下一次真实滚动。
    let programmatic = false;
    const writeScrollTop = (value: number) => {
      programmatic = true;
      container.scrollTop = value;
      requestAnimationFrame(() => {
        programmatic = false;
      });
    };

    const dispatch = (event: FollowEvent) => {
      const { state, action } = nextFollowState(stateRef.current, event);
      stateRef.current = state;
      if (action === "pin-bottom") {
        // 隐藏槽位（display:none）的几何全为 0，此时补位只会把真实位置写成 0。
        if (container.clientHeight > 0) writeScrollTop(container.scrollHeight);
      } else if (action === "restore-distance") {
        writeScrollTop(Math.max(0, container.scrollHeight - container.clientHeight - state.baseline));
      }
      setAtTail(state.pinned);
    };
    reattachRef.current = () => dispatch({ kind: "reach-bottom" });
    resyncRef.current = () =>
      dispatch({ kind: "settle", distance: readDistance(), height: container.scrollHeight });

    const onScroll = () => {
      if (programmatic) {
        programmatic = false;
        return;
      }
      // 唯一不算读者动作的形状：内容收缩后浏览器把 scrollTop 钳回尾部（距底归零），
      // 而读者本来不在尾部。交给 resize 的"收缩原地保位"，别把它判成"回到底部"。
      // 不能按"这一帧高度变了"一刀切——流式换行、图片落地都会让 lastHeight 落后一帧，
      // 那一帧里读者的触摸/拖拽事件会被整批丢掉。
      const height = container.scrollHeight;
      const distance = readDistance();
      const previous = stateRef.current;
      if (
        height < previous.lastHeight
        && distance <= CHAT_TAIL_EPSILON
        && previous.baseline > CHAT_TAIL_EPSILON
      ) return;
      dispatch({ kind: "user-scroll", distance });
    };

    const gesture = createWheelGesture();
    const onWheel = (event: WheelEvent) => {
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      if (gesture.feed(event.deltaY, scale) === "leave") dispatch({ kind: "wheel-leave" });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
        dispatch({ kind: "wheel-leave" });
      }
    };

    // 展开/收起行自己锚定顶边（components/transcript/TraceRow.tsx）：这几帧里内容
    // 高度变化的来源不是"流式追加"，补位会把刚展开的行拉上去。冻结期只重算基准，
    // 冻结结束时再按几何否决一次跟随。
    let frozenUntil = 0;
    let freezeTimer = 0;
    const onFold = () => {
      frozenUntil = performance.now() + FOLD_FREEZE_MS;
      window.clearTimeout(freezeTimer);
      freezeTimer = window.setTimeout(() => {
        frozenUntil = 0;
        dispatch({ kind: "settle", distance: readDistance(), height: container.scrollHeight });
      }, FOLD_FREEZE_MS);
    };

    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const event =
          performance.now() < frozenUntil
            ? ({ kind: "settle", distance: readDistance(), height: container.scrollHeight } as const)
            : ({ kind: "resize", distance: readDistance(), height: container.scrollHeight } as const);
        dispatch(event);
      });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (observer) {
      // 内容（流式追加、行折叠、图片落地）与视口（键盘开合、队列条长高）都观察。
      if (content) observer.observe(content);
      observer.observe(container);
    }

    window.addEventListener(FOLD_EVENT, onFold);
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(freezeTimer);
      window.removeEventListener(FOLD_EVENT, onFold);
      observer?.disconnect();
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
    };
    // contentRef 引用稳定，列入依赖仅为满足 exhaustive-deps（loading 翻转重建时
    // 重新 observe 新的内容节点）。
  }, [scrollContainerRef, contentRef, sessionKey, loading]);

  const reattachToTail = useCallback(() => {
    reattachRef.current();
  }, []);

  /** 布局被外部改写后（切回保活会话、还原滚动位置）重读几何，不滚、只重算基准。 */
  const resyncFollow = useCallback(() => {
    resyncRef.current();
  }, []);

  return { atTail, reattachToTail, resyncFollow };
}
