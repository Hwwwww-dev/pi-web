"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatCompactTokens, type UsageContextPart } from "@/lib/turn-view";
import { ContextBadge } from "@/components/transcript/ContextBadge";

// One shared usage rendering for the toolbar stats and the chat usage lines:
// same icons, sizes, gaps and number formats everywhere.

const ICON_PROPS = { size: 11, strokeWidth: 2 } as const;

export function UsageBar({ usage, ctx, emphasizeCost = false, ctxColor, gap = 8, style, className }: {
  usage?: { input?: number; output?: number; cacheRead?: number; cost?: number } | null;
  ctx?: UsageContextPart | null;
  /** Toolbar look: cost emphasized against the dimmer token segments. */
  emphasizeCost?: boolean;
  /** Optional highlight (warn/danger) for the ctx segment. */
  ctxColor?: string;
  gap?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cost = usage?.cost ?? 0;

  const segments: { id: string; node: ReactNode }[] = [];
  if (input > 0) segments.push({ id: "in", node: <><ArrowUp {...ICON_PROPS} />{formatCompactTokens(input)}</> });
  if (output > 0) segments.push({ id: "out", node: <><ArrowDown {...ICON_PROPS} />{formatCompactTokens(output)}</> });
  if (cacheRead > 0) segments.push({ id: "cache", node: <><Database {...ICON_PROPS} />{formatCompactTokens(cacheRead)}</> });
  if (cost > 0) {
    segments.push({
      id: "cost",
      node: (
        <span className={emphasizeCost ? "font-medium text-foreground" : undefined}>
          {cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`}
        </span>
      ),
    });
  }
  if (ctx) {
    const percent = ctx.tokens !== undefined && ctx.contextWindow
      ? (ctx.tokens / ctx.contextWindow) * 100
      : ctx.percent ?? null;
    // No computable reading (provider without a declared context window) —
    // omit the segment instead of rendering a meaningless "?".
    if (percent !== null) {
      segments.push({
        id: "ctx",
        // The segment stays the same text; the hover card carries the exact
        // used / limit numbers (第 14.3 节).
        node: (
          <ContextBadge
            tokens={ctx.tokens}
            contextWindow={ctx.contextWindow}
            percent={percent}
            color={ctxColor}
          />
        ),
      });
    }
  }
  if (segments.length === 0) return null;

  return (
    <span
      className={cn("inline-flex flex-wrap items-center row-gap-0.5 tabular-nums", className)}
      // columnGap is the caller's `gap` prop (toolbar 10 / chat 8) and `style`
      // is the component's own API — both stay dynamic.
      style={{ columnGap: gap, ...style }}
    >
      {segments.map((segment) => (
        // 第 4 节：用量数字落在官方 Badge（secondary）里，不再自绘统计块。
        <Badge
          key={segment.id}
          data-usage-seg={segment.id}
          variant="secondary"
          className="gap-1 px-1.5 py-0 font-normal tabular-nums"
        >
          {segment.node}
        </Badge>
      ))}
    </span>
  );
}
