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
export function TurnTrace({ summary, failed, foldKey, defaultOpen, children }: {
  /** "处理详情 · 8 终端 · 2 文件". */
  summary: string;
  /** A tool in this turn failed: the line is destructive, as the官方 example shows. */
  failed?: boolean;
  foldKey: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const { open, onOpenChange } = useTraceFold(foldKey, defaultOpen);

  return (
    <Trace data-activity="turn">
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger aria-label={summary}>
          <TraceLine status={failed ? "error" : undefined}>
            <TraceTitle className="font-medium">{summary}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent forceMount className="flex flex-col gap-2">
          <Trace className="gap-1.5">{children}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
