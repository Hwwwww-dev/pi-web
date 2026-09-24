"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { parseUnifiedPatch, type SplitDiffCell, type SplitDiffFile } from "@/lib/patch";
import { applyPatchPreviewToFiles, applyPatchResultHasFailures, extractApplyPatchPaths, getApplyPatchInputText, parseApplyPatchInput } from "@/lib/apply-patch";
import { isApplyPatchToolName, isEditToolName } from "@/lib/tool-names";
import { isToolCallExpanded, setToolCallExpanded } from "@/lib/tool-call-expansion";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import { getToolCategory, getToolFilePaths, getToolPreviewText, TOOL_CATEGORY_LABEL_KEYS, type ToolCategory } from "@/lib/tool-categories";
import type { SubagentToolDetails } from "@/lib/subagent-extension";
import type { CustomMessage, ImageContent, TextContent, ThinkingContent, ToolCallContent, ToolResultMessage } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared row primitives
// ─────────────────────────────────────────────────────────────────────────────

function RowChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );
}

function RowSpinner() {
  return <span className="activity-spinner" aria-hidden="true" />;
}

function ToolCategoryIcon({ category, isError }: { category: ToolCategory; isError?: boolean }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: isError ? "#ef4444" : "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    style: { flexShrink: 0 as const },
  };
  switch (category) {
    case "view":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="18" rx="2" />
          <polyline points="6 8 10 12 6 16" />
          <line x1="12" y1="16" x2="17" y2="16" />
        </svg>
      );
    case "subagent":
      return (
        <svg {...common}>
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <line x1="12" y1="4" x2="12" y2="8" />
          <circle cx="12" cy="3" r="1" />
          <circle cx="9" cy="13" r="0.6" fill="currentColor" />
          <circle cx="15" cy="13" r="0.6" fill="currentColor" />
        </svg>
      );
    case "plan":
      return (
        <svg {...common}>
          <line x1="9" y1="6" x2="21" y2="6" />
          <line x1="9" y1="12" x2="21" y2="12" />
          <line x1="9" y1="18" x2="21" y2="18" />
          <polyline points="3.5 5.5 4.5 6.5 6.5 4.5" />
          <polyline points="3.5 11.5 4.5 12.5 6.5 10.5" />
          <polyline points="3.5 17.5 4.5 18.5 6.5 16.5" />
        </svg>
      );
    case "compact":
      return (
        <svg {...common}>
          <polyline points="4 9 8 5 12 9" />
          <line x1="8" y1="5" x2="8" y2="13" />
          <polyline points="20 15 16 19 12 15" />
          <line x1="16" y1="19" x2="16" y2="11" />
        </svg>
      );
    case "web":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
  }
}

/** A clickable file reference inside a tool row, opening the file viewer. */
function ToolFileChip({ path, cwd, onOpenFile }: { path: string; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void }) {
  const resolved = resolveLocalFilePath(path, cwd) ?? path;
  const name = getFileName(resolved);
  const relative = cwd ? getRelativeFilePath(resolved, cwd) : resolved;
  const dir = relative.includes("/")
    ? relative.slice(0, relative.lastIndexOf("/"))
    : relative.includes("\\")
      ? relative.slice(0, relative.lastIndexOf("\\"))
      : null;
  const clickable = Boolean(onOpenFile);
  return (
    <button
      type="button"
      className="tool-file-chip"
      title={resolved}
      aria-label={name}
      disabled={!clickable}
      onClick={clickable ? () => onOpenFile!(resolved) : undefined}
      style={clickable ? undefined : { cursor: "default" }}
    >
      {getFileIcon(name, 12)}
      <span className="tool-file-chip-name">{name}</span>
      {dir && <span className="tool-file-chip-dir">{dir}/</span>}
    </button>
  );
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
  onOpenFile?: (filePath: string, page?: number) => void;
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

export function ToolRow({ block, result, duration, cwd, onOpenFile, onOpenSession, isStreaming }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
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
  const isStreamingInput = block.rawInput !== undefined;
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const patchFiles = getApplyPatchFiles(block, result);
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultImages = getMessageImages(result?.content ?? []);
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = (result?.isError ?? false)
    || (isApplyPatchToolName(block.toolName) && applyPatchResultHasFailures(result?.details));
  const subagent = isSubagentToolDetails(result?.details) ? result.details : null;
  const active = Boolean(isStreaming) && !result;

  const label = category === "other" ? block.toolName : t(TOOL_CATEGORY_LABEL_KEYS[category]);

  return (
    <div className={`activity-row${isError ? " activity-row-error" : ""}${active ? " activity-row-active" : ""}`} data-activity-tool={block.toolName}>
      <div className="activity-row-line">
        <button
          type="button"
          className="activity-row-header"
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          <span className="activity-row-icon"><ToolCategoryIcon category={category} isError={isError} /></span>
          <span className="activity-row-label">{label}</span>
          <span className="activity-row-preview">
            {isStreamingInput
              ? t("chat.generatingToolInput")
              : <ToolRowPreview block={block} result={result} cwd={cwd} onOpenFile={onOpenFile} />}
          </span>
          {active ? <RowSpinner /> : duration !== undefined && <span className="activity-row-meta">{duration}s</span>}
          <RowChevron expanded={expanded} />
        </button>
        {subagent && onOpenSession && (
          <button
            type="button"
            className="activity-row-action"
            onClick={() => onOpenSession(subagent.sessionId)}
            title={t("subagent.open")}
            aria-label={t("subagent.open")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
          </button>
        )}
      </div>

      {resultImages.length > 0 && <ResultImages images={resultImages} />}

      {expanded && (
        <div className="activity-row-detail">
          {(isStreamingInput || !isEditToolName(block.toolName)) && !patchFiles && (
            <pre className="activity-detail-pre">{inputStr}</pre>
          )}
          {patchFiles && <SplitFilesView files={patchFiles} />}
          {result && patchFiles && isError && (
            <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
          )}
          {result && !patchFiles && (
            resultDiff ? <PairedDiffResult diff={resultDiff} /> : (!resultIsEmpty || resultImages.length === 0) && (
              <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
            )
          )}
        </div>
      )}
    </div>
  );
}

/** Merges consecutive same-category tool calls into one collapsed summary row. */
export function ToolGroupRow({ calls, cwd, onOpenFile, onOpenSession, defaultExpanded = false }: {
  calls: ToolCallEntry[];
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
  defaultExpanded?: boolean;
}) {
  const { t } = useI18n();
  const groupKey = `group:${calls[0]?.block.toolCallId ?? ""}`;
  const [expanded, setExpanded] = useState(() => defaultExpanded || isToolCallExpanded(groupKey));
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
    <div className={`activity-row${isError ? " activity-row-error" : ""}`} data-activity-group={category}>
      <button
        type="button"
        className="activity-row-header"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <span className="activity-row-icon"><ToolCategoryIcon category={category} isError={isError} /></span>
        <span className="activity-row-label">{t(TOOL_CATEGORY_LABEL_KEYS[category])}</span>
        <span className="activity-row-preview">{summaryCount}</span>
        {hasPending ? <RowSpinner /> : totalDuration > 0 && <span className="activity-row-meta">{totalDuration}s</span>}
        <RowChevron expanded={expanded} />
      </button>
      {expanded && (
        <div className="activity-row-children">
          {calls.map((call, index) => (
            <ToolRow
              key={call.block.toolCallId ?? index}
              block={call.block}
              result={call.result}
              duration={call.duration}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thinking rows
// ─────────────────────────────────────────────────────────────────────────────

const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
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

  return (
    <div className="activity-row" data-activity="thinking">
      <button
        type="button"
        className="activity-row-header"
        aria-expanded={expanded}
        aria-label={`${t("i18n.thinking")}${preview ? `: ${preview}` : ""}`}
        title={t("i18n.thinking")}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="activity-row-icon" style={{ color: active ? "#d4a017" : undefined }}><ThinkingIcon active={expanded || Boolean(active)} /></span>
        <span className="activity-row-label">{t("i18n.thinking")}</span>
        <span className="activity-row-preview">{preview}</span>
        {active ? <RowSpinner /> : duration !== undefined && <span className="activity-row-meta">{duration}s</span>}
        <RowChevron expanded={expanded} />
      </button>
      {expanded && (
        <div className="activity-row-body" style={error ? { color: "#f87171" } : undefined}>
          {loading ? t("i18n.loadingThinking") : error ?? (block.deferred ? content : block.thinking)}
        </div>
      )}
    </div>
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
export function CustomRow({ message, cwd, onOpenFile, onOpenSession }: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
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
    <div className={`activity-row${isHiddenDisplay ? " activity-row-dim" : ""}`} data-activity-custom={message.customType}>
      <div className="activity-row-line">
        <button
          type="button"
          className="activity-row-header"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="activity-row-icon"><ToolCategoryIcon category={subagent ? "subagent" : "other"} /></span>
          <span className="activity-row-label" style={dim ? { color: "var(--text-dim)", fontWeight: 400 } : undefined}>{label}</span>
          <span className="activity-row-preview">{preview || (isHiddenDisplay ? t("i18n.showExtensionMessage") : null)}</span>
          <RowChevron expanded={expanded} />
        </button>
        {subagent && onOpenSession && (
          <button
            type="button"
            className="activity-row-action"
            onClick={() => onOpenSession(subagent.sessionId)}
            title={t("subagent.open")}
            aria-label={t("subagent.open")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
          </button>
        )}
      </div>
      {expanded && (
        <div className="activity-row-body">
          {images.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text ? 8 : 0 }}>
              {images.map((img, i) => {
                const src = imageSource(img);
                if (!src) return null;
                return (
                  <ImagePreview key={i} src={src}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid var(--border)" }}
                    />
                  </ImagePreview>
                );
              })}
            </div>
          )}
          {text
            ? <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody>
            : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("i18n.noMessage")}</span>}
          {hasDetails && (
            <div className="activity-row-footnote">
              <button type="button" onClick={copyContent} className="activity-row-footnote-button">
                {copied ? t("i18n.copied") : t("i18n.copy")}
              </button>
              <button
                type="button"
                onClick={() => setDetailsExpanded((v) => !v)}
                className="activity-row-footnote-button"
              >
                {detailsExpanded ? t("i18n.hideDetails") : t("i18n.showDetails")}
              </button>
              {detailsExpanded && <pre className="activity-detail-pre" style={{ marginTop: 6 }}>{detailsText}</pre>}
            </div>
          )}
          {!hasDetails && text && (
            <div className="activity-row-footnote">
              <button type="button" onClick={copyContent} className="activity-row-footnote-button">
                {copied ? t("i18n.copied") : t("i18n.copy")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Compaction summary row — the anchor message of a compacted turn. */
export function CompactionRow({ message, cwd, onOpenFile }: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const total = parsedSummary.readFiles.length + parsedSummary.modifiedFiles.length;
  const preview = total > 0
    ? t("i18n.fileContext", { details: [
        parsedSummary.modifiedFiles.length > 0 ? `${parsedSummary.modifiedFiles.length} modified` : null,
        parsedSummary.readFiles.length > 0 ? `${parsedSummary.readFiles.length} read` : null,
      ].filter(Boolean).join(", ") })
    : previewText(parsedSummary.body, 120);

  return (
    <div className="activity-row" data-activity-custom="compaction">
      <button
        type="button"
        className="activity-row-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="activity-row-icon"><ToolCategoryIcon category="compact" /></span>
        <span className="activity-row-label">{t("i18n.conversationCompacted")}</span>
        <span className="activity-row-preview">{preview}</span>
        <RowChevron expanded={expanded} />
      </button>
      {expanded && (
        <div className="activity-row-body">
          <div style={{ color: "var(--text)", fontSize: "calc(14px + var(--chat-font-size-offset, 0px))", lineHeight: 1.5 }}>
            {t("i18n.compactionDescription")}
          </div>
          {parsedSummary.body ? (
            <MarkdownBody className="markdown-compaction-message" cwd={cwd} onOpenFile={onOpenFile}>{parsedSummary.body}</MarkdownBody>
          ) : (
            <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("i18n.noSummary")}</span>
          )}
          <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
        </div>
      )}
    </div>
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

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}

export function formatUsage(usage: TurnUsage): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

export function TurnMetaLine({ usage, model, time }: {
  usage?: TurnUsage | null;
  model?: string;
  time?: string | null;
}) {
  const usageText = usage ? formatUsage(usage) : null;
  if (!usageText && !model && !time) return null;
  return (
    <div className="turn-meta-line">
      {usageText && <span>{usageText}</span>}
      {model && <span>{model}</span>}
      {time && <span>{time}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity item assembly — shared by finished turns and the live tail
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityItem =
  | { kind: "thinking"; key: string; block: ThinkingContent; duration?: number; entryId?: string; blockIndex: number; searchTarget?: boolean }
  | { kind: "text"; key: string; block: TextContent; searchTarget?: boolean }
  | { kind: "tool"; key: string; block: ToolCallContent; result?: ToolResultMessage; duration?: number; searchTarget?: boolean }
  | { kind: "custom"; key: string; message: CustomMessage; searchTarget?: boolean };

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
        style={{
          display: "block",
          width: "100%",
          margin: "4px 0",
          padding: "7px 10px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg-panel)",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        ⚠ {t("i18n.largeMessageReveal", { size: children.length >= 1_000_000 ? `${(children.length / 1_000_000).toFixed(1)} MB` : children.length >= 1_000 ? `${Math.round(children.length / 1_000)} KB` : `${children.length} B` })}
      </button>
    );
  }
  return (
    <div className={className} style={{ maxHeight: 420, overflow: "auto", fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", lineHeight: 1.5 }}>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
        }}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * Renders a turn's process as compact activity rows. Consecutive tool calls of
 * the same category merge into one group row; thinking and custom messages get
 * their own row; interstitial prose flows as plain text.
 */
export function TurnActivityBody({ items, cwd, onOpenFile, onOpenSession, sessionId, live = false }: {
  items: ActivityItem[];
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
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
            cwd={cwd}
            onOpenFile={onOpenFile}
            onOpenSession={onOpenSession}
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
            }))}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onOpenSession={onOpenSession}
            defaultExpanded={live}
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
          active={live && item.duration === undefined}
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
        : <CustomRow key={item.key} message={message} cwd={cwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} />,
    );
    index += 1;
  }
  return <div className="activity-body">{nodes}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool call detail views (moved from MessageView; shared with bash executions)
// ─────────────────────────────────────────────────────────────────────────────

interface ResultDiff {
  text: string;
}

function PairedDiffResult({ diff }: {
  diff: ResultDiff;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      <SplitPatchView text={diff.text} />
    </div>
  );
}

function SplitPatchView({ text }: { text: string }) {
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  return <SplitFilesView files={files} />;
}

function SplitFilesView({ files }: { files: SplitDiffFile[] }) {
  const { t } = useI18n();
  const showFileHeaders = files.length > 1;

  return (
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.55,
          }}
        >
          {showFileHeaders && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--bg-panel)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
              <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--text-dim)",
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "rgba(34,197,94,0.12)"
      : cell.type === "removed"
      ? "rgba(248,113,113,0.13)"
      : cell.type === "empty"
      ? "var(--bg-subtle)"
      : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "#22c55e" : cell.type === "removed" ? "#f87171" : "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: cell.type === "empty" ? "var(--text-dim)" : "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", fontFamily: "var(--font-mono)", fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", lineHeight: 1.55, minWidth: 0 }}>
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bg =
          kind === "added" ? "rgba(34,197,94,0.12)" :
          kind === "removed" ? "rgba(248,113,113,0.13)" :
          kind === "hunk" ? "rgba(96,165,250,0.12)" :
          "transparent";
        const color =
          kind === "added" ? "#22c55e" :
          kind === "removed" ? "#f87171" :
          kind === "hunk" ? "var(--accent)" :
          "var(--text)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft: kind === "added"
                ? "3px solid #22c55e"
                : kind === "removed"
                ? "3px solid #f87171"
                : kind === "hunk"
                ? "3px solid var(--accent)"
                : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ padding: "0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color }}>
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
      className="activity-row-images"
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
              style={{
                display: "block",
                maxWidth: "min(100%, 720px)",
                maxHeight: 520,
                borderRadius: 6,
                objectFit: "contain",
                border: "1px solid var(--border)",
              }}
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
      className="activity-detail-pre"
      style={{
        color: isError ? "#f87171" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
        whiteSpace: tui ? "pre" : "pre-wrap",
        wordBreak: tui ? "normal" : "break-all",
        fontStyle: isEmpty ? "italic" : "normal",
        opacity: isEmpty ? 0.6 : 1,
        background: "var(--bg)",
      }}
    >
      {isEmpty ? t("i18n.noOutput") : text}
    </pre>
  );
}
