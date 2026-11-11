"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenIcon, BotIcon, CheckIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, ListChecksIcon, PenIcon, SearchIcon, ShrinkIcon, SquareTerminalIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CodeBlock, CodeBlockContent } from "./ui/code-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Skeleton } from "./ui/skeleton";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./ui/trace";
import { MarkdownBody } from "./MarkdownBody";
import { ImagePreview } from "./ImagePreview";
import { ThinkingIcon } from "./ThinkingIcon";
import { TerminalTrace } from "./transcript/TerminalTrace";
import { ToolTrace } from "./transcript/ToolTrace";
import { TaskTrace } from "./transcript/TaskTrace";
import { SubagentTrace } from "./transcript/SubagentTrace";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import type { SplitDiffCell, SplitDiffFile } from "@/lib/patch";
import { diffGapLabel, unifiedDiffLines, type SplitDiffGap, type UnifiedDiffLine } from "@/lib/patch";
import { applyPatchPreviewToFiles, applyPatchResultHasFailures, extractApplyPatchPaths, getApplyPatchInputText, parseApplyPatchInput } from "@/lib/apply-patch";
import { isApplyPatchToolName, isWriteToolName } from "@/lib/tool-names";
import { toToolView } from "@/lib/tool-view";

// A write's file text in place of its JSON (from main's MessageView). Streamed
// input is still incomplete JSON, and any other argument (a mode, a title)
// would vanish from this view, so those calls keep the generic view.
const WRITE_VIEW_KEYS = new Set(["path", "file_path", "content"]);

export function getWrittenFileText(block: ToolCallContent): string | null {
  if (block.rawInput !== undefined || !isWriteToolName(block.toolName)) return null;
  const { content } = block.input;
  if (typeof content !== "string" || content === "") return null;
  return Object.keys(block.input).every((key) => WRITE_VIEW_KEYS.has(key)) ? content : null;
}
import { COLLAPSIBLE_EXPANDED_EVENT } from "@/lib/tool-call-expansion";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import { getToolCategory, getToolFilePaths, TOOL_CATEGORY_LABEL_KEYS, type ToolCategory } from "@/lib/tool-categories";
import type { SubagentToolDetails } from "@/lib/subagent-extension";
import { formatUsage, type ActivityItem, type TurnUsage, type UsageContextPart } from "@/lib/turn-view";
import { UsageBar } from "./UsageBar";
import type { CustomMessage, ImageContent, TextContent, ThinkingContent, ToolCallContent, ToolResultMessage } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared row primitives
// ─────────────────────────────────────────────────────────────────────────────


function ToolCategoryIcon({ category }: { category: ToolCategory }) {
  const className = "size-[14px] shrink-0";
  switch (category) {
    case "view":
      return <BookOpenIcon className={className} strokeWidth={1.8} />;
    case "search":
      return <SearchIcon className={className} strokeWidth={1.8} />;
    case "edit":
      return <PenIcon className={className} strokeWidth={1.8} />;
    case "terminal":
      return <SquareTerminalIcon className={className} strokeWidth={1.8} />;
    case "subagent":
      return <BotIcon className={className} strokeWidth={1.8} />;
    case "plan":
      return <ListChecksIcon className={className} strokeWidth={1.8} />;
    case "compact":
      return <ShrinkIcon className={className} strokeWidth={1.8} />;
    case "web":
      return <GlobeIcon className={className} strokeWidth={1.8} />;
    default:
      return <WrenchIcon className={className} strokeWidth={1.8} />;
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// Tool call rows
// ─────────────────────────────────────────────────────────────────────────────

/** Below this a tool card shows no time: it would read 0.0s on every quick read or search. */
export const TOOL_DURATION_MIN_MS = 100;

/** A tool's run time as the pi CLI's "Took" writes it: 2.4s, then 3m 5s, then 1h 2m 5s. */
export function formatToolDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

export function getToolCallInputText(block: ToolCallContent): string {
  return block.rawInput ?? JSON.stringify(block.input, null, 2);
}

export interface ToolCallEntry {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  usage?: TurnUsage;
  ctxTokens?: number;
}

function applyPatchPaths(block: ToolCallContent, result?: ToolResultMessage): string[] {
  const fromInput = extractApplyPatchPaths(getApplyPatchInputText(block.input, block.rawInput));
  if (fromInput.length > 0) return fromInput;
  const files = getApplyPatchFiles(block, result);
  return files ? files.map((file) => file.newPath || file.oldPath).filter((path): path is string => Boolean(path)) : [];
}




export function ToolRow({ block, result, duration, usage, ctxTokens, ctxWindow, onOpenSubagent, isStreaming }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  /** Tool run time in milliseconds (pi 1.1's durationMs, else the timestamps' difference). */
  duration?: number;
  /** The request that issued this tool call (its own assistant message's usage). */
  usage?: TurnUsage;
  /** Prompt tokens of the next request — context occupancy after this call. */
  ctxTokens?: number;
  ctxWindow?: number;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const active = Boolean(isStreaming) && !result;
  const view = toToolView({ block, result, t });
  const subagent = isSubagentToolDetails(result?.details) ? result.details : null;
  const resultImages = getMessageImages(result ? result.content : []);

  const durationNode = !active && duration !== undefined
    ? <TraceDescription className="shrink-0 tabular-nums">{formatToolDuration(duration)}</TraceDescription>
    : undefined;
  const usageNode = usage ? (
    <div className="text-[length:calc(11px+var(--chat-font-size-offset,0px))]">
      <UsageBar
        usage={{ input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cost: usage.cost.total }}
        ctx={ctxTokens !== undefined ? { tokens: ctxTokens, contextWindow: ctxWindow } : undefined}
      />
    </div>
  ) : undefined;
  const belowNode = resultImages.length > 0 ? <ResultImages images={resultImages} /> : undefined;

  if (view.kind === "subagent") {
    return (
      <SubagentTrace
        label={subagent?.description || subagent?.profile}
        status={view.status}
        report={view.sections.find((section) => section.kind === "markdown")?.text}
        foldKey={view.foldKey}
        action={subagent && onOpenSubagent ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            onClick={() => onOpenSubagent(subagent.sessionId, subagent.description || subagent.profile)}
            title={t("subagent.openTab")}
            aria-label={t("subagent.openTab")}
          >
            <ExternalLinkIcon strokeWidth={2} />
          </Button>
        ) : undefined}
        below={belowNode}
      />
    );
  }

  if (view.kind === "terminal") {
    return <TerminalTrace view={view} activityTool={block.toolName} trailing={durationNode} usage={usageNode} below={belowNode} />;
  }

  // A patch's own +N −M sits beside the title; every other kind carries the duration alone.
  const trailing = view.diffStat || durationNode ? (
    <span className="flex items-center gap-1.5">
      {view.diffStat && (
        <>
          <Badge variant="ghost" className="bg-success/15 text-success">+{view.diffStat.added}</Badge>
          <Badge variant="ghost" className="bg-destructive/10 text-destructive">−{view.diffStat.removed}</Badge>
        </>
      )}
      {durationNode}
    </span>
  ) : undefined;

  return <ToolTrace view={view} activityTool={block.toolName} trailing={trailing} usage={usageNode} below={belowNode} />;
}

export function ToolGroupRow({ calls, ctxWindow, onOpenSubagent }: {
  calls: ToolCallEntry[];
  ctxWindow?: number;
  onOpenSubagent?: (sessionId: string, label: string) => void;
}) {
  const { t } = useI18n();
  const groupKey = `group:${calls[0]?.block.toolCallId ?? ""}`;

  const category = getToolCategory(calls[0]?.block.toolName ?? "");
  const fileCounts = calls.map((call) => (isApplyPatchToolName(call.block.toolName)
    ? applyPatchPaths(call.block, call.result).length
    : getToolFilePaths(call.block.input).length));
  const allHaveFiles = fileCounts.every((count) => count > 0);
  const fileTotal = fileCounts.reduce((sum, count) => sum + count, 0);
  const totalDuration = calls.reduce((sum, call) => sum + (call.duration ?? 0), 0);
  const hasPending = calls.some((call) => !call.result);
  const isFailedCall = (call: ToolCallEntry) => call.result?.isError
    || (isApplyPatchToolName(call.block.toolName) && applyPatchResultHasFailures(call.result?.details));
  const isError = calls.some(isFailedCall);
  // 分组头给出成败细账：完成的调用按结果拆成 成功 x 次 · 失败 y 次；一次都
  // 没完成（全在跑）时没有账可分，保持原来的「N 次」。
  const failedCount = calls.filter(isFailedCall).length;
  const successCount = calls.filter((call) => call.result).length - failedCount;
  const resultBreakdown = [
    successCount > 0 ? t("chat.activity.successCount", { count: successCount }) : null,
    failedCount > 0 ? t("chat.activity.failCount", { count: failedCount }) : null,
  ].filter(Boolean).join(" · ");
  const summaryCount = allHaveFiles
    ? (resultBreakdown ? `${t("chat.activity.files", { count: fileTotal })} · ${resultBreakdown}` : t("chat.activity.files", { count: fileTotal }))
    : (resultBreakdown || t("chat.activity.calls", { count: calls.length }));

  return (
    <span data-activity-group={category} className="contents">
      <TaskTrace
        title={t(TOOL_CATEGORY_LABEL_KEYS[category])}
        description={summaryCount}
        status={hasPending ? "running" : isError ? "error" : "done"}
        foldKey={groupKey}
        defaultOpen={false}
        trailing={!hasPending && totalDuration > 0 ? (
          <TraceDescription className="shrink-0 tabular-nums">{formatToolDuration(totalDuration)}</TraceDescription>
        ) : undefined}
      >
        {calls.map((call, index) => (
          <ToolRow
            key={call.block.toolCallId ?? index}
            block={call.block}
            result={call.result}
            duration={call.duration}
            usage={call.usage}
            ctxTokens={call.ctxTokens}
            ctxWindow={ctxWindow}
            onOpenSubagent={onOpenSubagent}
          />
        ))}
      </TaskTrace>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thinking rows
// ─────────────────────────────────────────────────────────────────────────────

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

/** Distance from the card's bottom within which a manual scroll re-attaches live follow. */
const THINKING_STREAM_TAIL_TOLERANCE = 24;

export function ThinkingRow({ block, duration, sessionId, entryId, blockIndex, active }: {
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
  const preview = block.thinking.trimStart().match(/^[^\r\n]{0,240}/u)?.[0].trimEnd() ?? "";
  // A card the reader opened or closed themselves keeps that choice: only the
  // automatic expansion of a live block folds away when the block finishes
  // (AI Elements' Reasoning closes itself once the answer starts).
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

  // Stick the inner scroller to the streaming tail. Detaches when the user
  // scrolls up inside the card and re-attaches once they return near the
  // bottom, mirroring the outer message list's live-follow behavior.
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
    // |delta| <= 1 is our own content-growth clamping, not a user scroll.
    if (Math.abs(delta) <= 1) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distanceFromBottom <= THINKING_STREAM_TAIL_TOLERANCE;
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
        <div className="w-full bg-background">
          <TraceCollapsibleTrigger
            aria-label={`${t("i18n.thinking")}${preview ? `: ${preview}` : ""}`}
            title={t("i18n.thinking")}
          >
          <TraceLine status={active ? "running" : undefined}>
            <TraceIcon className={cn(active && "text-warning")}><ThinkingIcon active={expanded || Boolean(active)} /></TraceIcon>
            <TraceTitle className="font-medium">{t("i18n.thinking")}</TraceTitle>
            <TraceDescription className="min-w-0 flex-[0_1_auto] truncate [font-variant-numeric:normal]">
              {preview}
            </TraceDescription>
            {!active && duration !== undefined && (
              <TraceDescription className="shrink-0 text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] tabular-nums">
                {duration}s
              </TraceDescription>
            )}
          </TraceLine>
          </TraceCollapsibleTrigger>
        </div>
        <TraceCollapsibleContent>
          <div
            ref={detailRef}
            className={cn(
              "max-h-[var(--card-max-height)] min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap wrap-anywhere",
              error && "text-destructive",
            )}
            onScroll={handleDetailScroll}
          >
            {loading ? (
              <Skeleton className="h-3 w-1/2" />
            ) : error ?? (block.deferred ? content : block.thinking)}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom message rows (compaction, subagent notifications, extension output)
// ─────────────────────────────────────────────────────────────────────────────

export function isSubagentToolDetails(value: unknown): value is SubagentToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<SubagentToolDetails>;
  return details.kind === "pi-web-subagent" && typeof details.sessionId === "string";
}

function getMessageText(content: CustomMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | ToolResultMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageSource(img: ImageContent): string {
  // SAFETY: same flat-vs-nested image shape split as MessageView; both fields are optional.
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function previewText(text: string, limit = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function customRowLabel(message: CustomMessage, t: (key: string, params?: Record<string, string | number>) => string): { label: string; dim?: boolean } {
  if (message.display === false) return { label: message.customType || t("chat.toolCategory.other"), dim: true };
  if (message.customType === "pi-web:subagent-notification") return { label: t("chat.activity.subagentNotification") };
  return { label: message.customType || "extension" };
}

/** Generic custom-message row: extension output, hook messages, subagent notifications. */
export function CustomRow({ message, cwd, onOpenFile, onOpenSubagent }: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
}) {
  const { t } = useI18n();
  const isHiddenDisplay = message.display === false;
  const [expanded, setExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const subagent = isSubagentToolDetails(message.details) ? message.details : null;
  const { label, dim } = customRowLabel(message, t);
  const preview = previewText(text, 120);

  const copyContent = () => {
    copyText(text || detailsText).then((copied) => {
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Trace data-activity-custom={message.customType} className={isHiddenDisplay ? "opacity-75" : undefined}>
      <div className="flex max-w-full min-w-0 items-center gap-1 bg-background">
        <TraceCollapsible
          open={expanded}
          onOpenChange={() => setExpanded((v) => !v)}
          className="w-auto min-w-0 flex-[0_1_auto]"
        >
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon><ToolCategoryIcon category={subagent ? "subagent" : "other"} /></TraceIcon>
              <TraceTitle className={cn("font-medium", dim && "font-normal")}>{label}</TraceTitle>
              <TraceDescription className="min-w-0 flex-[0_1_auto] truncate [font-variant-numeric:normal]">
                {preview || (isHiddenDisplay ? t("i18n.showExtensionMessage") : null)}
              </TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <div className="flex flex-col gap-2">
              {images.length > 0 && (
                <div className={cn("flex flex-wrap gap-1.5", text && "mb-2")}>
                  {images.map((img, i) => {
                    const src = imageSource(img);
                    if (!src) return null;
                    return (
                      <ImagePreview key={i} src={src}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt=""
                          className="block max-h-60 max-w-60 rounded-md border border-border object-contain"
                        />
                      </ImagePreview>
                    );
                  })}
                </div>
              )}
              {text
                ? <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody>
                : <span className="text-xs text-muted-foreground">{t("i18n.noMessage")}</span>}
              {hasDetails && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Button type="button" variant="ghost" size="xs" onClick={copyContent}>
                    {copied ? t("i18n.copied") : t("i18n.copy")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setDetailsExpanded((v) => !v)}
                  >
                    {detailsExpanded ? t("i18n.hideDetails") : t("i18n.showDetails")}
                  </Button>
                  {detailsExpanded && (
                    <CodeBlock size="sm" className="mt-1.5"><CodeBlockContent wrap>{detailsText}</CodeBlockContent></CodeBlock>
                  )}
                </div>
              )}
              {!hasDetails && text && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Button type="button" variant="ghost" size="xs" onClick={copyContent}>
                    {copied ? t("i18n.copied") : t("i18n.copy")}
                  </Button>
                </div>
              )}
            </div>
          </TraceCollapsibleContent>
        </TraceCollapsible>
        {subagent && onOpenSubagent && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground"
            onClick={() => onOpenSubagent(subagent.sessionId, subagent.description || subagent.profile)}
            title={t("subagent.openTab")}
            aria-label={t("subagent.openTab")}
          >
            <ExternalLinkIcon strokeWidth={2} />
          </Button>
        )}
      </div>
    </Trace>
  );
}

/** Compaction summary row — the anchor message of a compacted turn. */
export function CompactionRow({ message, cwd, onOpenFile }: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const tokensBefore = (message.details as { tokensBefore?: unknown } | undefined)?.tokensBefore;
  const total = parsedSummary.readFiles.length + parsedSummary.modifiedFiles.length;
  const preview = total > 0
    ? t("i18n.fileContext", { details: [
        parsedSummary.modifiedFiles.length > 0 ? `${parsedSummary.modifiedFiles.length} modified` : null,
        parsedSummary.readFiles.length > 0 ? `${parsedSummary.readFiles.length} read` : null,
      ].filter(Boolean).join(", ") })
    : previewText(parsedSummary.body, 120);

  return (
    <Trace data-activity-custom="compaction">
      <TraceCollapsible
        open={expanded}
        onOpenChange={() => setExpanded((v) => !v)}
        className="w-auto min-w-0 flex-[0_1_auto]"
      >
        <div className="w-full bg-background">
          <TraceCollapsibleTrigger title={expanded ? t("i18n.collapse") : t("i18n.expand")}>
          <TraceLine>
            <TraceIcon><ToolCategoryIcon category="compact" /></TraceIcon>
            <TraceTitle className="font-medium">{t("i18n.conversationCompacted")}</TraceTitle>
            <TraceDescription className="min-w-0 flex-[0_1_auto] truncate [font-variant-numeric:normal]">
              {preview}
              {typeof tokensBefore === "number" && Number.isFinite(tokensBefore) && (
                <>
                  {" · "}{t("i18n.compactedFromTokens", { tokens: tokensBefore.toLocaleString() })}
                </>
              )}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        </div>
        <TraceCollapsibleContent>
          <CompactionSummaryDetails summary={summary} cwd={cwd} onOpenFile={onOpenFile} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export function CompactionSummaryDetails({ summary, cwd, onOpenFile }: {
  summary: string;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
}) {
  const { t } = useI18n();
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);

  return (
    <>
      <div className="text-[length:calc(13.5px+var(--chat-font-size-offset,0px))] leading-[1.65] text-foreground">
        {t("i18n.compactionDescription")}
      </div>
      {parsedSummary.body ? (
        <MarkdownBody className="markdown-compaction-message" cwd={cwd} onOpenFile={onOpenFile}>{parsedSummary.body}</MarkdownBody>
      ) : (
        <span className="text-xs text-muted-foreground">{t("i18n.noSummary")}</span>
      )}
      <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
    </>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <Collapsible className="mt-2.5 border-t border-border pt-2 text-xs text-muted-foreground">
      <CollapsibleTrigger className="flex w-full cursor-pointer justify-start text-left font-semibold leading-[1.4]">
        {t("i18n.fileContext", { details: parts.join(", ") })}
      </CollapsibleTrigger>
      {/* forceMount: the native <details> this replaces kept its lists in the
          DOM while closed; the lists are tiny, so stay mounted and hidden. */}
      <CollapsibleContent forceMount>
        {modifiedFiles.length > 0 && <CompactionFileList title={t("i18n.modifiedFiles")} files={modifiedFiles} />}
        {readFiles.length > 0 && <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-xs font-semibold text-foreground">{title}</div>
      <ul className="m-0 max-h-[var(--card-max-height)] list-none overflow-auto p-0 font-mono text-xs leading-[1.45] text-muted-foreground [&_li]:overflow-wrap-anywhere [&_li]:py-[3px] [&_li+li]:border-t [&_li+li]:border-border">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-turn meta line (aggregated usage / model / time)
// ─────────────────────────────────────────────────────────────────────────────

/** One quiet line per turn: model · usage (top-bar format) · time · copy.
 *  ctx = context occupancy after this turn: the next request's prompt size, or
 *  the live reading while this is still the conversation tail. */
export function TurnMetaLine({ usage, model, time, copySource, ctxTokens, liveCtx, ctxWindow }: {
  usage?: TurnUsage | null;
  model?: string;
  time?: string | null;
  /** Final answer text — renders an icon-only copy button at the line end. */
  copySource?: string;
  ctxTokens?: number;
  liveCtx?: { percent: number | null; contextWindow: number } | null;
  ctxWindow?: number;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const ctx: UsageContextPart | undefined = ctxTokens !== undefined
    ? { tokens: ctxTokens, contextWindow: ctxWindow }
    : liveCtx
      ? { percent: liveCtx.percent, contextWindow: liveCtx.contextWindow }
      : undefined;
  const hasUsage = Boolean(usage && (usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cost.total > 0));
  const hasCtx = Boolean(ctx && (ctx.tokens !== undefined || ctx.percent !== undefined || ctx.contextWindow));
  if (!hasUsage && !hasCtx && !model && !time && !copySource) return null;
  return (
    // Room above the next turn's user message: the meta line is the visual
    // boundary between turns, so it needs the same breathing room as the
    // messages themselves (the assistant above contributes its own 12px).
    <div
      className="mt-1 mb-3 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground/60 [font-variant-numeric:tabular-nums]"
      title={usage ? formatUsage(usage) : undefined}
    >
      {model && <span>{model}</span>}
      {(hasUsage || hasCtx) && (
        <UsageBar
          usage={usage ? { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cost: usage.cost.total } : null}
          ctx={ctx}
        />
      )}
      {time && <span>{time}</span>}
      {copySource && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            copyText(copySource).then((copied) => {
              if (!copied) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          title={t("i18n.copyMessage")}
          aria-label={t("i18n.copyMessage")}
          className={cn(
            "ml-auto size-4 rounded-sm p-0.5",
            copied ? "text-primary" : "text-muted-foreground",
          )}
        >
          {copied ? <CheckIcon strokeWidth={1.8} /> : <CopyIcon strokeWidth={1.8} />}
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity item assembly — shared by finished turns and the live tail.
// The ActivityItem / TurnUsage types and formatUsage live in lib/turn-view.
// ─────────────────────────────────────────────────────────────────────────────

/** MarkdownBody with an oversized-content guard: huge messages render as a
 *  click-to-reveal plain-text <pre> instead of running the markdown pipeline. */
const MAX_MARKDOWN_CHARS = 100_000;

export function SafeMarkdownBody({ children, className, ...props }: React.ComponentProps<typeof MarkdownBody>) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);

  if (children.length <= MAX_MARKDOWN_CHARS) {
    return <MarkdownBody className={className} {...props}>{children}</MarkdownBody>;
  }
  if (!showRaw) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setShowRaw(true)}
        className="my-1 h-auto w-full justify-start px-2.5 py-[7px] text-left text-xs font-normal text-muted-foreground"
      >
        <TriangleAlertIcon aria-hidden className="mr-1.5 size-3.5 shrink-0" />
        {t("i18n.largeMessageReveal", { size: children.length >= 1_000_000 ? `${(children.length / 1_000_000).toFixed(1)} MB` : children.length >= 1_000 ? `${Math.round(children.length / 1_000)} KB` : `${children.length} B` })}
      </Button>
    );
  }
  return (
    <div className={cn("max-h-[var(--card-max-height)] overflow-auto text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.5]", className)}>
      <pre className="m-0 whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-muted-foreground">
        {children}
      </pre>
    </div>
  );
}

/**
 * Renders a turn's process as compact activity rows. Consecutive tool calls of
 * the same category merge into one group row; thinking and custom messages get
 * their own row; interstitial prose flows as plain text.
 *
 * Memoized on prop identity: `items` comes from the cached turn view, so list
 * recomputes during streaming reuse the previous identity and finished turns
 * skip re-rendering their rows entirely.
 */
export const TurnActivityBody = memo(function TurnActivityBody({ items, ctxWindow, cwd, onOpenFile, onOpenSubagent, sessionId, live = false }: {
  items: ActivityItem[];
  /** Current model's context window, for the ctx % in per-call usage lines. */
  ctxWindow?: number;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  /** Needed to load deferred thinking content from history on expand. */
  sessionId?: string;
  /** The turn is currently running: groups start expanded and pending rows spin. */
  live?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item.kind === "tool") {
      const category = getToolCategory(item.block.toolName);
      const group: ActivityItem[] = [item];
      let next = index + 1;
      while (
        next < items.length
        && items[next].kind === "tool"
        && getToolCategory((items[next] as Extract<ActivityItem, { kind: "tool" }>).block.toolName) === category
      ) {
        group.push(items[next]);
        next += 1;
      }
      const searchTargetInGroup = group.some((entry) => entry.searchTarget);
      if (group.length === 1) {
        const only = item as Extract<ActivityItem, { kind: "tool" }>;
        nodes.push(
          <ToolRow
            key={item.key}
            block={only.block}
            result={only.result}
            duration={only.duration}
            usage={only.usage}
            ctxTokens={only.ctxTokens}
            ctxWindow={ctxWindow}
            onOpenSubagent={onOpenSubagent}
            isStreaming={live && !only.result}
          />,
        );
      } else {
        nodes.push(
          <ToolGroupRow
            key={`group-${item.key}`}
            calls={(group as Extract<ActivityItem, { kind: "tool" }>[]).map((entry) => ({
              block: entry.block,
              result: entry.result,
              duration: entry.duration,
              usage: entry.usage,
              ctxTokens: entry.ctxTokens,
            }))}
            ctxWindow={ctxWindow}
            onOpenSubagent={onOpenSubagent}
          />,
        );
      }
      if (searchTargetInGroup) {
        // A search hit inside a collapsed group must still be scrollable to.
        nodes.push(<span key={`${item.key}-search-anchor`} data-search-target="true" hidden />);
      }
      index = next;
      continue;
    }
    if (item.kind === "thinking") {
      nodes.push(
        <ThinkingRow
          key={item.key}
          block={item.block}
          duration={item.duration}
          sessionId={sessionId}
          entryId={item.entryId}
          blockIndex={item.blockIndex}
          // Only the block currently being written spins; finished thinking
          // without an estimated duration must not look stuck.
          active={live && item.duration === undefined && index === items.length - 1}
        />,
      );
      index += 1;
      continue;
    }
    if (item.kind === "text") {
      nodes.push(
        <div key={item.key} data-message-text data-search-target={item.searchTarget || undefined}>
          <SafeMarkdownBody>{item.block.text}</SafeMarkdownBody>
        </div>,
      );
      index += 1;
      continue;
    }
    // custom
    const message = (item as Extract<ActivityItem, { kind: "custom" }>).message;
    nodes.push(
      message.customType === "compaction"
        ? <CompactionRow key={item.key} message={message} cwd={cwd} onOpenFile={onOpenFile} />
        : <CustomRow key={item.key} message={message} cwd={cwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} />,
    );
    index += 1;
  }
  return <div className="flex min-w-0 flex-col gap-1.5 [&>[data-message-text]]:my-1">{nodes}</div>;
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool call detail views (moved from MessageView; shared with bash executions)
// ─────────────────────────────────────────────────────────────────────────────

export type PatchDiffLayout = "split" | "stacked";

/**
 * The patch as the viewport can show it. Two columns need two code columns side
 * by side, which a phone does not have: there the same rows read as one column
 * — a removed line above the line that replaces it, each with its own number.
 */
export function PatchDiffFiles({ files, layout }: { files: SplitDiffFile[]; layout: PatchDiffLayout }) {
  const { t } = useI18n();
  const showFileHeaders = files.length > 1;

  return (
    <div className="max-h-[var(--card-max-height)] overflow-x-hidden overflow-y-auto bg-background">
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          className={cn(
            "min-w-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.55]",
            fileIndex > 0 && "border-t border-border",
          )}
        >
          {showFileHeaders && layout === "split" && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border bg-muted">
              <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
              <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
            </div>
          )}

          {showFileHeaders && layout === "stacked" && stackedFilePath(file) && (
            <div
              title={stackedFilePath(file)}
              className="truncate border-b border-border bg-muted px-2.5 py-[5px] text-muted-foreground"
            >
              {stackedFilePath(file)}
            </div>
          )}

          {layout === "split" && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {file.rows.map((row, rowIndex) => {
                if (row.type === "hunk") {
                  return null;
                }
                if (row.type === "gap") {
                  return <DiffGapRow key={rowIndex} gap={row} />;
                }

                return (
                  <div key={rowIndex} className="contents">
                    <SplitDiffCellView cell={row.left} side="left" />
                    <SplitDiffCellView cell={row.right} side="right" />
                  </div>
                );
              })}
            </div>
          )}

          {layout === "stacked" && unifiedDiffLines(file).map((line, lineIndex) => (
            line.type === "gap"
              ? <DiffGapRow key={lineIndex} gap={line} />
              : <StackedDiffLineView key={lineIndex} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Unchanged lines the patch leaves out between two hunks, across the whole width. */
function DiffGapRow({ gap }: { gap: SplitDiffGap }) {
  const { t } = useI18n();
  return (
    <div className="col-span-full select-none border-y border-border bg-muted px-2.5 text-muted-foreground">
      {gap.count === null ? "⋯" : `⋯ ${diffGapLabel(gap.count, t)}`}
    </div>
  );
}

/** The file a stacked section is named for: the new path, the one that survives, unless the file was deleted. */
function stackedFilePath(file: SplitDiffFile): string {
  if (file.newPath && file.newPath !== "/dev/null") return file.newPath;
  return file.oldPath || file.newPath || "";
}

function StackedDiffLineView({ line }: { line: UnifiedDiffLine }) {
  return (
    <SplitDiffCellView
      side="right"
      cell={{
        // One gutter, so a removed line keeps the old number and everything else the new one.
        lineNo: line.type === "removed" ? line.oldLineNo : line.newLineNo,
        text: line.text,
        type: line.type,
      }}
    />
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      className={cn("truncate px-2.5 py-[5px] text-muted-foreground", side === "left" && "border-r border-border")}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const marker = cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  return (
    <div
      className={cn(
        "flex min-w-0",
        cell.type === "added" ? "bg-diff-add-bg" : cell.type === "removed" ? "bg-diff-del-bg" : cell.type === "empty" && "bg-muted",
        side === "left" && "border-r border-border",
      )}
    >
      <span className="w-[42px] shrink-0 select-none border-r border-border bg-card px-1.5 text-right text-muted-foreground">
        {cell.lineNo ?? ""}
      </span>
      <span
        className={cn(
          "w-[18px] shrink-0 select-none px-[5px]",
          cell.type === "added" ? "font-bold text-diff-add" : cell.type === "removed" ? "font-bold text-diff-del" : "font-normal text-muted-foreground",
        )}
      >
        {marker}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 pr-2.5 whitespace-pre-wrap wrap-anywhere",
          cell.type === "empty" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}



/**
 * Split diff rows for an apply_patch-style tool call.
 *
 * Prefers parsing the V4A patch document from the call input. The extension's
 * applied result preview contains the complete old/new file with unchanged
 * lines, so it is only used as a fallback when the call input is unavailable.
 * A single call may contain several file operations — each becomes its own
 * file section.
 */
function getApplyPatchFiles(block: ToolCallContent, result?: ToolResultMessage): SplitDiffFile[] | null {
  if (!isApplyPatchToolName(block.toolName)) return null;

  const fromInput = parseApplyPatchInput(getApplyPatchInputText(block.input, block.rawInput));
  if (fromInput) return fromInput;

  const details = result && !result.isError ? (result as ToolResultMessage & { details?: unknown }).details : undefined;
  if (isRecord(details)) {
    const fromPreview = applyPatchPreviewToFiles(details.preview);
    if (fromPreview) return fromPreview;
  }

  return null;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ResultImages({ images }: { images: ImageContent[] }) {
  return (
    <div
      className="flex flex-wrap gap-1.5 py-1"
    >
      {images.map((image, index) => {
        const src = imageSource(image);
        if (!src) return null;
        return (
          <ImagePreview
            key={`${src}-${index}`}
            src={src}
            className="max-w-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              loading="lazy"
              className="block max-h-[520px] max-w-[min(100%,720px)] rounded-sm border border-border object-contain"
            />
          </ImagePreview>
        );
      })}
    </div>
  );
}

// One row per argument: `key: value` on a single line — the key muted, the
// value in the row's mono face; multiline values keep their own block.
