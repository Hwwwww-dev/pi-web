"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** 离底多少像素内算“贴底”。比一行矮，滚动抖动不会把跟随关掉。 */
const FOLLOW_THRESHOLD_PX = 8;

/**
 * 行内折叠体的窗口化列表（2026-11-20 用户：“行内折叠列表使用虚拟列表，且滚动条
 * 统一，自动跟随”）。
 *
 * 滚动容器是外层 `.trace-fold-body`（24rem 限高），列表自己绝不滚——两层滚动条
 * 是最容易做错的地方。行高可变：每行用 `measureElement` 量，展开某行后重新排布。
 *
 * `follow` 只对运行中的折叠体开：贴底时新行自动跟到末尾，用户往上滑就停住，滚回
 * 底部自动恢复。
 */
export function VirtualRows({
  count,
  render,
  gap = 6,
  overscan = 6,
  follow = false,
  focusIndex,
}: {
  count: number;
  render: (index: number) => ReactNode;
  gap?: number;
  overscan?: number;
  follow?: boolean;
  /** 搜索命中行的序号：挂载后滚到它（窗口外的行不存在，querySelector 找不到）。 */
  focusIndex?: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // 滚动元素解析成外层折叠体；列表自己不是滚动元素。
  const getScrollElement = useCallback(() => {
    const el = listRef.current;
    if (!el) return null;
    return el.closest<HTMLElement>(".trace-fold-body") ?? el.parentElement;
  }, []);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement,
    estimateSize: () => 28,
    overscan,
    gap,
  });

  useEffect(() => {
    const el = listRef.current?.closest<HTMLElement>(".trace-fold-body") ?? listRef.current?.parentElement;
    if (!el) return;
    const update = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, []);

  // 命中行可能落在窗口外，挂载后直接让虚拟器滚过去。
  useLayoutEffect(() => {
    if (focusIndex === undefined || focusIndex < 0) return;
    virtualizer.scrollToIndex(focusIndex, { align: "center" });
  }, [focusIndex, virtualizer]);

  // 新行落地后行高要等 measureElement 回报，所以连跑两帧再贴底。
  useLayoutEffect(() => {
    if (!follow || !stickRef.current) return;
    const el = listRef.current?.closest<HTMLElement>(".trace-fold-body") ?? listRef.current?.parentElement;
    if (!el) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      second = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [count, follow]);

  return (
    <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${row.start}px)` }}
        >
          {render(row.index)}
        </div>
      ))}
    </div>
  );
}
