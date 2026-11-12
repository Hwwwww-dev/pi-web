"use client";

import { memo } from "react";
import { CircleCheckIcon, CircleDotIcon, CircleIcon, RouteIcon } from "lucide-react";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useI18n } from "@/hooks/useI18n";
import type { ToolViewStep } from "@/lib/tool-view";
import { TraceRow } from "./TraceRow";

const STEP_ICON = {
  done: CircleCheckIcon,
  running: CircleDotIcon,
  pending: CircleIcon,
  error: CircleIcon,
} as const;

/**
 * A todo snapshot (官方 `pattern_plan.md`): one collapsible line naming the
 * task in progress, its progress in the description, the steps below it.
 */
export const PlanTrace = memo(function PlanTrace({ steps, foldKey, activityTool }: {
  steps: ToolViewStep[];
  foldKey: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
}) {
  const { t } = useI18n();
  const current = steps.find((step) => step.status === "running") ?? steps.find((step) => step.status !== "done");
  const done = steps.filter((step) => step.status === "done").length;
  const title = current
    ? t("chat.trace.planNamed", { name: current.title })
    : t("chat.trace.plan");

  return (
    <TraceRow
      icon={<RouteIcon />}
      title={title}
      description={t("chat.trace.planProgress", { done, total: steps.length })}
      foldKey={foldKey}
      activityTool={activityTool}
      defaultOpen
      ariaLabel={title}
      content={(
        <Trace className="gap-1">
          {steps.map((step, index) => {
            const Icon = STEP_ICON[step.status];
            return (
              <TraceLine key={index} status={step.status === "pending" ? "pending" : undefined}>
                <TraceIcon><Icon /></TraceIcon>
                <TraceTitle>{step.title}</TraceTitle>
              </TraceLine>
            );
          })}
        </Trace>
      )}
    />
  );
});
