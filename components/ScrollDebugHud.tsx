"use client";

import { useEffect, useState } from "react";

/**
 * `?debug-scroll` 下的滚动诊断浮层：只读、不参与布局、不改变任何滚动行为。
 *
 * 起因（2026-11-22）：偶现「贴真底」——滚到机械末端时最后一行被输入条盖住。官方
 * scroller 的内容末端是 `max(child.bottom) + content 的 padding-end`（`Re()`），
 * 而 `scrollToEnd()` 用的是 `scrollHeight - clientHeight`，两者都吃 Content 的
 * 垫底（`--composer-dock-h`）。所以症状只可能是那一刻垫底值不对。这里把三个数
 * 摆出来对照：变量写在 Content 上的计算结果、量到的 dock 高度、以及末行相对
 * 视口底的位置。
 */
export function ScrollDebugHud({
  enabled,
  containerRef,
  contentRef,
  dockRef,
}: {
  enabled: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  dockRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const sample = () => {
      frame = 0;
      const container = containerRef.current;
      const content = contentRef.current;
      const dock = dockRef.current;
      if (!container || !content) return;
      const style = getComputedStyle(content);
      const padEnd = Number.parseFloat(style.paddingBottom) || 0;
      // 官方 `ee()` 会把库自己塞的 spacer 排除在外，这里按同样口径取最后一行。
      const rows = Array.from(content.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && !child.dataset.slot,
      );
      const last = rows[rows.length - 1];
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      const lastBottomInContent = last
        ? last.getBoundingClientRect().bottom - container.getBoundingClientRect().top + container.scrollTop
        : 0;
      const libEnd = lastBottomInContent + padEnd - container.scrollTop - container.clientHeight;
      setLines([
        `scrollTop ${Math.round(container.scrollTop)} / max ${Math.round(max)} 差 ${Math.round(max - container.scrollTop)}`,
        `clientH ${Math.round(container.clientHeight)} scrollH ${Math.round(container.scrollHeight)}`,
        `content padBottom ${Math.round(padEnd)}  var ${style.getPropertyValue("--composer-dock-h") || "(未设)"}`,
        `dock offsetH ${dock ? dock.offsetHeight : -1}  行数 ${rows.length}`,
        `末行底到视口底 ${Math.round(lastBottomInContent - container.scrollTop - container.clientHeight)}`,
        `官方 end ${Math.round(libEnd)}（>36 才算可续 follow）`,
      ]);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sample);
    };
    schedule();
    containerRef.current?.addEventListener("scroll", schedule, { passive: true });
    const container = containerRef.current;
    return () => {
      container?.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, containerRef, contentRef, dockRef]);

  if (!enabled) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-2 right-2 z-50 rounded-md bg-black/80 p-2 font-mono text-[10px] leading-[1.5] text-white/90 tabular-nums"
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
