"use client";

import { type ReactNode } from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useTraceFold } from "./TraceRow";

/**
 * A whole turn (官方 `trace` 文档「Whole Turn」): the folded line above the
 * answer. It has no icon — the summary text is the whole line — and its content
 * is a `<Trace>` of the same rows the answer is made of.
 */
export function TurnTrace({ summary, foldKey, defaultOpen, reveal = false, className, children }: {
  /** "处理详情 · 8 终端 · 2 文件". */
  summary: string;
  foldKey: string;
  defaultOpen: boolean;
  /** A search hit sits inside: the fold opens and stays open while the hit is pending. */
  reveal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { open, onOpenChange } = useTraceFold(foldKey, defaultOpen);

  return (
    <Trace data-activity="turn" className={className}>
      <TraceCollapsible
        open={open || reveal}
        onOpenChange={(next) => {
          if (!reveal) onOpenChange(next);
        }}
      >
        <TraceCollapsibleTrigger aria-label={summary}>
          <TraceLine>
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
