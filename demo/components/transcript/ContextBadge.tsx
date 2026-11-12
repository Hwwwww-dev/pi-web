"use client";

import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/hooks/useI18n";
import { formatCompactTokens } from "@/lib/turn-view";

/**
 * Context used (官方 `pattern_context.md`): the same "ctx 12.3% / 200k" segment
 * the usage line always showed, and — when the turn knows both numbers — a
 * hover card with used / limit and the bar. It asks for no data of its own.
 */
export function ContextBadge({ tokens, contextWindow, percent, color }: {
  /** Prompt size of the next request. */
  tokens?: number;
  /** The model's window; without it the card has no limit to show. */
  contextWindow?: number;
  /** The percentage the segment prints. */
  percent: number;
  /** The caller's own highlight (warn/danger). */
  color?: string;
}) {
  const { t } = useI18n();
  const label = (
    <>
      <span className="opacity-75">ctx</span>
      {/* ctxColor arrives as a token string from the caller — keep the injection. */}
      <span style={color ? { color } : undefined}>
        {`${percent.toFixed(1)}%${contextWindow ? ` / ${formatCompactTokens(contextWindow)}` : ""}`}
      </span>
    </>
  );

  if (tokens === undefined || !contextWindow) {
    return <Badge variant="secondary" className="gap-1 px-1.5 py-0 font-normal tabular-nums">{label}</Badge>;
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Badge variant="secondary" className="cursor-default gap-1 px-1.5 py-0 font-normal tabular-nums">{label}</Badge>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-56 flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">{t("chat.trace.contextLabel")}</span>
          <span className="tabular-nums text-muted-foreground">
            {`${formatCompactTokens(tokens)} / ${formatCompactTokens(contextWindow)}`}
          </span>
        </div>
        <Progress
          value={Math.min(100, Math.round((tokens / contextWindow) * 100))}
          aria-label={t("chat.trace.contextLabel")}
        />
      </HoverCardContent>
    </HoverCard>
  );
}
