"use client";

import { memo } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  formatCacheWarmCost,
  formatNoticeCost,
  formatNoticeTokens,
  type CacheMissSummary,
  type TranscriptNotice,
} from "@/lib/transcript-notices";

type Translate = (key: string, params?: Record<string, string | number>) => string;

function costSuffix(t: Translate, cost: number): string {
  const formatted = formatNoticeCost(cost);
  return formatted ? t("transcriptNotice.costSuffix", { cost: formatted }) : "";
}

export function transcriptNoticeText(t: Translate, notice: TranscriptNotice): string {
  switch (notice.kind) {
    case "cache_miss": {
      const params = { tokens: formatNoticeTokens(notice.missedTokens), cost: costSuffix(t, notice.missedCost) };
      if (notice.modelChanged) return t("transcriptNotice.cacheMissModelSwitch", params);
      if (notice.idleMinutes !== undefined) return t("transcriptNotice.cacheMissIdle", { ...params, minutes: notice.idleMinutes });
      return t("transcriptNotice.cacheMiss", params);
    }
    case "cache_warm":
      return t("transcriptNotice.cacheWarmed", {
        note: notice.note ? t("transcriptNotice.cacheWarmedNote", { note: notice.note }) : "",
        cost: formatCacheWarmCost(notice.cost),
      });
    case "summary_cost":
      return t(notice.source === "compaction" ? "transcriptNotice.compactionCost" : "transcriptNotice.branchSummaryCost", {
        tokens: formatNoticeTokens(notice.tokens),
        cost: costSuffix(t, notice.cost),
      });
    case "thinking_dropped":
      return t(notice.count === 1 ? "transcriptNotice.thinkingDroppedOne" : "transcriptNotice.thinkingDropped", { count: notice.count });
  }
}

/** The folded Process details header's part for the cache misses inside it. */
export function cacheMissSummaryText(t: Translate, summary: CacheMissSummary): string {
  const params = {
    count: summary.count,
    tokens: formatNoticeTokens(summary.missedTokens),
    cost: costSuffix(t, summary.missedCost),
  };
  return t(summary.count === 1 ? "transcriptNotice.foldCacheMiss" : "transcriptNotice.foldCacheMisses", params);
}

/**
 * One line per notice, under the message they follow. A compaction's cost is
 * drawn in its card. Warnings render in the warning token — pi's TUI draws
 * these lines in its warning color, cache warming dim (#1265).
 */
export const TranscriptNoticeLines = memo(function TranscriptNoticeLines({ notices }: { notices: readonly TranscriptNotice[] }) {
  const { t } = useI18n();
  const shown = notices.filter((notice) => !(notice.kind === "summary_cost" && notice.source === "compaction"));
  if (shown.length === 0) return null;
  const warned = shown.some((notice) => notice.kind !== "cache_warm");
  return (
    // 第 4 节：提示线使用官方 `Alert` 槽位。
    <Alert
      variant={warned ? "warning" : "default"}
      className="transcript-notices -mt-1.5 mb-3 w-auto px-3 py-2 text-xs leading-normal"
    >
      {warned && <TriangleAlertIcon />}
      <AlertDescription className="flex flex-col gap-0.5 wrap-anywhere">
        {shown.map((notice, index) => (
          <span
            key={index}
            className={notice.kind === "cache_warm" ? "text-muted-foreground" : undefined}
          >
            {transcriptNoticeText(t, notice)}
          </span>
        ))}
      </AlertDescription>
    </Alert>
  );
});
