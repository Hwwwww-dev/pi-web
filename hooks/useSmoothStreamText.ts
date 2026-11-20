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

/** 非流式期一次到位超过这么多字符（历史重读、展开加载整段）直接贴齐，不吐字。 */
const SILENT_BACKLOG_LIMIT = 400;

/**
 * 流式吐字平滑：目标文本按帧追赶显示（每帧至少 2 字符 + 积压的 1/10），
 * 字像连续流出，而不是每个 chunk 突然蹦出一段。
 *
 * - 增长就吐字：`active` 只决定“挂载时要不要从头吐”，文本只要是在已显示之后
 *   长出来的（流式 chunk、落盘增量都算），一律按帧追赶——否则思考落到列表里
 *   增长时标题就是死的（2026-11-20 用户：“也不会动”）。
 * - 重挂载不重打：不给 `progressKey` 时初始显示值就是挂载那一刻的全文；给了
 *   `progressKey` 则接着上次的进度继续吐（折叠行标题用它，所在段会整体重挂载）。
 * - 内容被修正（`text_end` 的权威全文与已显示部分不接续）时跳齐，不倒放。
 * - 非流式期的大段到达（> SILENT_BACKLOG_LIMIT）直接贴齐，不重打历史。
 */
export function useSmoothStreamText(target: string, active: boolean, progressKey?: string): string {
  const [shown, setShown] = useState(() => {
    if (!active || !progressKey) return target;
    const saved = readProgress(progressKey);
    // 记下的进度必须仍是目标的前缀，否则（快照修正/块重置）从头吐。
    return saved !== undefined && target.startsWith(saved) ? saved : "";
  });
  const shownRef = useRef(shown);
  const prevTargetRef = useRef(target);
  useEffect(() => {
    const grew = target.length > prevTargetRef.current.length && target.startsWith(prevTargetRef.current);
    prevTargetRef.current = target;
    const sync = (value: string) => {
      shownRef.current = value;
      if (progressKey) writeProgress(progressKey, value);
      setShown(value);
    };
    if (target === shownRef.current) return;
    // 非流式期只对“长出来的那段”吐字：流结束（active 熄灭、文本没再增长）时
    // 直接贴齐，气泡与折叠行不留尾差。
    if (!active && !grew) {
      sync(target);
      return;
    }
    if (!target.startsWith(shownRef.current)) {
      // 快照修正或块重置：不做吐字，直接跳齐。
      sync(target);
      return;
    }
    if (!active && target.length - shownRef.current.length > SILENT_BACKLOG_LIMIT) {
      // 非流式期的大段到达是历史内容，重打一遍没有意义。
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
  return shown;
}
