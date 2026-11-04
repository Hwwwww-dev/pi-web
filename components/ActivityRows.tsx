"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenIcon, BotIcon, CheckIcon, CircleXIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, ListChecksIcon, PenIcon, SearchIcon, ShrinkIcon, SquareTerminalIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockContent } from "./ui/code-block";
import { Spinner } from "./ui/spinner";
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
import { getFileIcon } from "./FileIcons";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { isTuiText } from "@/lib/ansi";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { resolveLocalFilePath } from "@/lib/file-links";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SplitDiffCell, SplitDiffFile } from "@/lib/patch";
import { diffGapLabel, parseUnifiedPatch, unifiedDiffLines, type SplitDiffGap, type UnifiedDiffLine } from "@/lib/patch";
import { applyPatchPreviewToFiles, applyPatchResultHasFailures, extractApplyPatchPaths, getApplyPatchInputText, parseApplyPatchInput } from "@/lib/apply-patch";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "@/lib/tool-names";

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
import { COLLAPSIBLE_EXPANDED_EVENT, isToolCallExpanded, setToolCallExpanded } from "@/lib/tool-call-expansion";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import { getToolCategory, getToolFilePaths, getToolPreviewText, TOOL_CATEGORY_LABEL_KEYS, type ToolCategory } from "@/lib/tool-categories";
import { CODEMODE_TOOL_NAME, codemodeCalls, codemodeScript, codemodeScriptPreview, stripCodemodeHeader } from "@/lib/codemode-view";
import { toolFieldsOfInput, type ToolField } from "@/lib/tool-fields";
import { mcpToolLabel, prettyMcpResultText } from "@/lib/mcp-tool-display";
import { CodemodeCallList } from "./CodemodeToolView";
import { parseStreamingJson } from "@earendil-works/pi-ai/utils/json-parse";
import type { SubagentToolDetails } from "@/lib/subagent-extension";
import { formatUsage, type ActivityItem, type TurnUsage, type UsageContextPart } from "@/lib/turn-view";
import { UsageBar } from "./UsageBar";
import type { CustomMessage, ImageContent, TextContent, ThinkingContent, ToolCallContent, ToolResultMessage } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared row primitives
// ─────────────────────────────────────────────────────────────────────────────

function RowSpinner({ className }: { className?: string }) {
  return <Spinner aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

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

/** A row's leading icon: spinner while running, the error glyph on failure. */
function RowStatusIcon({ category, isError, active }: { category?: ToolCategory; isError?: boolean; active?: boolean }) {
  if (active) return <RowSpinner className="text-warning" />;
  if (isError) return <CircleXIcon className="size-[14px] shrink-0 text-destructive" strokeWidth={1.8} />;
  if (category) return <ToolCategoryIcon category={category} />;
  return null;
}

/** A clickable file reference inside a tool row, opening the file viewer.
 *  A span rather than a button: it sits inside the row-header button, and
 *  nested buttons double-trigger the row toggle and trip validateDOMNesting. */
function ToolFileChip({ path, cwd, onOpenFile }: { path: string; cwd?: string; onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void }) {
  const resolved = resolveLocalFilePath(path, cwd);
  const name = getFileName(resolved ?? path);
  const relative = cwd ? getRelativeFilePath(resolved ?? path, cwd) : resolved ?? path;
  const dir = relative.includes("/")
    ? relative.slice(0, relative.lastIndexOf("/"))
    : relative.includes("\\")
      ? relative.slice(0, relative.lastIndexOf("\\"))
      : null;
  const clickable = Boolean(onOpenFile && resolved);
  const activate = () => onOpenFile!(resolved!);
  return (
    <span
      className={cn("tool-file-chip", !clickable && "cursor-default")}
      title={resolved ?? path}
      aria-label={name}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? (event) => { event.stopPropagation(); activate(); } : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.stopPropagation();
        event.preventDefault();
        activate();
      } : undefined}
    >
      {getFileIcon(name, 12)}
      <span className="tool-file-chip-name">{name}</span>
      {dir && <span className="tool-file-chip-dir">{dir}/</span>}
    </span>
  );
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

/** Preview nodes for a collapsed tool row: file chips when the call targets files. */
function ToolRowPreview({ block, result, cwd, onOpenFile }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
}) {
  const paths = useMemo(() => {
    if (isApplyPatchToolName(block.toolName)) return applyPatchPaths(block, result);
    return getToolFilePaths(block.input);
  }, [block, result]);

  if (paths.length > 0 && onOpenFile) {
    return (
      <span className="tool-row-chips">
        {paths.slice(0, 4).map((path) => <ToolFileChip key={path} path={path} cwd={cwd} onOpenFile={onOpenFile} />)}
        {paths.length > 4 && <span className="tool-row-more">+{paths.length - 4}</span>}
      </span>
    );
  }
  const preview = getToolPreviewText(block).slice(0, 160);
  if (!preview) return null;
  return <>{preview}</>;
}

/** A patch over exactly one file names it, for calls whose input names no file. */
function singlePatchPath(text: string | undefined): string | null {
  if (!text) return null;
  const files = parseUnifiedPatch(text);
  if (!files || files.length !== 1) return null;
  return files[0].newPath || files[0].oldPath || null;
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
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() => isToolCallExpanded(block.toolCallId));
  const toggleExpanded = () => {
    const next = !expanded;
    setToolCallExpanded(block.toolCallId, next);
    setExpanded(next);
  };

  const category = getToolCategory(block.toolName);
  const inputStr = getToolCallInputText(block);
  const writtenFileText = getWrittenFileText(block);
  const isStreamingInput = block.rawInput !== undefined;
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const diffStat = resultDiff ? countDiffStat(resultDiff.text) : null;
  const patchFiles = getApplyPatchFiles(block, result);
  // A script and the calls it made, instead of the input JSON. Streamed input is
  // still incomplete JSON and keeps the generic view.
  const codemodeCode = block.toolName === CODEMODE_TOOL_NAME && !isStreamingInput ? codemodeScript(block.input) : null;
  const codemode = codemodeCode === null ? null : { code: codemodeCode, ...codemodeCalls(result?.details) };
  // `server/tool` instead of the registered `mcp__server__tool`, as pi's TUI shows it.
  const mcpLabel = mcpToolLabel(block.toolName, result?.details);
  const resultContent = result ? (codemode ? stripCodemodeHeader(result.content) : result.content) : [];
  const joinedResultText = result
    ? resultContent.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultText = mcpLabel && joinedResultText !== null ? prettyMcpResultText(joinedResultText) : joinedResultText;
  const resultImages = getMessageImages(resultContent);
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = (result?.isError ?? false)
    || (isApplyPatchToolName(block.toolName) && applyPatchResultHasFailures(result?.details));
  const subagent = isSubagentToolDetails(result?.details) ? result.details : null;
  const codemodeCallCount = codemode ? codemode.calls.length + codemode.omitted : 0;
  const active = Boolean(isStreaming) && !result;
  // Terminal rows render command + output as one ZCode-style block ($ cmd, then
  // the output) instead of the raw JSON args.
  const commandText = category === "terminal" && !isStreamingInput && typeof block.input?.command === "string"
    ? block.input.command
    : null;
  const combinedTerminalText = commandText !== null
    ? `$ ${commandText}${resultText && !resultIsEmpty ? `\n\n${resultText}` : ""}`
    : null;
  // Flat arguments as rows instead of a JSON blob, unless the card has a view of
  // its own (a write's file text, codemode, an applied patch, a terminal pair).
  // Streamed input is incomplete JSON: pi's partial parse shows the fields it
  // has so far, and a nested argument begun keeps the raw text.
  const toolFields =
    writtenFileText === null && codemode === null && patchFiles === null && combinedTerminalText === null
      ? isStreamingInput
        ? toolFieldsOfInput(parseStreamingJson(block.rawInput))
        : toolFieldsOfInput(block.input)
      : null;

  const label = category === "other" ? block.toolName : t(TOOL_CATEGORY_LABEL_KEYS[category]);
  // The result's single-file patch names the call when its input has no file.
  const patchLabel = getToolFilePaths(block.input).length === 0 ? singlePatchPath(resultDiff?.text) : null;

  return (
    <Trace data-activity-tool={block.toolName}>
      <div className="flex max-w-full min-w-0 items-center gap-1">
        <TraceCollapsible
          open={expanded}
          onOpenChange={toggleExpanded}
          className="w-auto min-w-0 flex-[0_1_auto]"
        >
          <TraceCollapsibleTrigger title={mcpLabel || patchLabel ? block.toolName : undefined}>
            <TraceLine status={active ? "running" : isError ? "error" : undefined}>
              <TraceIcon><RowStatusIcon category={category} isError={isError} active={active} /></TraceIcon>
              <TraceTitle className="font-medium">
                {mcpLabel ? `${mcpLabel.server}/${mcpLabel.tool}` : patchLabel ?? label}
              </TraceTitle>
              <TraceDescription className="min-w-0 flex-[0_1_auto] truncate font-mono text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] [font-variant-numeric:normal]">
                {isStreamingInput
                  ? t("chat.generatingToolInput")
                  : codemode
                    ? codemodeScriptPreview(codemode.code)
                    : patchLabel
                      ? null
                      : <ToolRowPreview block={block} result={result} cwd={cwd} onOpenFile={onOpenFile} />}
              </TraceDescription>
              {codemodeCallCount > 0 && (
                <TraceDescription className="shrink-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))]">
                  {codemodeCallCount === 1 ? t("codemode.callCountOne") : t("codemode.callCount", { count: codemodeCallCount })}
                </TraceDescription>
              )}
              {diffStat && (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium" aria-hidden="true">
                  <span className="rounded-full bg-success/15 px-1.5 text-success">+{diffStat.added}</span>
                  <span className="rounded-full bg-destructive/10 px-1.5 text-destructive">−{diffStat.removed}</span>
                </span>
              )}
              {!active && duration !== undefined && (
                <TraceDescription className="shrink-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))]">
                  {formatToolDuration(duration)}
                </TraceDescription>
              )}
              {!active && isError && result && (
                <TraceDescription className="shrink-0 font-medium text-destructive [font-variant-numeric:normal]">
                  {t("chat.activity.failed")}
                </TraceDescription>
              )}
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <div className="flex flex-col gap-2">
              {usage && (
                <div className="text-[length:calc(11px+var(--chat-font-size-offset,0px))]">
                  <UsageBar
                    usage={{ input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cost: usage.cost.total }}
                    ctx={ctxTokens !== undefined ? { tokens: ctxTokens, contextWindow: ctxWindow } : undefined}
                  />
                </div>
              )}
              {codemode ? (
                <>
                  <CodeBlock size="sm"><CodeBlockContent wrap>{codemode.code.replace(/\r/g, "").trimEnd()}</CodeBlockContent></CodeBlock>
                  <CodemodeCallList calls={codemode.calls} omitted={codemode.omitted} isError={isError} />
                  {result && (resultText !== null && !resultIsEmpty || resultImages.length > 0) && (
                    <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
                  )}
                </>
              ) : combinedTerminalText !== null ? (
                <CodeBlock size="sm" variant={isError ? "destructive" : "default"}>
                  <CodeBlockContent wrap={false}>{combinedTerminalText}</CodeBlockContent>
                </CodeBlock>
              ) : (
                <>
                  {(isStreamingInput || !isEditToolName(block.toolName)) && !patchFiles && (
                    toolFields ? (
                      <ToolFieldRows fields={toolFields} />
                    ) : (
                      <CodeBlock size="sm"><CodeBlockContent wrap>{writtenFileText ?? inputStr}</CodeBlockContent></CodeBlock>
                    )
                  )}
                  {patchFiles && <SplitFilesView files={patchFiles} />}
                  {result && patchFiles && isError && (
                    <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
                  )}
                  {result && !patchFiles && combinedTerminalText === null && (
                    resultDiff ? <SplitPatchView text={resultDiff.text} /> : (!resultIsEmpty || resultImages.length === 0) && (
                      <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
                    )
                  )}
                </>
              )}
            </div>
          </TraceCollapsibleContent>
        </TraceCollapsible>
        {subagent && onOpenSubagent && (
          <button
            type="button"
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => onOpenSubagent(subagent.sessionId, subagent.description || subagent.profile)}
            title={t("subagent.openTab")}
            aria-label={t("subagent.openTab")}
          >
            <ExternalLinkIcon className="size-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {resultImages.length > 0 && <ResultImages images={resultImages} />}
    </Trace>
  );
}

/** Merges consecutive same-category tool calls into one collapsed summary row. */
export function ToolGroupRow({ calls, ctxWindow, cwd, onOpenFile, onOpenSubagent }: {
  calls: ToolCallEntry[];
  ctxWindow?: number;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
}) {
  const { t } = useI18n();
  const groupKey = `group:${calls[0]?.block.toolCallId ?? ""}`;
  // Always start collapsed — live tail, reopened conversations, and finished
  // turns look the same; only a user click expands (remembered across the
  // streaming remounts by toolCallId).
  const [expanded, setExpanded] = useState(() => isToolCallExpanded(groupKey));
  const toggleExpanded = () => {
    const next = !expanded;
    setToolCallExpanded(groupKey, next);
    setExpanded(next);
  };

  const category = getToolCategory(calls[0]?.block.toolName ?? "");
  const fileCounts = calls.map((call) => (isApplyPatchToolName(call.block.toolName)
    ? applyPatchPaths(call.block, call.result).length
    : getToolFilePaths(call.block.input).length));
  const allHaveFiles = fileCounts.every((count) => count > 0);
  const fileTotal = fileCounts.reduce((sum, count) => sum + count, 0);
  const summaryCount = allHaveFiles
    ? t("chat.activity.files", { count: fileTotal })
    : t("chat.activity.calls", { count: calls.length });
  const totalDuration = calls.reduce((sum, call) => sum + (call.duration ?? 0), 0);
  const hasPending = calls.some((call) => !call.result);
  const isError = calls.some((call) => call.result?.isError
    || (isApplyPatchToolName(call.block.toolName) && applyPatchResultHasFailures(call.result?.details)));

  return (
    <Trace data-activity-group={category}>
      <TraceCollapsible
        open={expanded}
        onOpenChange={toggleExpanded}
        className="w-auto min-w-0 flex-[0_1_auto]"
      >
        <TraceCollapsibleTrigger>
          <TraceLine status={hasPending ? "running" : isError ? "error" : undefined}>
            <TraceIcon><RowStatusIcon category={category} isError={isError} active={hasPending} /></TraceIcon>
            <TraceTitle className="font-medium">{t(TOOL_CATEGORY_LABEL_KEYS[category])}</TraceTitle>
            <TraceDescription className="min-w-0 flex-[0_1_auto] truncate font-mono text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] [font-variant-numeric:normal]">
              {summaryCount}
            </TraceDescription>
            {!hasPending && totalDuration > 0 && (
              <TraceDescription className="shrink-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))]">
                {formatToolDuration(totalDuration)}
              </TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-0.5 py-0.5">
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
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
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
          aria-label={`${t("i18n.thinking")}${preview ? `: ${preview}` : ""}`}
          title={t("i18n.thinking")}
        >
          <TraceLine status={active ? "running" : undefined}>
            <TraceIcon className={cn(active && "text-warning")}><ThinkingIcon active={expanded || Boolean(active)} /></TraceIcon>
            <TraceTitle className="font-medium">{t("i18n.thinking")}</TraceTitle>
            <TraceDescription className="min-w-0 flex-[0_1_auto] truncate font-mono text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] [font-variant-numeric:normal]">
              {preview}
            </TraceDescription>
            {!active && duration !== undefined && (
              <TraceDescription className="shrink-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))]">
                {duration}s
              </TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div
            ref={detailRef}
            className={cn(
              "max-h-[380px] min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap wrap-anywhere",
              error && "text-destructive",
            )}
            onScroll={handleDetailScroll}
          >
            {loading ? t("i18n.loadingThinking") : error ?? (block.deferred ? content : block.thinking)}
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
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Trace data-activity-custom={message.customType} className={isHiddenDisplay ? "opacity-75" : undefined}>
      <div className="flex max-w-full min-w-0 items-center gap-1">
        <TraceCollapsible
          open={expanded}
          onOpenChange={() => setExpanded((v) => !v)}
          className="w-auto min-w-0 flex-[0_1_auto]"
        >
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon><ToolCategoryIcon category={subagent ? "subagent" : "other"} /></TraceIcon>
              <TraceTitle className={cn("font-medium", dim && "font-normal")}>{label}</TraceTitle>
              <TraceDescription className="min-w-0 flex-[0_1_auto] truncate font-mono text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] [font-variant-numeric:normal]">
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
                  <button type="button" onClick={copyContent} className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground">
                    {copied ? t("i18n.copied") : t("i18n.copy")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailsExpanded((v) => !v)}
                    className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {detailsExpanded ? t("i18n.hideDetails") : t("i18n.showDetails")}
                  </button>
                  {detailsExpanded && (
                    <CodeBlock size="sm" className="mt-1.5"><CodeBlockContent wrap>{detailsText}</CodeBlockContent></CodeBlock>
                  )}
                </div>
              )}
              {!hasDetails && text && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <button type="button" onClick={copyContent} className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground">
                    {copied ? t("i18n.copied") : t("i18n.copy")}
                  </button>
                </div>
              )}
            </div>
          </TraceCollapsibleContent>
        </TraceCollapsible>
        {subagent && onOpenSubagent && (
          <button
            type="button"
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => onOpenSubagent(subagent.sessionId, subagent.description || subagent.profile)}
            title={t("subagent.openTab")}
            aria-label={t("subagent.openTab")}
          >
            <ExternalLinkIcon className="size-3.5" strokeWidth={2} />
          </button>
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
        <TraceCollapsibleTrigger title={expanded ? t("i18n.collapse") : t("i18n.expand")}>
          <TraceLine>
            <TraceIcon><ToolCategoryIcon category="compact" /></TraceIcon>
            <TraceTitle className="font-medium">{t("i18n.conversationCompacted")}</TraceTitle>
            <TraceDescription className="min-w-0 flex-[0_1_auto] truncate font-mono text-[length:calc(12.5px+var(--chat-font-size-offset,0px))] [font-variant-numeric:normal]">
              {preview}
              {typeof tokensBefore === "number" && Number.isFinite(tokensBefore) && (
                <>
                  {" · "}{t("i18n.compactedFromTokens", { tokens: tokensBefore.toLocaleString() })}
                </>
              )}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
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
    <details className="compaction-file-details">
      <summary>{t("i18n.fileContext", { details: parts.join(", ") })}</summary>
      {modifiedFiles.length > 0 && <CompactionFileList title={t("i18n.modifiedFiles")} files={modifiedFiles} />}
      {readFiles.length > 0 && <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />}
    </details>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
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
    <div className="turn-meta-line" title={usage ? formatUsage(usage) : undefined}>
      {model && <span>{model}</span>}
      {(hasUsage || hasCtx) && (
        <UsageBar
          usage={usage ? { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cost: usage.cost.total } : null}
          ctx={ctx}
        />
      )}
      {time && <span>{time}</span>}
      {copySource && (
        <button
          onClick={() => {
            copyText(copySource).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          title={t("i18n.copyMessage")}
          aria-label={t("i18n.copyMessage")}
          className={cn(
            "ml-auto flex cursor-pointer items-center rounded-sm p-0.5 transition-colors",
            copied ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {copied ? <CheckIcon className="size-3" strokeWidth={1.8} /> : <CopyIcon className="size-3" strokeWidth={1.8} />}
        </button>
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
      <button
        onClick={() => setShowRaw(true)}
        className="my-1 block w-full cursor-pointer rounded-sm border border-border bg-card px-2.5 py-[7px] text-left text-xs text-muted-foreground"
      >
        <TriangleAlertIcon aria-hidden className="mr-1.5 inline size-3.5 align-[-0.15em]" />
        {t("i18n.largeMessageReveal", { size: children.length >= 1_000_000 ? `${(children.length / 1_000_000).toFixed(1)} MB` : children.length >= 1_000 ? `${Math.round(children.length / 1_000)} KB` : `${children.length} B` })}
      </button>
    );
  }
  return (
    <div className={cn("max-h-[420px] overflow-auto text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.5]", className)}>
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
  return <div className="activity-body">{nodes}</div>;
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool call detail views (moved from MessageView; shared with bash executions)
// ─────────────────────────────────────────────────────────────────────────────

interface ResultDiff {
  text: string;
}

/** +N / −M line counts for a unified diff, for the collapsed row badge. */
function countDiffStat(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function SplitFilesView({ files }: { files: SplitDiffFile[] }) {
  const layout: PatchDiffLayout = useIsMobile() ? "stacked" : "split";
  return <PatchDiffFiles files={files} layout={layout} />;
}

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
    <div className="max-h-[560px] overflow-x-hidden overflow-y-auto bg-background">
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          className={cn(
            "min-w-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.55]",
            fileIndex > 0 && "border-t border-border",
          )}
        >
          {showFileHeaders && layout === "split" && (
            <div className="sticky top-0 z-[1] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border bg-muted">
              <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
              <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
            </div>
          )}

          {showFileHeaders && layout === "stacked" && stackedFilePath(file) && (
            <div
              title={stackedFilePath(file)}
              className="sticky top-0 z-[1] truncate border-b border-border bg-muted px-2.5 py-[5px] text-dim"
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
    <div className="col-span-full select-none border-y border-border bg-muted px-2.5 text-dim">
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
      className={cn("truncate px-2.5 py-[5px] text-dim", side === "left" && "border-r border-border")}
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
      <span className="w-[42px] shrink-0 select-none border-r border-border bg-card px-1.5 text-right text-dim">
        {cell.lineNo ?? ""}
      </span>
      <span
        className={cn(
          "w-[18px] shrink-0 select-none px-[5px]",
          cell.type === "added" ? "font-bold text-diff-add" : cell.type === "removed" ? "font-bold text-diff-del" : "font-normal text-dim",
        )}
      >
        {marker}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 pr-2.5 whitespace-pre-wrap wrap-anywhere",
          cell.type === "empty" ? "text-dim" : "text-foreground",
        )}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function SplitPatchView({ text }: { text: string }) {
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  return <SplitFilesView files={files} />;
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div className="min-w-0 max-h-[520px] overflow-x-hidden overflow-y-auto font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.55]">
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bgClass =
          kind === "added" ? "bg-diff-add-bg" :
          kind === "removed" ? "bg-diff-del-bg" :
          kind === "hunk" ? "bg-diff-hunk-bg" :
          "";
        const colorClass =
          kind === "added" ? "text-diff-add" :
          kind === "removed" ? "text-diff-del" :
          kind === "hunk" ? "text-primary" :
          "text-foreground";
        const borderClass =
          kind === "added" ? "border-l-diff-add" :
          kind === "removed" ? "border-l-diff-del" :
          kind === "hunk" ? "border-l-primary" :
          "border-l-transparent";

        return (
          <div key={i} className={cn("flex border-l-[3px]", bgClass, colorClass, borderClass)}>
            <span className="w-12 shrink-0 select-none border-r border-border bg-card px-2 text-right text-dim">
              {i + 1}
            </span>
            <span className={cn("whitespace-pre-wrap wrap-anywhere px-2.5", colorClass)}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
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

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

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
            style={{ maxWidth: "100%" }}
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

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  // Terminal output keeps its own layout: box art, tables and progress bars
  // must not reflow to the container width.
  const tui = isTuiText(text);
  return (
    <pre
      className={cn(
        "max-h-[420px] min-w-0 overflow-auto rounded-lg border px-2.5 py-2 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.55]",
        isError
          ? "border-destructive/30 text-destructive"
          : isEmpty ? "border-border/60 italic text-muted-foreground/60" : "border-border/60 text-muted-foreground",
        tui ? "whitespace-pre" : "whitespace-pre-wrap break-all",
      )}
    >
      {isEmpty ? t("i18n.noOutput") : text}
    </pre>
  );
}

const TOOL_FIELD_LABEL =
  "pr-3 py-1 align-top whitespace-nowrap text-muted-foreground text-[length:calc(11px+var(--chat-font-size-offset,0px))]";

const TOOL_FIELD_VALUE =
  "py-1 font-mono wrap-anywhere text-muted-foreground text-[length:calc(12px+var(--chat-font-size-offset,0px))]";

// A value with newlines of its own keeps them, scrolled in place.
const TOOL_FIELD_BLOCK =
  "m-0 max-h-[260px] overflow-auto rounded-lg border border-border bg-background px-2.5 py-2 [font:inherit] leading-[1.5] whitespace-pre-wrap";

function ToolFieldRows({ fields }: { fields: ToolField[] }) {
  return (
    <table className="tool-field-table border-collapse">
      <tbody>
        {fields.map((field) => (
          <tr key={field.key}>
            <td className={TOOL_FIELD_LABEL}>{field.key}</td>
            <td className={TOOL_FIELD_VALUE}>
              {field.multiline ? <pre className={TOOL_FIELD_BLOCK}>{field.value}</pre> : field.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
