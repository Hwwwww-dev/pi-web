"use client";

import { memo } from "react";
import { TriangleAlert } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
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
  return (
    <div className="transcript-notices -mt-1.5 mb-3 flex flex-col gap-0.5">
      {shown.map((notice, index) => {
        const warning = notice.kind !== "cache_warm";
        return (
          <div
            key={index}
            className={`flex items-start gap-1.5 text-xs leading-normal wrap-anywhere ${warning ? "text-warning" : "text-dim"}`}
          >
            {warning && (
              <TriangleAlert size={13} strokeWidth={1.8} className="mt-[3px] shrink-0" />
            )}
            <span>{transcriptNoticeText(t, notice)}</span>
          </div>
        );
      })}
    </div>
  );
});
