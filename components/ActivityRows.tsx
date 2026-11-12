"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { BookOpenIcon, BotIcon, CheckIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, ListChecksIcon, PenIcon, SearchIcon, ShrinkIcon, SquareTerminalIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CodeBlock, CodeBlockContent } from "./ui/code-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
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
import { SafeMarkdownBody } from "./SafeMarkdownBody";
import { ImagePreview } from "./ImagePreview";
import { TerminalTrace } from "./transcript/TerminalTrace";
import { ToolTrace } from "./transcript/ToolTrace";
import { TaskTrace } from "./transcript/TaskTrace";
import { SubagentTrace } from "./transcript/SubagentTrace";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { applyPatchResultHasFailures } from "@/lib/apply-patch";
import { isApplyPatchToolName } from "@/lib/tool-names";
import { getMessageImages, getPatchFiles, imageSource, toToolView } from "@/lib/tool-view";
import { formatToolDuration } from "@/lib/tool-duration";

import { getToolCategory, getToolFilePaths, TOOL_CATEGORY_LABEL_KEYS, type ToolCategory } from "@/lib/tool-categories";
import type { SubagentToolDetails } from "@/lib/subagent-extension";
import { formatUsage, type ActivityItem, type TurnUsage, type UsageContextPart } from "@/lib/turn-view";
import { UsageBar } from "./UsageBar";
import { ReasoningTrace } from "./transcript/ReasoningTrace";
import { SourcesTrace } from "./transcript/SourcesTrace";
import { PlanTrace } from "./transcript/PlanTrace";
import { StackTraceTrace } from "./transcript/StackTraceTrace";
import { MediaTrace } from "./transcript/MediaTrace";
import { ToolSection } from "./transcript/ToolTrace";
import type { CustomMessage, TextContent, ToolCallContent, ToolResultMessage } from "@/lib/types";

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





export function ToolRow({ block, result, duration, usage, ctxTokens, ctxWindow, cwd, onOpenFile, onOpenSubagent, isStreaming }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  /** Tool run time in milliseconds (pi 1.1's durationMs, else the timestamps' difference). */
  duration?: number;
  /** The request that issued this tool call (its own assistant message's usage). */
  usage?: TurnUsage;
  /** Prompt tokens of the next request — context occupancy after this call. */
  ctxTokens?: number;
  ctxWindow?: number;
  /** The session directory a chip's relative path resolves against. */
  cwd?: string;
  /** Opens one of the files the call named (its chips). */
  onOpenFile?: (filePath: string) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const active = Boolean(isStreaming) && !result;
  const view = toToolView({ block, result, t });
  const subagent = isSubagentToolDetails(result?.details) ? result.details : null;

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
  // Images, video and audio the call produced: the viewers below the line, never
  // the bytes inside a code block.
  const mediaNode = view.images.length > 0 || view.media
    ? <MediaTrace images={view.images} video={view.media?.video} audio={view.media?.audio} />
    : undefined;

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

  // A failed call is its own shape (第 5.2 节): the X icon, and the whole error
  // repeated above whatever else the call holds.
  // A terminal failure keeps its command header and copy button (第 12.1 节), so
  // only the other kinds take the error shape.
  if (view.status === "error" && view.error && view.kind !== "terminal") {
    const resultText = view.sections.find((section) => section.kind === "code" && section.label === "result")?.text;
    const rest = view.sections.filter((section) => section !== view.sections.find((s) => s.kind === "code" && s.label === "result"));
    return (
      <StackTraceTrace
        title={view.title}
        text={resultText ?? view.error}
        foldKey={view.foldKey}
        activityTool={block.toolName}
        trailing={trailing}
        below={mediaNode}
      >
        {usageNode}
        {rest.map((section, index) => <ToolSection key={index} section={section} />)}
      </StackTraceTrace>
    );
  }

  if (view.kind === "subagent") {
    return (
      <SubagentTrace
        label={subagent?.description || subagent?.profile}
        status={view.status}
        steps={view.sections.find((section) => section.kind === "steps")?.steps}
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
        below={mediaNode}
      />
    );
  }

  if (view.kind === "terminal") {
    return <TerminalTrace view={view} activityTool={block.toolName} trailing={durationNode} usage={usageNode} below={mediaNode} />;
  }

  // A todo snapshot (第 4.2 节): the Plan pattern — what is running now, how far it got, the steps.
  if (view.kind === "queue") {
    const steps = view.sections.find((section) => section.kind === "steps")?.steps ?? [];
    return <PlanTrace steps={steps} foldKey={view.foldKey} activityTool={block.toolName} />;
  }

  // What a search read (第 5.8 节): one line per source, each a link.
  if (view.sources && view.sources.length > 0) {
    return <SourcesTrace sources={view.sources} foldKey={view.foldKey} activityTool={block.toolName} trailing={trailing} below={mediaNode} />;
  }

  return (
    <ToolTrace
      view={view}
      activityTool={block.toolName}
      trailing={trailing}
      usage={usageNode}
      below={mediaNode}
      cwd={cwd}
      onOpenFile={onOpenFile}
    />
  );
}

export function ToolGroupRow({ calls, ctxWindow, cwd, onOpenFile, onOpenSubagent }: {
  calls: ToolCallEntry[];
  ctxWindow?: number;
  /** The session directory a chip's relative path resolves against. */
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
}) {
  const { t } = useI18n();
  const groupKey = `group:${calls[0]?.block.toolCallId ?? ""}`;

  const category = getToolCategory(calls[0]?.block.toolName ?? "");
  const fileCounts = calls.map((call) => (isApplyPatchToolName(call.block.toolName)
    ? (getPatchFiles(call.block, call.result) ?? []).length
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
            cwd={cwd}
            onOpenFile={onOpenFile}
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


// ─────────────────────────────────────────────────────────────────────────────
// Custom message rows (compaction, subagent notifications, extension output)
// ─────────────────────────────────────────────────────────────────────────────

function isSubagentToolDetails(value: unknown): value is SubagentToolDetails {
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

/** Same JSON, formatting aside: a body that repeats the details verbatim needs no second copy. */
function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return a.trim() === b.trim();
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function previewText(text: string, limit = 140): string {
  // 一行预览里的代码栅栏记号（```json）只占位置，没有信息。
  const normalized = text.replace(/```[a-zA-Z0-9]*/g, " ").replace(/\s+/g, " ").trim();
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
  // 自定义事件默认收起（第 4.1 节）：打开会话时它们不该占版面。
  const [expanded, setExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  // 正文本来就是这段 JSON 时（扩展把 details 也写进正文），详情卡只会重复一遍。
  const detailsRepeatBody = hasDetails && sameJson(text.replace(/```[a-zA-Z0-9]*/g, ""), detailsText);
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
                          className="block max-h-[var(--card-max-height)] max-w-60 rounded-md border border-border object-contain"
                        />
                      </ImagePreview>
                    );
                  })}
                </div>
              )}
              {text
                ? <SafeMarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</SafeMarkdownBody>
                : <span className="text-xs text-muted-foreground">{t("i18n.noMessage")}</span>}
              {hasDetails && !detailsRepeatBody && (
                <div className="flex flex-col gap-2">
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
                  </div>
                  {detailsExpanded && (
                    // 详情占满一行；不 reflow，长 id 靠横向滚动看，不被拆成两截。
                    <CodeBlock size="sm">
                      <CodeBlockContent wrap={false} className="max-h-[var(--card-max-height)]">{detailsText}</CodeBlockContent>
                    </CodeBlock>
                  )}
                </div>
              )}
              {(detailsRepeatBody || !hasDetails) && text && (
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
        <SafeMarkdownBody className="markdown-compaction-message" cwd={cwd} onOpenFile={onOpenFile}>{parsedSummary.body}</SafeMarkdownBody>
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
            cwd={cwd}
            onOpenFile={onOpenFile}
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
            cwd={cwd}
            onOpenFile={onOpenFile}
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
        <ReasoningTrace
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







// One row per argument: `key: value` on a single line — the key muted, the
// value in the row's mono face; multiline values keep their own block.
