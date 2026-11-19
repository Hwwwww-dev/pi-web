"use client";

import type { ReactNode } from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { LayersIcon } from "lucide-react";
import { useTraceFold } from "./TraceRow";

/**
 * A whole turn (official `trace` doc, "Whole Turn"): the folded line above the
 * answer. It has no icon — the summary text is the whole line — and its content
 * is a `<Trace>` of the same rows the answer is made of.
 */
export function TurnTrace({ summary, foldKey, defaultOpen, reveal = false, className, children }: {
  /** "处理详情 · 8 终端 · 2 文件". */
  summary: string;
  foldKey?: string;
  defaultOpen: boolean;
  /** A search hit sits inside: the fold opens and stays open while the hit is pending. */
  reveal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // 活跃期（LiveTurnTrace）已用同一个折叠键记录展开/收起选择，settle 交换帧
  // 按该选择原样接管：完成时是展开就保持展开，是收起就直接以“工作了 x”一行
  // 出现，没有过渡帧。历史导航中重挂载时同理（getFoldChoice 优先）。
  const { open, onOpenChange } = useTraceFold(foldKey, defaultOpen);

  return (
    <Trace data-activity="turn" className={className}>
      <TraceCollapsible
        open={open || reveal}
        onOpenChange={(next) => {
          if (reveal) return;
          onOpenChange(next);
        }}
      >
        <TraceCollapsibleTrigger aria-label={summary}>
          <TraceLine>
            <TraceIcon>
              <LayersIcon className="size-3.5" />
            </TraceIcon>
            <TraceTitle className="font-medium">{summary}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <Trace>{children}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
