"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/hooks/useI18n";
import { formatCompactTokens } from "@/lib/turn-view";

/**
 * Context used (官方 `pattern_context.md`): the same segment the usage line
 * always showed, now as the actual next-request prompt size — "ctx 24.5k /
 * 200k" (percent only while tokens are unknown, i.e. the live reading lacks
 * them) — and, when the turn knows both numbers, a hover card with used /
 * limit and the bar. It asks for no data of its own.
 */
export function ContextBadge({ tokens, contextWindow, percent, color }: {
  /** Prompt size of the next request. */
  tokens?: number;
  /** The model's window; without it the card has no limit to show. */
  contextWindow?: number;
  /** Percent fallback printed while tokens are unknown. */
  percent: number;
  /** The caller's own highlight (warn/danger). */
  color?: string;
}) {
  const { t } = useI18n();
  const label = (
    // 第 4 节：与用量行一致的行内小字样式，不使用胶囊。
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="opacity-75">ctx</span>
      {/* ctxColor arrives as a token string from the caller — keep the injection. */}
      <span style={color ? { color } : undefined}>
        {`${tokens !== undefined ? formatCompactTokens(tokens) : `${percent.toFixed(1)}%`}${contextWindow ? ` / ${formatCompactTokens(contextWindow)}` : ""}`}
      </span>
    </span>
  );

  if (tokens === undefined || !contextWindow) {
    return label;
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="cursor-default">{label}</span>
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
