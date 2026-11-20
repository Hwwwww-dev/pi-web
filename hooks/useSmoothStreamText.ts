"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 已显示到的位置，按 `progressKey` 跨组件实例保存（2026-11-20）：活跃回合的
 * 折叠行在段重组、列表重读、settle 交换帧里会重挂载，状态里的进度一重置，
 * 整段文本就会一次性蹦出来——打字机看起来就“没了”。条目上限防无界增长。
 */
const MAX_PROGRESS_ENTRIES = 200;
const progressByKey = new Map<string, string>();

function readProgress(key: string): string | undefined {
  return progressByKey.get(key);
}

function writeProgress(key: string, value: string) {
  progressByKey.delete(key);
  progressByKey.set(key, value);
  if (progressByKey.size > MAX_PROGRESS_ENTRIES) {
    const oldest = progressByKey.keys().next().value;
    if (oldest !== undefined) progressByKey.delete(oldest);
  }
}

/**
 * 流式吐字平滑：目标文本按帧追赶显示（每帧至少 2 字符 + 积压的 1/10），
 * 字像连续流出，而不是每个 chunk 突然蹦出一段。只在 `active`（流式期）生效；
 * 历史消息直接返回原文，零开销。
 *
 * - 重挂载不重打：不给 `progressKey` 时初始显示值就是挂载那一刻的全文，只对
 *   新增长做动画；给了 `progressKey` 则接着上次的进度继续吐（折叠行标题用，
 *   它所在的段会整体重挂载）。
 * - 内容被修正（`text_end` 的权威全文与已显示部分不接续）时跳齐，不倒放。
 * - `active` 熄灭即贴齐目标：落进列表的全文与气泡最后一帧一致，不留尾差。
 */
export function useSmoothStreamText(target: string, active: boolean, progressKey?: string): string {
  const [shown, setShown] = useState(() => {
    if (!active || !progressKey) return target;
    const saved = readProgress(progressKey);
    // 记下的进度必须仍是目标的前缀，否则（快照修正/块重置）从头吐。
    return saved !== undefined && target.startsWith(saved) ? saved : "";
  });
  const shownRef = useRef(shown);
  useEffect(() => {
    const sync = (value: string) => {
      shownRef.current = value;
      if (progressKey) writeProgress(progressKey, value);
      setShown(value);
    };
    if (!active || target === shownRef.current) {
      if (shownRef.current !== target) sync(target);
      return;
    }
    if (!target.startsWith(shownRef.current)) {
      // 快照修正或块重置：不做吐字，直接跳齐。
      sync(target);
      return;
    }
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const current = shownRef.current;
      if (!target.startsWith(current) || target === current) return;
      const backlog = target.length - current.length;
      const next = target.slice(0, current.length + Math.max(2, Math.ceil(backlog / 10)));
      sync(next);
      if (next.length < target.length) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, active, progressKey]);
  return active ? shown : target;
}
