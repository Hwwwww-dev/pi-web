"use client";

/**
 * 流式状态胶囊：`↓token 数 + t/s` 从消息列表头部（AssistantMessageHeader 的流式
 * 分支，已删）整体搬到 composer 下方——出现/消失不再推动消息列表，也不碰队列
 * pills。挂载点有两处，同一时刻只渲染一个（由 ChatWindow 决定）：
 * - 插件状态条存在时，作为该行的真 flex 子项插在右端 pinned 标记（YOLO）左边；
 * - 状态条不存在时，绝对定位浮在同一条带的右端（pointer-events-none）。
 *
 * 数据与口径和旧消息头一致：token 估算共用 lib/token-estimate（CJK≈1、其余
 * ≈4 chars/token，含增量缓存），速度用 lib/stream-token-rate（按消息键去重，
 * 重挂载不重算）；流式结束后最后一帧读数停留 RATE_HOLD_MS 再消失。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon } from "lucide-react";
import { beamDurationSeconds } from "@/lib/beam-speed";
import { estimateUpdatedTokens, getTokenEstimateText, type TokenEstimateCacheEntry } from "@/lib/token-estimate";
import { streamRateKey, streamRateStart, streamTokensPerSecond } from "@/lib/stream-token-rate";
import type { StreamingStore } from "@/lib/streaming-message";
import { selectIsStreaming, selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import { useI18n } from "@/hooks/useI18n";

const RATE_HOLD_MS = 6000;

/** `↓token 数 + 速度徽标`（五档配色，>120 t/s 彩虹）——原 AssistantMessageHeader 的计量段。 */
export function StreamRateBadge({ tokens, tps }: { tokens: number; tps: number | null }) {
  const { t } = useI18n();
  if (tokens <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-foreground" title={t("i18n.estimatedTokens")}>
      <span className="flex items-center gap-0.5 text-xs font-normal">
        <ArrowDownIcon aria-hidden className="size-2.5" strokeWidth={1.5} />
        {/* 无最小宽度：预留会让定稿读数（如 155）与徽标之间留下永久空隙；
            tabular-nums 保证计数增长时数字可读。 */}
        <span>{tokens}</span>
      </span>
      {tps !== null && (
        // 速率分五档，按阈值切换颜色：<15 红、15–30 黄、30–50 绿、
        // 50–120 蓝、>120 彩虹。彩虹档同为胶囊样式，底层为密排流动彩虹（文字
        // 恒白，≥166 t/s 后固定为 0.3s 一圈，不再加速）。
        <span
          className={`inline-flex shrink-0 items-center rounded-md px-1.5 text-xs leading-tight font-medium tabular-nums ${
            tps > 120 ? "relative isolate overflow-hidden text-white"
              : tps >= 50 ? "bg-info/15 text-info"
              : tps >= 30 ? "bg-success/15 text-success"
              : tps >= 15 ? "bg-warning/15 text-warning"
              : "bg-destructive/15 text-destructive"
          }`}
          title={`${tps.toFixed(1)} t/s`}
        >
          {tps > 120 && (
            <span
              aria-hidden="true"
              className="tps-rainbow pointer-events-none absolute inset-y-0 left-0 -z-10"
              style={{ animationDuration: `${beamDurationSeconds(tps).toFixed(2)}s` }}
            />
          )}
          {tps.toFixed(1)} t/s
        </span>
      )}
    </span>
  );
}

export function StreamStatusPill({ store }: { store: StreamingStore }) {
  const streamingMessage = useStreamingSelector(store, selectStreamingMessage);
  const isStreaming = useStreamingSelector(store, selectIsStreaming);
  const active = isStreaming && streamingMessage !== null;

  // token 估算：与旧消息头同一套增量缓存，随 chunk 精确增长。
  const tokenCacheRef = useRef<Map<number, TokenEstimateCacheEntry>>(new Map());
  const tokens = useMemo(() => {
    if (!streamingMessage) {
      tokenCacheRef.current = new Map();
      return 0;
    }
    let total = 0;
    const nextCache = new Map<number, TokenEstimateCacheEntry>();
    (streamingMessage.content ?? []).forEach((block, index) => {
      const text = getTokenEstimateText(block);
      if (text === null) return;
      const value = estimateUpdatedTokens(tokenCacheRef.current.get(index), text);
      nextCache.set(index, { text, tokens: value });
      total += value;
    });
    tokenCacheRef.current = nextCache;
    return Math.round(total);
  }, [streamingMessage]);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  const [tps, setTps] = useState<number | null>(null);
  const tpsRef = useRef<number | null>(null);
  tpsRef.current = tps;
  const rateKeyRef = useRef<string | null>(null);
  rateKeyRef.current = streamingMessage ? streamRateKey(streamingMessage) : null;

  // 速度：300ms 一帧，与旧消息头同频；键按消息（provider/model@timestamp），
  // 同一会话的下一轮回复自然换键重算。
  useEffect(() => {
    if (!active) {
      setTps(null);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const start = streamRateStart(rateKeyRef.current, tokensRef.current, now);
      setTps(streamTokensPerSecond(start, tokensRef.current, now));
    };
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [active]);

  // 结束后停留最后一帧读数，超时撤销。
  const [held, setHeld] = useState<{ tokens: number; tps: number | null } | null>(null);
  const prevActiveRef = useRef(false);
  useEffect(() => {
    if (prevActiveRef.current && !active && tokensRef.current > 0) {
      setHeld({ tokens: tokensRef.current, tps: tpsRef.current });
    }
    if (active) setHeld(null);
    prevActiveRef.current = active;
  }, [active]);
  useEffect(() => {
    if (!held) return;
    const id = setTimeout(() => setHeld(null), RATE_HOLD_MS);
    return () => clearTimeout(id);
  }, [held]);

  const shown = held ?? (active && tokens > 0 ? { tokens, tps } : null);
  if (!shown || shown.tokens <= 0) return null;
  return (
    <div className="pointer-events-none flex min-h-[calc(1.5em+2px)] animate-in fade-in duration-200 items-center gap-1.5 font-mono text-xs leading-[1.5] text-muted-foreground [font-variant-numeric:tabular-nums] motion-reduce:animate-none">
      <StreamRateBadge tokens={shown.tokens} tps={shown.tps} />
    </div>
  );
}
