"use client";

import { memo } from "react";
import { CircleIcon, CircleCheckIcon, MessageCircleQuestionIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { ToolViewStep } from "@/lib/tool-view";
import type { StepUsage } from "@/lib/turn-view";
import { TraceRow } from "./TraceRow";

const STEP_ICON = {
  done: CircleCheckIcon,
  running: CircleIcon,
  pending: CircleIcon,
  error: CircleIcon,
} as const;

/**
 * A question put to the operator (官方 `pattern_plan.md` 之外): one line per
 * prompt, the choices below it, the pick replacing them once answered. No
 * progress count — a question is not a to-do list.
 */
export const QuestionTrace = memo(function QuestionTrace({ title, steps, foldKey, activityTool, stepUsage }: {
  title: string;
  steps: ToolViewStep[];
  foldKey: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
  /** The issuing request's usage: the expanded card's first line (TraceRow draws it). */
  stepUsage?: StepUsage;
}) {
  const answered = steps.filter((step) => step.status === "done").length;

  return (
    <TraceRow
      icon={<MessageCircleQuestionIcon />}
      title={title}
      foldKey={foldKey}
      activityTool={activityTool}
      stepUsage={stepUsage}
      defaultOpen
      status={steps.length > 0 && answered === steps.length ? "done" : undefined}
      ariaLabel={title}
      content={(
        <Trace>
          {steps.map((step, index) => {
            const Icon = STEP_ICON[step.status];
            return (
              <TraceLine key={index} status={step.status === "pending" ? "pending" : undefined}>
                <TraceIcon><Icon /></TraceIcon>
                <TraceTitle>{step.title}</TraceTitle>
                {step.description ? <TraceDescription>{step.description}</TraceDescription> : null}
              </TraceLine>
            );
          })}
        </Trace>
      )}
    />
  );
});
