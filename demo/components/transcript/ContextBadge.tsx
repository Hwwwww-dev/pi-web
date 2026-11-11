"use client";

import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/hooks/useI18n";
import { formatCompactTokens } from "@/lib/turn-view";

/**
 * Context used (官方 `pattern_context.md`): the turn-end percentage, the exact
 * tokens and the bar in a hover card. The numbers are the ones the turn already
 * has (`ctxTokens` / `ctxWindow`) — this component asks for nothing.
 */
export function ContextBadge({ used, limit }: { used: number; limit: number }) {
  const { t } = useI18n();
  if (limit <= 0) return null;
  const percent = Math.min(100, Math.round((used / limit) * 100));

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="outline" size="sm" className="tabular-nums">
          {t("chat.trace.context", { percent })}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">{t("chat.trace.contextLabel")}</span>
          <span className="tabular-nums text-muted-foreground">
            {`${formatCompactTokens(used)} / ${formatCompactTokens(limit)}`}
          </span>
        </div>
        <Progress value={percent} aria-label={t("chat.trace.contextLabel")} />
      </HoverCardContent>
    </HoverCard>
  );
}
