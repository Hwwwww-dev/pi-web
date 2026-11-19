"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { splitThinkingPieces } from "@/lib/message-display";
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
import { formatToolDurationIfShown } from "@/lib/tool-duration";
import { RowObjectSpan } from "./TraceRow";
import { useI18n } from "@/hooks/useI18n";
import { useSmoothStreamText } from "@/hooks/useSmoothStreamText";
import { COLLAPSIBLE_EXPANDED_EVENT, getFoldChoice, setToolCallExpanded } from "@/lib/tool-call-expansion";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import type { ThinkingContent } from "@/lib/types";

/**
 * A thought (official `pattern_reasoning.md`): one line, the text inside the fold.
 * The running state comes from `TraceLine status="running"` (the shimmer),
 * never from a per-row animation.
 */

/** Deferred history content, cached per block so a reopened fold does not refetch. */
const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();
/** The same texts once they arrived: a fold reopened after a remount starts with its text instead of a skeleton. */
const loadedThinkingContentCache = new Map<string, string>();

function thinkingContentKey(sessionId: string, entryId: string, blockIndex: number): string {
  return `${sessionId}:${entryId}:${blockIndex}`;
}

/** A deferred block's text, when this page already fetched it. */
export function cachedThinkingContent(sessionId: string | undefined, entryId: string | undefined, blockIndex: number): string | undefined {
  if (!sessionId || !entryId) return undefined;
  return loadedThinkingContentCache.get(thinkingContentKey(sessionId, entryId, blockIndex));
}

export function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = thinkingContentKey(sessionId, entryId, blockIndex);
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
    loadedThinkingContentCache.set(key, data.thinking);
    if (loadedThinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
      const oldest = loadedThinkingContentCache.keys().next().value;
      if (oldest) loadedThinkingContentCache.delete(oldest);
    }
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

function ReasoningText({ text, error, loading, fadeIn = false, className, onScroll, scrollRef }: {
  text: string;
  error: string | null;
  loading: boolean;
  /** 仅历史内容延迟加载完的那一次淡入：流式块重挂载时不能重放，否则整段闪一下。 */
  fadeIn?: boolean;
  className?: string;
  onScroll?: () => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  // 分片渲染：单个文本节点会在每个流式 chunk 上整段重排（循环 thinking 可达
  // 数 MB，#1196）。切点只取决于其前的文本，流式期间只有最后一片变化；
  // lineBreak:true 的切点吞掉了一个换行，由块边界补回；硬切（无换行）的
  // 相邻片留在同一行内连排。行数与 innerText 与单节点渲染一致。
  const pieceGroups = useMemo(() => {
    if (loading || error) return null;
    const groups: string[][] = [];
    let line: string[] = [];
    for (const piece of splitThinkingPieces(text)) {
      line.push(piece.text);
      if (piece.lineBreak) {
        groups.push(line);
        line = [];
      }
    }
    if (line.length > 0) groups.push(line);
    return groups;
  }, [loading, error, text]);
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
      {loading ? <Skeleton className="h-3 w-1/2" /> : (
        <div className={cn(fadeIn && "animate-in fade-in duration-200 motion-reduce:animate-none")}>
          {error ?? (pieceGroups ?? [text]).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// memo：props 均为原始值或稳定引用（lib/streaming-message.ts 保证未更新的 thinking
// block 引用不变），长思考回复的每个 chunk 只重渲染仍在增长的那一块。
export const ReasoningTrace = memo(function ReasoningTrace({ block, duration, sessionId, entryId, durationKey, blockIndex, active, asLine = false }: {
  block: ThinkingContent;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  /** 稳定渲染键 + 块序号：折叠选择与实测时长都靠它跨「流式 → 列表 → 读文件」的重挂载。 */
  durationKey?: string;
  blockIndex: number;
  /** The model is still writing this block. */
  active?: boolean;
  /** 只渲染行内容本身（图标+思考+内容尾+时长），供折叠行标题直接嵌入（2026-11-20
   *  用户拍板：标题直接用对应组件）；不带按钮与展开区。 */
  asLine?: boolean;
}) {
  const { t } = useI18n();
  // 手动折叠选择持久化到模块级 store（与工具卡同一套）：回合完成的消息重读会
  // 重挂载本组件（流式气泡 → 列表 → 读文件），仅靠本地 state 会把读者手动
  // 点开的卡片拍回收起。稳定键让这个选择连成一条，而不是每次换一个键。
  const foldKey = durationKey === undefined ? undefined : `thinking:${durationKey}`;
  const [expanded, setExpanded] = useState(() => getFoldChoice(foldKey) ?? isThinkingExpandedByDefault());
  // 流式期吐字平滑：思考文本按帧追赶显示；历史块（非 active）直接全文。
  const liveThinking = useSmoothStreamText(block.thinking, Boolean(active));
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
    const cached = cachedThinkingContent(sessionId, entryId, blockIndex);
    if (cached !== undefined) {
      setContent(cached);
      return;
    }
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
  // 贴底跟随跟随的是显示帧（平滑后的文本），不是 chunk：吐字动画让高度逐帧长，
  // 只挂在 chunk 上会在两 chunk 之间掉队。
  }, [expanded, active, liveThinking, content]);

  const handleDetailScroll = useCallback(() => {
    const el = detailRef.current;
    if (!el) return;
    const delta = el.scrollTop - prevScrollTopRef.current;
    prevScrollTopRef.current = el.scrollTop;
    if (Math.abs(delta) <= 1) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= THINKING_STREAM_TAIL_TOLERANCE;
  }, []);

  // 用户点击的展开/收起走 TraceRow 同款行顶锚定 + 贴底跟随抑制；流结束的自动
  // 收起发生在回合重组里，无需锚定。
  const changeExpanded = useCallback((next: boolean) => {
    userToggledRef.current = true;
    setToolCallExpanded(foldKey, next);
    // Expanding mid-stream means "show me the live tail"; expanding a
    // finished block opens from the top for reading.
    stickRef.current = next && Boolean(active);
    prevScrollTopRef.current = 0;
    setExpanded(next);
    if (next) window.dispatchEvent(new Event(COLLAPSIBLE_EXPANDED_EVENT));
  }, [active, foldKey]);
  const rowRef = useRef<HTMLDivElement>(null);

  // 行头内容尾（2026-11-20 用户拍板，像命令行的命令一样）：流式时平滑打字机，
  // 落盘块直接展示全文尾部；deferred 块内容不在消息里，展开时才加载，行上先空着。
  const tailText = active ? liveThinking : block.deferred ? (content ?? "") : block.thinking;
  const lineChildren = (
    <>
      <TraceIcon>
        <BrainIcon className={cn("size-3.5", expanded ? "text-foreground/70" : "text-muted-foreground")} />
      </TraceIcon>
      <TraceTitle className="shrink-0 font-medium whitespace-nowrap">{t("i18n.thinking")}</TraceTitle>
      {tailText.trim() !== "" && (
        <span className="relative min-w-0 flex-1">
          <RowObjectSpan object={tailText} />
        </span>
      )}
      {!active && duration !== undefined && formatToolDurationIfShown(duration * 1000) && (
        <TraceDescription className="shrink-0 tabular-nums">
          {formatToolDurationIfShown(duration * 1000)}
        </TraceDescription>
      )}
    </>
  );
  if (asLine) return lineChildren;

  return (
    <Trace data-activity="thinking" ref={rowRef}>
      <TraceCollapsible
        open={expanded}
        onOpenChange={() => changeExpanded(!expanded)}
        className="w-full min-w-0 max-w-[80%]"
      >
        <TraceCollapsibleTrigger
          title={t("i18n.thinking")}
        >
          <TraceLine status={active ? "running" : undefined} className="w-full max-w-[80%]">
            {lineChildren}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ReasoningText
            scrollRef={detailRef}
            text={block.deferred ? (content ?? "") : liveThinking}
            error={error}
            loading={loading}
            fadeIn={Boolean(block.deferred)}
            onScroll={handleDetailScroll}
          />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
});
