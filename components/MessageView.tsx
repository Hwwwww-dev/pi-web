"use client";

import { Fragment, memo, useState, useRef, useEffect, useMemo } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, ClockIcon, CopyIcon, CornerDownRightIcon, GitBranchIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Bubble, BubbleContent } from "./ui/bubble";
import { Button } from "./ui/button";
import { Message, MessageContent } from "./ui/message";
import { MarkdownBody } from "./MarkdownBody";
import { ImagePreview } from "./ImagePreview";
import {
  CompactionRow,
  CustomRow,
  SafeMarkdownBody,
  ThinkingRow,
  ToolRow,
} from "./ActivityRows";
import { formatNoticeTokens } from "@/lib/transcript-notices";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { getAssistantErrorMessage, hasAssistantAnswer, isAssistantTruncated, isEmptyThinkingBlock } from "@/lib/message-display";
import { formatTurnDuration } from "@/lib/turn-duration";
import { TurnWrittenFiles } from "./TurnWrittenFiles";
import type { WrittenFile } from "@/lib/turn-written-files";
import { skillExpansionContent, skillExpansionToCommand } from "@/lib/slash-display";
import { streamRateKey, streamRateStart, streamTokensPerSecond, type StreamRateStart } from "@/lib/stream-token-rate";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  BashExecutionMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCallContent,
} from "@/lib/types";

// CJK chars ~1 token each (GLM/DeepSeek/GPT-o200k); other chars ~4 chars/token.
const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;
function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

interface TokenEstimateCacheEntry {
  text: string;
  tokens: number;
}

export function getTokenEstimateText(block: AssistantContentBlock): string | null {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  if (block.type === "toolCall") return block.rawInput ?? JSON.stringify(block.input ?? {}) ?? "";
  return null;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function estimateUpdatedTokens(previous: TokenEstimateCacheEntry | undefined, text: string): number {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);

  let baseTokens = previous.tokens;
  let suffixStart = previous.text.length;
  // A streamed delta can complete a surrogate pair that was counted as two
  // non-CJK code points in the previous update.
  if (
    suffixStart > 0
    && suffixStart < text.length
    && isHighSurrogate(previous.text.charCodeAt(suffixStart - 1))
    && isLowSurrogate(text.charCodeAt(suffixStart))
  ) {
    baseTokens -= 1 / 4;
    suffixStart--;
  }
  return baseTokens + estimateTokens(text.slice(suffixStart));
}

// Messages larger than this skip markdown rendering entirely (guard now lives
// in ActivityRows.SafeMarkdownBody and is shared with activity prose).

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  entryId?: string;
  searchBlock?: AssistantContentBlock;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onEditContent?: (message: UserMessage, entryId: string) => void;
  onCancelEdit?: () => void;
  isEditing?: boolean;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  showModelLabel?: boolean;
  /** Turn-grouped final answers: the copy affordance lives on the turn meta line. */
  hideCopy?: boolean;
  /**
   * Files this turn wrote, derived by the caller from the whole turn's
   * successful write/edit tool calls. ChatWindow computes this because the
   * saved-message path splits tool calls into their own entries, leaving the
   * final answer text-only.
   */
  writtenFiles?: WrittenFile[];
  /** The whole turn's time, for a final answer with no process details to show it. */
  turnDurationMs?: number;
  onCompact?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
}

export function getModelDisplayName(
  provider: string,
  responseModel: string,
  modelNames?: Record<string, string>,
): string {
  const normalizedProvider = provider.toLowerCase();
  const normalizedResponse = responseModel.toLowerCase();
  const configured = Object.entries(modelNames ?? {}).flatMap(([key, name]) => {
    const separator = key.indexOf(":");
    return separator > 0 && key.slice(0, separator).toLowerCase() === normalizedProvider
      ? [{ id: key.slice(separator + 1).toLowerCase(), name }]
      : [];
  });
  return configured.find((model) => model.id === normalizedResponse)?.name
    ?? configured.find((model) => normalizedResponse.endsWith(`/${model.id}`))?.name
    ?? Object.entries(modelNames ?? {}).find(([key]) => key.toLowerCase() === normalizedResponse)?.[1]
    ?? `${provider}/${responseModel}`;
}

export function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

// Kept for the MessageView test-suite import surface; the implementation
// moved with the tool rows.
export { getToolCallInputText } from "./ActivityRows";

export function replaceUserMessageText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };

  const content: Array<TextContent | ImageContent> = [];
  let replaced = false;
  for (const block of message.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (!replaced) {
      content.push({ ...block, text });
      replaced = true;
    }
  }
  if (!replaced) content.unshift({ type: "text", text });
  return { ...message, content };
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, modelNames, cwd, onOpenFile, onOpenSubagent, entryId, searchBlock, onFork, forking, onEditContent, onCancelEdit, isEditing, showTimestamp, prevTimestamp, sessionId, writtenFiles, turnDurationMs, showModelLabel, hideCopy, onCompact, isCompacting, compactError }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} cwd={cwd} onOpenFile={onOpenFile} entryId={entryId} onFork={onFork} forking={forking} onEditContent={onEditContent} onCancelEdit={onCancelEdit} isEditing={isEditing} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} cwd={cwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} sessionId={sessionId} entryId={entryId} searchBlock={searchBlock} writtenFiles={writtenFiles} turnDurationMs={turnDurationMs} showModelLabel={showModelLabel} hideCopy={hideCopy} onCompact={onCompact} isCompacting={isCompacting} compactError={compactError} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    // Standalone custom anchors (compaction, subagent notifications) need turn
    // spacing of their own; inside grouped activity bodies the rows are spaced
    // by the activity container.
    return (
      <div className="mb-5">
        {(message as CustomMessage).customType === "compaction"
          ? <CompactionRow message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} />
          : <CustomRow message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} />}
      </div>
    );
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.entryId === next.entryId
    && prev.searchBlock === next.searchBlock
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    && prev.onEditContent === next.onEditContent
    && prev.onCancelEdit === next.onCancelEdit
    && prev.isEditing === next.isEditing
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.writtenFiles === next.writtenFiles
    && prev.turnDurationMs === next.turnDurationMs
    && prev.sessionId === next.sessionId
    && prev.showModelLabel === next.showModelLabel
    && prev.hideCopy === next.hideCopy
    && prev.onCompact === next.onCompact
    && prev.isCompacting === next.isCompacting
    && prev.compactError === next.compactError;
});

function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onEditContent, onCancelEdit, isEditing }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onEditContent?: (message: UserMessage, entryId: string) => void;
  onCancelEdit?: () => void;
  isEditing?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Session files can hold `\r\n` or lone `\r` line endings (#680). Chrome renders
  // a lone `\r` as a space even in the pre-wrap command-args and raw-text views.
  // Copy uses this text too; the session file keeps the original endings.
  const content = (
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n")
  ).replace(/\r\n?/g, "\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const commandText = skillExpansionToCommand(content);
  const commandSeparator = commandText?.search(/\s/) ?? -1;
  const commandName = commandText
    ? commandSeparator === -1 ? commandText : commandText.slice(0, commandSeparator)
    : "";
  const commandArgs = commandText && commandSeparator !== -1
    ? commandText.slice(commandSeparator + 1)
    : "";

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const copyTarget = commandText ?? content;
  const editTarget = commandText ? replaceUserMessageText(message, commandText) : message;

  const imageBlocksNode = imageBlocks.length > 0 && (
    <div className={cn("flex flex-wrap gap-1.5", content && "mb-2")}>
      {imageBlocks.map((img, i) => {
        // SAFETY: pi-ai's on-disk format stores images flat ({data, mimeType}) while
        // lib/types.ts ImageContent nests them under {source:{type,data,media_type,url}};
        // the fields are read defensively below, so the cast only relaxes the shape.
        const flat = img as unknown as { data?: string; mimeType?: string };
        const src = img.source
          ? img.source.type === "base64"
            ? `data:${img.source.media_type};base64,${img.source.data}`
            : img.source.url ?? ""
          : flat.data
            ? `data:${flat.mimeType};base64,${flat.data}`
            : "";
        return (
          <ImagePreview key={i} src={src}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              className="block max-h-60 max-w-60 rounded-md border border-border object-contain"
            />
          </ImagePreview>
        );
      })}
    </div>
  );
  const canEdit = !!entryId && !!onEditContent;
  const canCancelEdit = !!isEditing && !!onCancelEdit;
  // Edit-in-progress and its cancel stay visible without hover; the rest reveal
  // on the row's hover (touch screens keep them always on via pointer-coarse).
  const pinnedActions = forking || canCancelEdit;

  const copyContent = () => {
    copyText(copyTarget).then((copied) => {
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Message align="end" className="group mb-5 flex flex-col! items-end gap-1">
      <Bubble variant="secondary" align="end" className="max-w-[82%] max-sm:max-w-[86%]">
        {/* Cap the height so an abnormally long message does not push the
            conversation off screen; overflow scrolls inside the bubble. */}
        <BubbleContent
          className={cn(
            "max-h-[300px] overflow-y-auto text-[length:calc(13.5px+var(--chat-font-size-offset,0px))] leading-[1.65] text-foreground",
            isEditing && "ring-2 ring-[color-mix(in_srgb,var(--accent)_16%,transparent)]",
          )}
        >
          {commandText ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              {imageBlocksNode}
              <div className="flex flex-wrap items-start gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setExpanded((prev) => !prev)}
                  title={expanded ? t("i18n.collapse") : t("i18n.expand")}
                  aria-expanded={expanded}
                  className="flex h-auto shrink-0 cursor-pointer items-center gap-1.5 rounded-none border-none bg-transparent p-0 text-left font-mono text-[length:calc(13px+var(--chat-font-size-offset,0px))] font-normal text-primary hover:bg-transparent hover:text-primary"
                >
                  <span className="truncate">
                    {commandName}
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    strokeWidth={2}
                    className={cn("size-[11px] shrink-0 opacity-75 transition-transform", expanded && "rotate-180")}
                  />
                </Button>
                {commandArgs && (
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[length:calc(13.5px+var(--chat-font-size-offset,0px))] leading-[1.65] text-foreground">
                    {commandArgs}
                  </span>
                )}
              </div>
              {expanded && (
                <MarkdownBody className="markdown-user-message" keepLineBreaks cwd={cwd} onOpenFile={onOpenFile}>{skillExpansionContent(content) ?? content}</MarkdownBody>
              )}
            </div>
          ) : (
          <>
          {imageBlocksNode}
          {content && <SafeMarkdownBody className="markdown-user-message" keepLineBreaks cwd={cwd} onOpenFile={onOpenFile}>{content}</SafeMarkdownBody>}
          </>
          )}
        </BubbleContent>
      </Bubble>

      {/* Bottom row: action buttons + timestamp */}
      {(
        <div className={cn(
          "flex items-center justify-end gap-1 transition-opacity",
          pinnedActions
            ? "opacity-100"
            : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
        )}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={copyContent}
            title={t("i18n.copyMessage")}
            aria-label={t("i18n.copyMessage")}
            className={cn("text-muted-foreground", copied && "text-primary")}
          >
            {copied ? <CheckIcon strokeWidth={1.8} /> : <CopyIcon strokeWidth={1.8} />}
          </Button>
          {canEdit && !canCancelEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onEditContent!(editTarget, entryId!)}
              title={t("i18n.editFromHereTitle")}
              aria-label={t("i18n.editFromHere")}
              className="text-muted-foreground"
            >
              <CornerDownRightIcon strokeWidth={1.8} />
            </Button>
          )}
          {canCancelEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onCancelEdit}
              title={t("i18n.cancel")}
              aria-label={t("i18n.cancel")}
              className="text-primary"
            >
              <XIcon strokeWidth={2} />
            </Button>
          )}
          {canFork && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => { onFork!(entryId!); }}
              disabled={forking}
              title={forking ? t("i18n.creatingSession") : t("i18n.newSessionTitle")}
              aria-label={t("i18n.newSession")}
              className={cn("text-muted-foreground", forking && "text-primary")}
            >
              <GitBranchIcon strokeWidth={1.8} />
            </Button>
          )}
          {time && <span className="text-[10px] text-muted-foreground">{time}</span>}
        </div>
      )}
    </Message>
  );
}

export function AssistantMessageHeader({ modelName, estimatedTokens = 0, tps = null, className }: {
  modelName?: string;
  estimatedTokens?: number;
  tps?: number | null;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    // Fixed row height and tabular numerals keep the streaming token count
    // readable while it counts up; widths are content-driven (no reserved
    // minimums — those parked dead space between the number and the badge).
    <div className={cn(
      "flex min-h-[calc(1.5em+2px)] items-center gap-1.5 font-mono text-[11px] leading-[1.5] text-muted-foreground [font-variant-numeric:tabular-nums]",
      className,
    )}>
      {modelName && <span className="min-w-0 truncate">{modelName}</span>}
      {estimatedTokens > 0 && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-foreground" title={t("i18n.estimatedTokens")}>
          <span className="flex items-center gap-0.5 text-[11px] font-normal">
            <ArrowDownIcon aria-hidden className="size-2.5" strokeWidth={1.5} />
            {/* No minimum width on purpose: a reserved 6ch made a finished
                count like 155 carry ~3ch of permanent dead space between the
                number and the badge. tabular-nums keeps the digits readable
                while the count grows; compact wins over never shifting. */}
            <span>{estimatedTokens}</span>
          </span>
          {tps !== null && (
            <Badge
              variant="ghost"
              className={cn(
                // 小号、贴着 token 计数：宽距只由行内 gap-1 提供，徽章不再
                // 自带 ml/最小宽度（那会在数字和徽章之间留出死空间）。
                "px-1.5 py-0 text-[10px]",
                tps > 120 ? "relative overflow-hidden text-white"
                  : tps >= 50 ? "bg-info/15 text-info"
                  : tps >= 30 ? "bg-success/15 text-success"
                  : tps >= 15 ? "bg-warning/15 text-warning"
                  : "bg-destructive/15 text-destructive",
              )}
            >
              {/* >120：文字恒白、背景是流动的彩虹渐变（.tps-rainbow 的
                  多色高亮渐变整条滑动）。档位全序：<15 红 → 15–30 黄 →
                  30–50 绿 → 50–120 蓝 → >120 彩虹，滑动速度随速度加快
                  （300/tps 秒一个循环，0.4s 封底）。 */}
              {tps > 120 ? (
                <>
                  <span
                    aria-hidden
                    className="tps-rainbow absolute inset-0 rounded-[inherit]"
                    style={{ animationDuration: `${Math.max(0.4, 300 / tps).toFixed(2)}s` }}
                  />
                  <span className="relative whitespace-nowrap">{tps.toFixed(1)} t/s</span>
                </>
              ) : `${tps.toFixed(1)} t/s`}
            </Badge>
          )}
        </span>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  onOpenSubagent,
  showTimestamp,
  prevTimestamp,
  sessionId,
  entryId,
  searchBlock,
  writtenFiles,
  turnDurationMs,
  showModelLabel,
  hideCopy,
  onCompact,
  isCompacting,
  compactError,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  entryId?: string;
  searchBlock?: AssistantContentBlock;
  writtenFiles?: WrittenFile[];
  turnDurationMs?: number;
  showModelLabel?: boolean;
  hideCopy?: boolean;
  onCompact?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = useMemo(() => (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming })), [message.content, isStreaming]);
  const blocks = useMemo(() => blockItems.map(({ block }) => block), [blockItems]);
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  const truncated = isAssistantTruncated(message, { isStreaming });
  const unansweredTruncation = truncated && !hasAssistantAnswer(message);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<StreamRateStart | null>(null);
  const rateKey = streamRateKey(message);
  const streamRateKeyRef = useRef(rateKey);
  streamRateKeyRef.current = rateKey;
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;
  const tokenEstimateCacheRef = useRef<Map<number, TokenEstimateCacheEntry>>(new Map());
  const estimatedTokens = useMemo(() => {
    if (!isStreaming) {
      tokenEstimateCacheRef.current = new Map();
      return 0;
    }
    const nextCache = new Map<number, TokenEstimateCacheEntry>();
    let total = 0;
    for (const { block, originalIndex } of blockItems) {
      const text = getTokenEstimateText(block);
      if (text === null) continue;
      const tokens = estimateUpdatedTokens(tokenEstimateCacheRef.current.get(originalIndex), text);
      nextCache.set(originalIndex, { text, tokens });
      total += tokens;
    }
    tokenEstimateCacheRef.current = nextCache;
    return total;
  }, [blockItems, isStreaming]);
  const estimatedTokensRef = useRef(estimatedTokens);
  estimatedTokensRef.current = estimatedTokens;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration of a completed message: the whole response's generation time, which pi
  // records since 1.1 (`durationMs`, from the request's start). Older messages only have
  // timestamps: the time since the previous message.
  const messageDurationMs = message.role === "assistant" ? recordedDurationMs(message.durationMs) : undefined;
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    const ms = messageDurationMs ?? (message.timestamp && prevTimestamp ? message.timestamp - prevTimestamp : undefined);
    if (ms === undefined) return undefined;
    const secs = Math.round(ms / 1000);
    return secs > 0 ? secs : undefined;
  }, [messageDurationMs, message.timestamp, prevTimestamp]);

  // Tool call durations in milliseconds: the execution time pi records on each result since 1.1,
  // as the pi CLI's "Took" shows it. An older result only has timestamps, the result's minus this
  // message's (when its request started), which counts the model's generation too.
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults) return map;
    for (const [callId, result] of toolResults) {
      const ms = recordedDurationMs(result.durationMs)
        ?? (result.timestamp && message.timestamp ? result.timestamp - message.timestamp : undefined);
      if (ms !== undefined && ms >= TOOL_DURATION_MIN_MS) map.set(callId, ms);
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const stats = message.usage ? formatUsage(message.usage) : [];
  if (turnDurationMs !== undefined) {
    if (stats.length > 0) stats.push({ text: "\u00b7" });
    const time = formatTurnDuration(turnDurationMs);
    stats.push(formatDurationPart(t("chat.turnDuration", { time }), time));
  }

  const copyContent = () => {
    copyText(textContent).then((copied) => {
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      const tokens = estimatedTokensRef.current;
      if (tokens === 0) return;
      streamStartRef.current ??= streamRateStart(streamRateKeyRef.current, tokens, now);
      const rate = streamTokensPerSecond(streamStartRef.current, tokens, now);
      if (rate !== null) setTps(rate);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (blocks.length === 0 && !isStreaming && !providerError && !truncated) return null;

  return (
    <Message
      data-message-role="assistant"
      data-entry-id={entryId}
      className="group mb-5"
    >
      <MessageContent>
      {/* Streaming status (estimated tokens + throughput); the model name lives
          in the turn meta line / the per-message label for standalone messages. */}
      {(showModelLabel || isStreaming) && (
        <AssistantMessageHeader
          modelName={showModelLabel && message.provider ? getModelDisplayName(message.provider, message.model, modelNames) : undefined}
          estimatedTokens={isStreaming ? Math.round(estimatedTokens) : 0}
          tps={isStreaming ? tps : null}
          // The live-tail streaming message renders next to the activity rows:
          // line its tokens/rate up with the rows' icon column, and keep it
          // clear of the tool row above.
          className={cn(isStreaming && !showModelLabel && "mt-1.5 pl-1")}
        />
      )}

      {/* Not keyed by the entry id: a message of this run gets one when the file is
          read again, and its blocks keep their state across that read (#1184). */}
      {blockItems.map(({ block, originalIndex }) => (
        <BlockView key={originalIndex} block={block} searchTarget={block === searchBlock} toolResults={toolResults} isStreaming={isStreaming} streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} cwd={cwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} sessionId={sessionId} entryId={entryId} blockIndex={originalIndex} />
      ))}

      {providerError && (
        <Alert variant="destructive" className={cn("font-mono text-xs leading-normal", blocks.length > 0 ? "mt-2" : "mt-0")}>
          <AlertDescription className="whitespace-pre-wrap wrap-anywhere">
            Error: {providerError}
          </AlertDescription>
        </Alert>
      )}

      {truncated && (
        <Alert variant="warning" className={cn("font-mono text-xs leading-normal", blocks.length > 0 || providerError ? "mt-2" : "mt-0")}>
          <AlertDescription className="whitespace-pre-wrap wrap-anywhere">
            {t(unansweredTruncation ? "chat.truncatedWithoutAnswer" : "chat.truncatedByOutputLimit")}
            {unansweredTruncation && onCompact && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={onCompact}
                disabled={isCompacting}
                className="mt-2 w-fit border-current bg-transparent text-current hover:bg-warning/15"
              >
                {t(isCompacting ? "chat.compacting" : "chat.compactContext")}
              </Button>
            )}
            {unansweredTruncation && compactError && (
              <div className="mt-2 whitespace-pre-wrap text-destructive">{compactError}</div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {writtenFiles && writtenFiles.length > 0 && (
        <TurnWrittenFiles files={writtenFiles} onOpenFile={onOpenFile} />
      )}

      {((message.usage && !isStreaming) || (turnDurationMs !== undefined && !isStreaming) || (textContent && !isStreaming && !hideCopy) || (time && !isStreaming)) && (
        <div className="mt-1.5 flex items-center gap-2">
          {(message.usage || turnDurationMs !== undefined) && !isStreaming && (
            // One item per count: a single space at 11px ran them together. The
            // spaces stay in the text for copying; the flex gap draws the room.
            <div className="flex flex-wrap gap-x-[7px] font-mono text-[11px] text-muted-foreground tabular-nums">
              {stats.map((part, index) => (
                <Fragment key={index}>{index > 0 && " "}<UsagePart part={part} /></Fragment>
              ))}
            </div>
          )}
          {textContent && !isStreaming && !hideCopy && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={copyContent}
            title={t("i18n.copyMessage")}
            aria-label={t("i18n.copyMessage")}
            className={cn(
              "pointer-events-none shrink-0 text-muted-foreground opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
              copied && "text-primary",
            )}
          >
            {copied ? <CheckIcon strokeWidth={1.8} /> : <CopyIcon strokeWidth={1.8} />}
          </Button>
          )}
          {time && !isStreaming && (
            <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">{time}</span>
          )}
        </div>
      )}
      </MessageContent>
    </Message>
  );
}

function BlockView({ block, searchTarget, toolResults, isStreaming, streamingDuration, toolCallDurations, cwd, onOpenFile, onOpenSubagent, sessionId, entryId, blockIndex }: { block: AssistantContentBlock; searchTarget?: boolean; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; cwd?: string; onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void; onOpenSubagent?: (sessionId: string, label: string) => void; sessionId?: string; entryId?: string; blockIndex: number }) {
  if (block.type === "text") {
    return <div data-message-text data-search-target={searchTarget || undefined}><TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} /></div>;
  }
  if (block.type === "thinking") {
    return <ThinkingRow block={block as ThinkingContent} duration={streamingDuration} sessionId={sessionId} entryId={entryId} blockIndex={blockIndex} active={isStreaming && streamingDuration === undefined} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return <ToolRow block={tc} result={result} duration={duration} cwd={cwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} isStreaming={isStreaming} />;
  }
  return null;
}

function TextBlock({ block, isStreaming, cwd, onOpenFile }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void }) {
  return <SafeMarkdownBody isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>{block.text}</SafeMarkdownBody>;
}


/** A duration pi recorded on a message, or undefined when there is none to trust. */
function recordedDurationMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Below this a tool card shows no time: it would read 0.0s on every quick read or search. */
export { CompactionSummaryDetails, formatToolDuration, TOOL_DURATION_MIN_MS } from "./ActivityRows";
import { TOOL_DURATION_MIN_MS } from "./ActivityRows";




function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): StatPart[] {
  // pi's TUI footer: ↑1.2k ↓567 R8.9k W12, with its formatTokens().
  const parts: StatPart[] = [];
  if (usage.input) parts.push({ icon: "up", before: "↑", text: formatNoticeTokens(usage.input) });
  if (usage.output) parts.push({ icon: "down", before: "↓", text: formatNoticeTokens(usage.output) });
  if (usage.cacheRead) parts.push({ text: `R${formatNoticeTokens(usage.cacheRead)}` });
  if (usage.cacheWrite) parts.push({ text: `W${formatNoticeTokens(usage.cacheWrite)}` });
  if (usage.cost?.total) parts.push({ text: `$${usage.cost.total.toFixed(4)}` });
  return parts;
}

// "took 12s" as a clock and "12s": the words around the time stay as hidden
// text, wherever the language puts them.
function formatDurationPart(label: string, time: string): StatPart {
  const index = label.indexOf(time);
  if (index < 0) return { text: label };
  return { icon: "clock", before: label.slice(0, index), text: time, after: label.slice(index + time.length) };
}

/** One count of the stats line; `before`/`after` are copied and read aloud, not shown. */
interface StatPart {
  text: string;
  icon?: "up" | "down" | "clock";
  before?: string;
  after?: string;
}

// Unseen but still text: font-size 0 stays in a copied selection, where a
// zero-width overflow box drops it and sr-only's absolute box adds a line break.
const HIDDEN_STAT_TEXT = "text-[0px]";

// ↑ and ↓ come from whatever font has them: Segoe UI or a CJK fallback on
// Windows draws them small, heavy or off the baseline. The icons are drawn
// here instead; their text stays, zero-width, for copying and screen readers.
// Everything stays inline: a block or flex box would copy as a line break
// between the icon and its count.
function UsagePart({ part }: { part: StatPart }) {
  if (!part.icon) return <span>{part.text}</span>;
  const Icon = part.icon === "clock" ? ClockIcon : part.icon === "up" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span>
      {part.before && <span className={HIDDEN_STAT_TEXT}>{part.before}</span>}
      <Icon
        aria-hidden
        strokeWidth={2}
        className={cn(
          "inline",
          part.icon === "clock" ? "mr-[3px] size-[10px] align-[-0.1em]" : "mr-px size-[9px] align-[-0.05em]",
        )}
      />
      {part.text}
      {part.after && <span className={HIDDEN_STAT_TEXT}>{part.after}</span>}
    </span>
  );
}

function BashExecutionView({ message, sessionId }: { message: BashExecutionMessage; sessionId?: string }) {
  const { t } = useI18n();
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const isPending = !message.output && message.exitCode === undefined && !message.cancelled;
  const isError = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputUrl = sessionId && message.fullOutputPath
    ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(message.fullOutputPath)}`
    : null;
  const showFullButton = message.truncated && fullOutputUrl && fullOutput === null;
  const displayOutput = fullOutput ?? message.output;

  async function loadFullOutput() {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const res = await fetch(fullOutputUrl);
      const d = await res.json() as { success?: boolean; data?: { output?: string }; error?: string };
      if (d.success) {
        setFullOutput(d.data?.output ?? "");
      } else {
        setFullError(d.error ?? "failed");
      }
    } catch (e) {
      setFullError(String(e));
    } finally {
      setLoadingFull(false);
    }
  }

  // Reuse ToolRow so user-run bash looks identical to an agent-run bash tool
  // call: same header, collapse behavior, result pane.
  // Synthesize an equivalent ToolCallContent + ToolResultMessage pair.
  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? ""}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending
    ? undefined
    : {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName,
        content: displayOutput ? [{ type: "text", text: displayOutput }] : [],
        isError,
        timestamp: message.timestamp,
      };

  return (
    <div className="mb-5">
      <ToolRow block={block} result={result} isStreaming={isPending} />
      {message.truncated && fullOutputUrl && (
        <div className="-mt-px px-1 py-1 text-xs">
          {showFullButton && (
            <Button
              type="button"
              variant="link"
              onClick={loadFullOutput}
              disabled={loadingFull}
              className="h-auto p-0 text-xs underline"
            >
              {loadingFull ? t("chat.loadingFullOutput") : t("chat.viewFullOutput")}
            </Button>
          )}
          <a
            href={`${fullOutputUrl}&download=1`}
            className={cn("text-xs text-primary underline", showFullButton && "ml-2.5")}
          >
            {t("chat.downloadFullOutput")}
          </a>
          {fullError && <span className="ml-1.5 text-xs text-muted-foreground">({fullError})</span>}
        </div>
      )}
    </div>
  );
}
