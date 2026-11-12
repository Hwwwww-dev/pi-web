"use client";

import { memo, type ReactNode } from "react";
import { BotIcon, CircleCheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { SafeMarkdownBody } from "@/components/SafeMarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { ToolViewStatus, ToolViewStep } from "@/lib/tool-view";
import { TraceRow } from "./TraceRow";

const STEP_ICONS: Record<ToolViewStatus, ReactNode> = {
  running: <CircleDotIcon className="text-warning" />,
  done: <CircleCheckIcon />,
  pending: <CircleIcon />,
  error: <CircleIcon className="text-destructive" />,
};

/**
 * A subagent run (官方 `pattern_subagent.md`): its own steps nested in a
 * `<Trace>`, the report below them. A run still in the background is the line
 * alone — there is nothing to show yet.
 */
export const SubagentTrace = memo(function SubagentTrace({ label, status, steps, report, foldKey, action, below }: {
  /** The profile or agent name; omitted for the generic line. */
  label?: string;
  status: ToolViewStatus;
  steps?: ToolViewStep[];
  /** The agent's final report as Markdown. */
  report?: string;
  foldKey: string;
  /** Row-end action (opening the subagent's tab). */
  action?: ReactNode;
  /** Media the run produced, below the line. */
  below?: ReactNode;
}) {
  const { t } = useI18n();
  // 行上的名字只有「子代」：profile/描述可长，放在会截断的描述位，不挤占名字。
  const title = t("chat.trace.subagent");
  const hasBody = Boolean((steps && steps.length > 0) || report);

  return (
    <TraceRow
      icon={<BotIcon className="size-3.5" />}
      title={title}
      description={label}
      status={status}
      foldKey={foldKey}
      trailing={undefined}
      actions={action}
      ariaLabel={title}
      below={below}
      content={hasBody ? (
        <>
          {steps && steps.length > 0 && (
            <Trace>
              {steps.map((step, index) => (
                <TraceLine key={index} status={step.status === "error" ? "error" : step.status === "pending" ? "pending" : step.status === "running" ? "running" : undefined}>
                  <TraceIcon>{STEP_ICONS[step.status]}</TraceIcon>
                  <TraceTitle>{step.title}</TraceTitle>
                  {step.description && <TraceDescription>{step.description}</TraceDescription>}
                </TraceLine>
              ))}
            </Trace>
          )}
          {report && <SafeMarkdownBody>{report}</SafeMarkdownBody>}
        </>
      ) : undefined}
    />
  );
});
