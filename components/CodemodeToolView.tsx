"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import {
  codemodeTotalCost,
  formatCodemodeCost,
  formatCodemodeDuration,
  type CodemodeCallStatus,
  type CodemodeCallView,
} from "@/lib/codemode-view";

// The tool calls a codemode script made, listed under the script in its card.
// Those calls never reach the model as tool calls of their own, so they are
// rows inside this card, not separate cards (as in pi's TUI).

/** Calls shown before the rest are folded behind a button; the newest stay visible. */
export const CODEMODE_VISIBLE_CALLS = 20;

const STATUS_STYLE: Record<CodemodeCallStatus, { icon: string; className: string }> = {
  running: { icon: "…", className: "text-warning" },
  ok: { icon: "✓", className: "text-success" },
  error: { icon: "✗", className: "text-destructive" },
  cancelled: { icon: "⊘", className: "text-muted-foreground" },
};

function CallRow({ call }: { call: CodemodeCallView }) {
  const { t } = useI18n();
  const status = STATUS_STYLE[call.status];
  const duration = formatCodemodeDuration(call.durationMs);
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          role="img"
          aria-label={t(`codemode.status.${call.status}`)}
          title={t(`codemode.status.${call.status}`)}
          className={`w-3 shrink-0 text-center ${status.className}`}
        >
          {status.icon}
        </span>
        <span className="shrink-0 font-semibold text-muted-foreground">{call.name}</span>
        {call.args && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {call.args}
          </span>
        )}
        {duration && (
          <span className="ml-auto shrink-0 text-muted-foreground/70 tabular-nums">{duration}</span>
        )}
        {call.cost !== undefined && (
          <span className="shrink-0 text-muted-foreground/70 tabular-nums">{formatCodemodeCost(call.cost)}</span>
        )}
      </div>
      {call.error && (
        <div className="pl-[18px] text-destructive whitespace-pre-wrap wrap-anywhere">{call.error}</div>
      )}
    </li>
  );
}

export function CodemodeCallList({ calls, omitted, isError }: {
  calls: readonly CodemodeCallView[];
  /** Earlier calls a progress snapshot did not include. */
  omitted: number;
  isError: boolean;
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  if (calls.length === 0 && omitted === 0) return null;
  const hidden = showAll ? 0 : Math.max(0, calls.length - CODEMODE_VISIBLE_CALLS);
  const shown = hidden > 0 ? calls.slice(hidden) : calls;
  // Folded rows still count: the total covers every call the result lists.
  const totalCost = codemodeTotalCost(calls);
  return (
    // fontSize: the chat font-size offset is a CSS variable, so the size stays a style injection.
    <div
      className={`flex min-w-0 flex-col gap-[3px] rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono leading-normal ${
        isError ? "border-destructive/30" : "border-border/60"
      }`}
      style={{ fontSize: "calc(12px + var(--chat-font-size-offset, 0px))" }}
    >
      <div className="text-xs text-muted-foreground">{t("codemode.calls")}</div>
      {omitted > 0 && (
        <div className="text-muted-foreground/70">{t("codemode.omittedCalls", { count: omitted })}</div>
      )}
      {hidden > 0 && (
        <Button
          type="button"
          variant="link"
          onClick={() => setShowAll(true)}
          className="h-auto self-start p-0"
        >
          {t("codemode.showEarlierCalls", { count: hidden })}
        </Button>
      )}
      <ul className="flex min-w-0 flex-col gap-[3px]">
        {shown.map((call, index) => (
          <CallRow key={call.id || `${hidden + index}`} call={call} />
        ))}
      </ul>
      {totalCost !== null && (
        <div className="text-muted-foreground/70">{t("codemode.modelCost", { cost: formatCodemodeCost(totalCost) })}</div>
      )}
    </div>
  );
}
