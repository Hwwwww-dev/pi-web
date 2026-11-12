"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  COLLAPSIBLE_EXPANDED_EVENT,
  isToolCallExpanded,
  setToolCallExpanded,
} from "@/lib/tool-call-expansion";
import type { ToolViewStatus } from "@/lib/tool-view";

/**
 * The base every pattern below builds on: one `TraceLine` that folds its
 * content. Kept private to `components/transcript` — a pattern names the thing
 * being shown (a tool call, a thought, a group) instead of exposing this shape.
 */

const STATUS_ATTR = {
  running: "running",
  error: "error",
  pending: "pending",
  done: undefined,
} as const;

/**
 * Fold state for one row. `foldKey` keeps the user's choice across remounts
 * (streaming → message_end → process details → a session file read), the same
 * way tool cards always have.
 */
export function useTraceFold(foldKey?: string, defaultOpen = false) {
  const [open, setOpen] = useState(() => isToolCallExpanded(foldKey) || defaultOpen);

  useEffect(() => {
    if (!foldKey) return;
    const sync = () => setOpen(isToolCallExpanded(foldKey));
    window.addEventListener(COLLAPSIBLE_EXPANDED_EVENT, sync);
    return () => window.removeEventListener(COLLAPSIBLE_EXPANDED_EVENT, sync);
  }, [foldKey]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      setToolCallExpanded(foldKey, next);
    },
    [foldKey],
  );

  return { open, onOpenChange };
}

export function TraceRow({
  icon,
  title,
  object,
  titleClassName,
  chips,
  description,
  status = "done",
  foldKey,
  defaultOpen = false,
  trailing,
  usage,
  content,
  below,
  ariaLabel,
  href,
  activityTool,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** The thing the action applies to: elided before the action ever is. */
  object?: string;
  titleClassName?: string;
  /** File chips the call named, right after the title (第 4.1 节). */
  chips?: ReactNode;
  description?: string;
  status?: ToolViewStatus;
  /** Fold memory key (`toolCallId`, `groupKey`, …). */
  foldKey?: string;
  defaultOpen?: boolean;
  /** Rendered after the description, before the chevron (duration, badges). */
  trailing?: ReactNode;
  /** Rendered above the folding content (a call's usage bars). */
  usage?: ReactNode;
  /** Folding content. Omitted = a plain line that cannot expand. */
  content?: ReactNode;
  /** Rendered inside the fold after `content`. */
  children?: ReactNode;
  /** Rendered inside the same `Trace` below the line (media the call produced). */
  below?: ReactNode;
  ariaLabel?: string;
  /** Renders the line as a link (官方 Sources 的同一形状). */
  href?: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
}) {
  const { open, onOpenChange } = useTraceFold(foldKey, defaultOpen);
  const line = (
    // `!` 覆盖 trace.tsx 里 `*:has-[>[data-slot=trace-line]]:w-fit`：行必须占满内容区，
    // 否则标题的 truncate 没有可收缩的宽度，长命令会溢出、箭头被挤到文字中间。
    <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="w-full! min-w-0">
      <TraceIcon>{icon}</TraceIcon>
      {/* The action is never elided: it is the row's name (用户要求：工具名称不可省略). */}
      <TraceTitle className={cn("shrink-0 whitespace-nowrap", titleClassName)}>{title}</TraceTitle>
      {object && <span className="min-w-0 truncate">{object}</span>}
      {chips}
      {description && <TraceDescription className="min-w-0 shrink truncate">{description}</TraceDescription>}
      {trailing && <span className="ml-auto shrink-0 pl-2">{trailing}</span>}
    </TraceLine>
  );

  if (!content) {
    return (
      <Trace data-activity="trace-row" data-activity-tool={activityTool}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {line}
          </a>
        ) : (
          line
        )}
        {below}
      </Trace>
    );
  }

  return (
    <Trace data-activity="trace-row" data-activity-tool={activityTool}>
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger aria-label={ariaLabel} className="w-full! max-w-full">
          {line}
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="mt-1 flex flex-col gap-2">
          {usage}
          {content}
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {below}
    </Trace>
  );
}
