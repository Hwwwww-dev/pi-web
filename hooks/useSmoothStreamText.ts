"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 流式吐字平滑：目标文本按帧追赶显示（每帧至少 2 字符 + 积压的 1/10），
 * 字像连续流出，而不是每个 chunk 突然蹦出一段。只在 `active`（流式期）生效；
 * 历史消息直接返回原文，零开销。
 *
 * - 重挂载不重打：初始显示值就是挂载那一刻的全文，只对新增长做动画。
 * - 内容被修正（`text_end` 的权威全文与已显示部分不接续）时跳齐，不倒放。
 * - `active` 熄灭即贴齐目标：落进列表的全文与气泡最后一帧一致，不留尾差。
 */
export function useSmoothStreamText(target: string, active: boolean): string {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (!active || target === shownRef.current) {
      if (shownRef.current !== target) {
        shownRef.current = target;
        setShown(target);
      }
      return;
    }
    if (!target.startsWith(shownRef.current)) {
      // 快照修正或块重置：不做吐字，直接跳齐。
      shownRef.current = target;
      setShown(target);
      return;
    }
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const current = shownRef.current;
      if (!target.startsWith(current) || target === current) return;
      const backlog = target.length - current.length;
      const next = target.slice(0, current.length + Math.max(2, Math.ceil(backlog / 10)));
      shownRef.current = next;
      setShown(next);
      if (next.length < target.length) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, active]);
  return active ? shown : target;
}
