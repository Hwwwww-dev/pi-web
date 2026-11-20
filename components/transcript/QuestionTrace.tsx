"use client";

import { memo, type ReactNode } from "react";
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
export const QuestionTrace = memo(function QuestionTrace({ title, steps, foldKey, activityTool, stepUsage, duration }: {
  /** 本次调用的耗时（≥100ms 才显示），由 ActivityRows 传入。 */
  duration?: ReactNode;
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
      duration={duration}
      activityTool={activityTool}
      stepUsage={stepUsage}
      defaultOpen
      status={steps.length > 0 && answered === steps.length ? "done" : undefined}
      ariaLabel={title}
      wrap
      content={(
        <Trace>
          {steps.map((step, index) => {
            const Icon = STEP_ICON[step.status];
            return (
              <TraceLine key={index} status={step.status === "pending" ? "pending" : undefined}>
                {/* 图标与问题首行对齐，不居中于两行之间。 */}
                <TraceIcon className="mt-[2px] self-start"><Icon /></TraceIcon>
                {/* 问题与答案分行：同排会把答案挤在问题后面被截掉。
                    两者都换行不截断（whitespace-normal 覆盖基类的 nowrap，
                    长串用 break-words 兜底）。 */}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <TraceTitle className="whitespace-normal break-words">{step.title}</TraceTitle>
                  {step.description ? <TraceDescription className="whitespace-normal break-words">{step.description}</TraceDescription> : null}
                </span>
              </TraceLine>
            );
          })}
        </Trace>
      )}
    />
  );
});
