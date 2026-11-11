"use client";

import { memo } from "react";
import { CircleCheckIcon, CircleIcon, ListChecksIcon, ListTodoIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useI18n } from "@/hooks/useI18n";
import type { ToolViewStep } from "@/lib/tool-view";
import { TraceRow } from "./TraceRow";

/**
 * A todo snapshot (官方 `pattern_queue.md`): two segments, open items and done
 * items. An empty segment is not rendered — "0 项已完成" is noise.
 */
export const QueueTrace = memo(function QueueTrace({ open, done, foldKey, activityTool }: {
  open: ToolViewStep[];
  done: ToolViewStep[];
  foldKey: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
}) {
  const { t } = useI18n();

  const segment = (steps: ToolViewStep[], title: string, icon: React.ReactNode, itemIcon: React.ReactNode, key: string) => (
    <TraceRow
      icon={icon}
      title={title}
      foldKey={`${foldKey}:${key}`}
      activityTool={activityTool}
      defaultOpen
      ariaLabel={title}
      content={(
        <Trace className="gap-1">
          {steps.map((step, index) => (
            <TraceLine key={index} status={step.status === "pending" ? "pending" : undefined}>
              <TraceIcon>{itemIcon}</TraceIcon>
              <TraceTitle>{step.title}</TraceTitle>
              {step.description && <TraceDescription>{step.description}</TraceDescription>}
            </TraceLine>
          ))}
        </Trace>
      )}
    />
  );

  return (
    <Trace data-activity="queue" className="gap-1">
      {open.length > 0 && segment(open, t("chat.trace.todoOpen", { count: open.length }), <ListTodoIcon />, <CircleIcon />, "open")}
      {done.length > 0 && segment(done, t("chat.trace.todoDone", { count: done.length }), <ListChecksIcon />, <CircleCheckIcon />, "done")}
    </Trace>
  );
});
