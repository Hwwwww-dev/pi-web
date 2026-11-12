"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { formatToolDuration } from "@/lib/tool-duration";
import { useI18n } from "@/hooks/useI18n";
import { COLLAPSIBLE_EXPANDED_EVENT } from "@/lib/tool-call-expansion";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import type { ThinkingContent } from "@/lib/types";

/**
 * A thought (官方 `pattern_reasoning.md`): one line, the text inside the fold.
 * The running state comes from `TraceLine status="running"` (the shimmer),
 * never from a per-row animation.
 */

/** Deferred history content, cached per block so a reopened fold does not refetch. */
const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

export function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { thinking?: unknown };
    if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
    return data.thinking;
  }).catch((error) => {
    thinkingContentCache.delete(key);
    throw error;
  });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

/** |delta| ≤ 1 is our own content growth, not a user scroll. */
const THINKING_STREAM_TAIL_TOLERANCE = 24;

function ReasoningText({ text, error, loading, className, onScroll, scrollRef }: {
  text: string;
  error: string | null;
  loading: boolean;
  className?: string;
  onScroll?: () => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        "max-h-[var(--card-max-height)] min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap wrap-anywhere text-[length:calc(13px+var(--chat-font-size-offset,0px))]",
        error && "text-destructive",
        className,
      )}
      onScroll={onScroll}
    >
      {loading ? <Skeleton className="h-3 w-1/2" /> : error ?? text}
    </div>
  );
}

export function ReasoningTrace({ block, duration, sessionId, entryId, blockIndex, active }: {
  block: ThinkingContent;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  /** The model is still writing this block. */
  active?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(isThinkingExpandedByDefault);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const detailRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const prevScrollTopRef = useRef(0);
  // A card the reader opened or closed themselves keeps that choice: only the
  // automatic expansion of a live block folds away when the block finishes.
  const userToggledRef = useRef(false);
  const wasActiveRef = useRef(Boolean(active));
  useEffect(() => {
    if (wasActiveRef.current && !active && !userToggledRef.current) setExpanded(false);
    wasActiveRef.current = Boolean(active);
  }, [active]);

  // Keep already-mounted blocks in sync when the preference changes.
  useEffect(() => {
    const onChange = () => setExpanded(isThinkingExpandedByDefault());
    window.addEventListener(THINKING_EXPANDED_EVENT, onChange);
    return () => window.removeEventListener(THINKING_EXPANDED_EVENT, onChange);
  }, []);

  // Load deferred history content whenever the block is expanded.
  useEffect(() => {
    if (!expanded || !block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(tRef.current("i18n.thinkingUnavailable"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadThinkingContent(sessionId, entryId, blockIndex)
      .then((value) => {
        if (!cancelled) {
          setContent(value);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, block.deferred, content, sessionId, entryId, blockIndex]);

  // Stick the inner scroller to the streaming tail.
  useEffect(() => {
    const el = detailRef.current;
    if (!el || !expanded || !active || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
  }, [expanded, active, block.thinking, content]);

  const handleDetailScroll = useCallback(() => {
    const el = detailRef.current;
    if (!el) return;
    const delta = el.scrollTop - prevScrollTopRef.current;
    prevScrollTopRef.current = el.scrollTop;
    if (Math.abs(delta) <= 1) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= THINKING_STREAM_TAIL_TOLERANCE;
  }, []);

  return (
    <Trace data-activity="thinking">
      <TraceCollapsible
        open={expanded}
        onOpenChange={() => {
          const next = !expanded;
          userToggledRef.current = true;
          // Expanding mid-stream means "show me the live tail"; expanding a
          // finished block opens from the top for reading.
          stickRef.current = next && Boolean(active);
          prevScrollTopRef.current = 0;
          setExpanded(next);
          if (next) window.dispatchEvent(new Event(COLLAPSIBLE_EXPANDED_EVENT));
        }}
        className="w-auto min-w-0 flex-[0_1_auto]"
      >
        <TraceCollapsibleTrigger
          title={t("i18n.thinking")}
        >
          <TraceLine status={active ? "running" : undefined}>
            <TraceIcon>
              <BrainIcon className={cn("size-3.5", expanded ? "text-warning" : "text-muted-foreground")} />
            </TraceIcon>
            <TraceTitle className="shrink-0 font-medium whitespace-nowrap">{t("i18n.thinking")}</TraceTitle>
            {!active && duration !== undefined && (
              <TraceDescription className="shrink-0 tabular-nums">
                {formatToolDuration(duration * 1000)}
              </TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ReasoningText
            scrollRef={detailRef}
            text={block.deferred ? (content ?? "") : block.thinking}
            error={error}
            loading={loading}
            onScroll={handleDetailScroll}
          />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
