"use client";

import type { CSSProperties, ReactNode } from "react";
import { formatCompactTokens, type UsageContextPart } from "@/lib/turn-view";

// One shared usage rendering for the toolbar stats and the chat usage lines:
// same icons, sizes, gaps and number formats everywhere.

function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="8.5" x2="5" y2="1.5" />
      {up ? <polyline points="2 4 5 1.5 8 4" /> : <polyline points="2 6 5 8.5 8 6" />}
    </svg>
  );
}

function CacheIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

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
  if (input > 0) segments.push({ id: "in", node: <><ArrowIcon up />{formatCompactTokens(input)}</> });
  if (output > 0) segments.push({ id: "out", node: <><ArrowIcon />{formatCompactTokens(output)}</> });
  if (cacheRead > 0) segments.push({ id: "cache", node: <><CacheIcon />{formatCompactTokens(cacheRead)}</> });
  if (cost > 0) {
    segments.push({
      id: "cost",
      node: (
        <span style={emphasizeCost ? { color: "var(--text)", fontWeight: 500 } : undefined}>
          {cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`}
        </span>
      ),
    });
  }
  if (ctx && (ctx.tokens !== undefined || ctx.percent !== undefined || ctx.contextWindow)) {
    const percent = ctx.tokens !== undefined && ctx.contextWindow
      ? (ctx.tokens / ctx.contextWindow) * 100
      : ctx.percent ?? null;
    const text = `${percent !== null ? `${percent.toFixed(1)}%` : "?"}${ctx.contextWindow ? ` / ${formatCompactTokens(ctx.contextWindow)}` : ""}`;
    segments.push({
      id: "ctx",
      node: (
        <>
          <span style={{ opacity: 0.75 }}>ctx</span>
          <span style={ctxColor ? { color: ctxColor } : undefined}>{text}</span>
        </>
      ),
    });
  }
  if (segments.length === 0) return null;

  return (
    <span
      className={className}
      style={{
        display: "inline-flex", alignItems: "center", flexWrap: "wrap",
        columnGap: gap, rowGap: 2, fontVariantNumeric: "tabular-nums", ...style,
      }}
    >
      {segments.map((segment) => (
        <span key={segment.id} data-usage-seg={segment.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {segment.node}
        </span>
      ))}
    </span>
  );
}
