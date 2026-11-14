"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompactTokens } from "@/lib/turn-view";

// One shared usage rendering for the toolbar stats and the chat usage lines:
// same icons, sizes, gaps and number formats everywhere.

const ICON_PROPS = { size: 11, strokeWidth: 2 } as const;

export function UsageBar({ usage, emphasizeCost = false, gap = 8, style, className, title }: {
  usage?: { input?: number; output?: number; cacheRead?: number; cost?: number } | null;
  /** Toolbar look: cost emphasized against the dimmer token segments. */
  emphasizeCost?: boolean;
  gap?: number;
  style?: CSSProperties;
  className?: string;
  /** 整段用量的悬浮说明（如 formatUsage）；用量说明只挂用量段，不进整行。 */
  title?: string;
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
  if (segments.length === 0) return null;

  return (
    <span
      title={title}
      className={cn("inline-flex flex-wrap items-center row-gap-0.5 tabular-nums", className)}
      // columnGap is the caller's `gap` prop (toolbar 10 / chat 8) and `style`
      // is the component's own API — both stay dynamic.
      style={{ columnGap: gap, ...style }}
    >
      {segments.map((segment) => (
        // 第 4 节：用量采用官方 Trace 示例的行内小字（图标 + 数字），不使用胶囊。
        <span
          key={segment.id}
          data-usage-seg={segment.id}
          className="inline-flex items-center gap-1 text-muted-foreground"
        >
          {segment.node}
        </span>
      ))}
    </span>
  );
}
