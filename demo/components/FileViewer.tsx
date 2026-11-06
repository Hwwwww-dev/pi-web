
"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type MouseEvent } from "react";
import { AtSign, DownloadIcon, FileIcon, WrapText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  DOCX_PREVIEW_MAX_BYTES,
  HTML_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
  formatFileSize,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { parseFileOpenOptions, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { fileVersion, fileVersionChanged } from "@/lib/file-version";
import { injectSandboxedHtmlPolyfill } from "@/lib/html-sandbox-polyfill";
import { HIDDEN_PAGE_GRACE_MS, usePageHiddenFor } from "@/hooks/usePageHidden";
import { pageId, trackEventSource } from "@/lib/page-debug";
import { parseFrontmatter } from "@/lib/frontmatter";
import { isExternalMarkdownHref, jumpToMarkdownFragment, markdownAppUrlTransform, markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { FILE_CODE_STYLE, FILE_LINE_NUMBER_STYLE, FILE_PINNED_LINE_NUMBER_STYLE } from "./DiffView";
import { DelimitedTable } from "./DelimitedTable";
import { PathLabel } from "./PathLabel";
import { FILE_MODE_LABELS } from "./FileToolbar";
import { CodeBlock as CodeBlockShell, CodeBlockActions, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "./ui/code-block";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { SourceCodeView } from "./SourceCodeView";
import { isDelimitedTablePath } from "@/lib/delimited-table";
import { FrontmatterCard } from "./FrontmatterCard";
import { diffGapLabel, parseUnifiedPatch, unifiedDiffLines, type SplitDiffGap, type UnifiedDiffLine } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import {
  resolveInitialFileDisplayMode,
  resolveInitialWrapLines,
  type FileViewerDisplayMode as DisplayMode,
  type FileViewerState,
} from "@/lib/file-viewer-state";
import { staticFileUrlForApi } from "@/mock/files";

export type { FileViewerState } from "@/lib/file-viewer-state";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  /** PDF page to open on first render (`#page=N` from a markdown link). */
  initialPage?: number;
  /** Source line to scroll to on first load (`:line` suffix from a file link). */
  initialLine?: number;
  initialState?: FileViewerState;
  onStateChange?: (state: FileViewerState) => void;
  watchEnabled?: boolean;
}

interface FileData {
  content: string;
  language: string;
  size: number;
  nextOffset: number;
  truncated: boolean;
  // A NUL in the first bytes (lib/text-preview.ts): no text view, only the download.
  binary?: boolean;
}

const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;

interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

function closestSourceLine(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest<HTMLElement>(".file-source-line[data-line-number]") ?? null;
}

function getSelectedSourceLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  let startElement = closestSourceLine(range.startContainer);
  let endElement = closestSourceLine(range.endContainer);
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) return null;

  let startLine = Number(startElement.dataset.lineNumber);
  let endLine = Number(endElement.dataset.lineNumber);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;

  if (startLine < endLine) {
    // Browser ranges can start at the end of the preceding line or end at the
    // start of the following line. Exclude either boundary line when none of
    // its source text is actually selected.
    const startContent = startElement.querySelector<HTMLElement>(".file-source-line-content");
    if (startContent?.contains(range.startContainer)) {
      const selectedSuffix = document.createRange();
      selectedSuffix.selectNodeContents(startContent);
      selectedSuffix.setStart(range.startContainer, range.startOffset);
      if (selectedSuffix.toString().length === 0) {
        const nextLine = startElement.nextElementSibling;
        if (nextLine instanceof HTMLElement && nextLine.matches(".file-source-line[data-line-number]")) {
          startElement = nextLine;
          startLine = Number(startElement.dataset.lineNumber);
        }
      }
    }

    const endContent = endElement.querySelector<HTMLElement>(".file-source-line-content");
    if (endContent?.contains(range.endContainer)) {
      const selectedPrefix = document.createRange();
      selectedPrefix.selectNodeContents(endContent);
      selectedPrefix.setEnd(range.endContainer, range.endOffset);
      if (selectedPrefix.toString().length === 0) {
        const previousLine = endElement.previousElementSibling;
        if (previousLine instanceof HTMLElement && previousLine.matches(".file-source-line[data-line-number]")) {
          endElement = previousLine;
          endLine = Number(endElement.dataset.lineNumber);
        }
      }
    }
  }

  if (startLine > endLine) return null;
  return { startLine, endLine };
}


function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  // A watch is a stream: the page that holds it, for the Debug panel's connected pages.
  if (type === "watch") searchParams.set("holder", pageId());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  // Demo: images, media and downloads load straight from the static snapshot.
  return staticFileUrlForApi(`/api/files/${encoded}?${searchParams.toString()}`);
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <Button
      asChild
      variant="ghost"
      size="icon-xs"
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
    >
      <a href={getFileApiUrl(filePath, "download", sourceSessionId)} download={getFileName(filePath)}>
        <DownloadIcon className="size-3.5" strokeWidth={1.8} />
      </a>
    </Button>
  );
}

// The same rows the tool card's split diff parses, in one column; see `unifiedDiffLines()`.
type DiffLine = UnifiedDiffLine;

// Unchanged lines the patch leaves out between two hunks.
type DiffGap = SplitDiffGap;


function diffLines(patch: string): Array<DiffLine | DiffGap> {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];
  return files.flatMap(unifiedDiffLines);
}

function DiffView({ patch, wrapLines }: { patch: string; wrapLines: boolean }) {
  const { t } = useI18n();
  const diff = diffLines(patch);

  const isChange = (l: DiffLine | DiffGap) => l.type === "added" || l.type === "removed";
  const hasChanges = diff.some(isChange);
  if (!hasChanges) {
    return (
      <div className="px-3 py-3 font-mono text-xs text-muted-foreground">
        {t("i18n.noChanges")}
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (isChange(l) ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }
  const lineNumberStyle = visible.size <= SOURCE_HIGHLIGHT_MAX_LINES
    ? FILE_PINNED_LINE_NUMBER_STYLE
    : FILE_LINE_NUMBER_STYLE;

  // Collapsed lines and the lines the patch leaves out between hunks share one
  // marker; its count is unknown when a gap's is.
  const isShown = (j: number) => diff[j].type !== "gap" && visible.has(j);
  const segments: Array<{ hidden: true; count: number | null } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (isShown(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && isShown(i)) {
        const line = diff[i];
        if (line.type !== "gap") block.push(line);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count: number | null = 0;
      while (i < diff.length && !isShown(i)) {
        const item = diff[i];
        const skipped = item.type === "gap" ? item.count : 1;
        count = count === null || skipped === null ? null : count + skipped;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  return (
    <div
      // FILE_CODE_STYLE comes from DiffView.tsx, shared with the highlighted
      // source view; the wrap width is the reader's own choice.
      className={`file-diff-view min-w-full ${wrapLines ? "w-full" : "w-max"}`}
      style={FILE_CODE_STYLE}
    >
      {segments.map((seg, si) => {
        if (seg.hidden) {
          // Collapsed hunks take the CodeBlock highlighted row: muted band,
          // sans-serif note, no gutter columns of its own.
          return (
            <span
              key={si}
              data-slot="code-block-line"
              className="cn-code-block-line cn-code-block-line-variant-highlighted flex min-w-full items-center py-0.5 font-sans text-xs text-muted-foreground after:content-none"
            >
              <span aria-hidden="true" className="min-w-4 shrink-0 select-none px-1.5">⋯</span>
              <span className="shrink-0 px-1.5">{seg.count === null ? "⋯" : diffGapLabel(seg.count, t)}</span>
            </span>
          );
        }
        const lines = seg.lines.map((line, li) => {
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          // The rows are the official CodeBlock line variants (vendored nova
          // classes); the +/- marker stays an aligned column instead of the
          // variant's absolute ::after so wrapped text keeps clearing it, and
          // content-none drops that second marker.
          const rowTone = line.type === "added"
            ? "cn-code-block-line-variant-added"
            : line.type === "removed"
            ? "cn-code-block-line-variant-removed"
            : "";

          return (
            <span
              key={li}
              data-slot="code-block-line"
              className={`cn-code-block-line file-diff-line flex min-w-full after:content-none ${rowTone}`}
            >
              <span
                style={lineNumberStyle}
              >
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span className="min-w-4 shrink-0 select-none px-1.5 font-semibold">
                {prefix}
              </span>
              <span
                className={`file-diff-line-content min-w-0 pr-3 text-foreground ${
                  wrapLines ? "shrink whitespace-pre-wrap [overflow-wrap:anywhere]" : "shrink-0 whitespace-pre"
                }`}
              >
                {line.text || "\u00a0"}
              </span>
            </span>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setError(null);
          const version = fileVersion(next);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setNaturalSize(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setNaturalSize(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatFileSize(size) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-1 text-xs text-muted-foreground">
        <PathLabel text={getRelativeFilePath(filePath, cwd)} title={filePath} className="font-mono" />
        <span className="ml-auto">{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          className={`flex items-center gap-1 ${watching ? "text-success" : "text-muted-foreground"}`}
        >
          <span
            className={`inline-block size-[7px] rounded-full ${watching ? "bg-success shadow-[0_0_4px_var(--ok)]" : "bg-border"}`}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        // The checkerboard behind transparent images: one pattern, four
        // gradients; kept as arbitrary values so the tiles stay exact.
        className="flex flex-1 items-center justify-center overflow-auto bg-card p-4 bg-[image:linear-gradient(45deg,var(--background)_25%,transparent_25%),linear-gradient(-45deg,var(--background)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--background)_75%),linear-gradient(-45deg,transparent_75%,var(--background)_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0]"
      >
        {error ? (
          <div className="text-[13px] text-destructive">{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError(t("files.imageLoadFailed"))}
            className="max-h-full max-w-full object-contain shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setError(null);
          const version = fileVersion(next);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setDuration(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-1 text-xs text-muted-foreground">
        <PathLabel text={getRelativeFilePath(filePath, cwd)} title={filePath} className="font-mono" />
        <span className="ml-auto">{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatFileSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          className={`flex items-center gap-1 ${watching ? "text-success" : "text-muted-foreground"}`}
        >
          <span
            className={`inline-block size-[7px] rounded-full ${watching ? "bg-success shadow-[0_0_4px_var(--ok)]" : "bg-border"}`}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div className="flex flex-1 items-center justify-center bg-card p-6">
        <div className="w-full max-w-[680px]">
          {error && (
            <div className="mb-3 text-center text-[13px] text-destructive">
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(t("files.audioLoadFailed"))}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}

function VideoViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setError(null);
          const version = fileVersion(next);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setDuration(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-1 text-xs text-muted-foreground">
        <PathLabel text={getRelativeFilePath(filePath, cwd)} title={filePath} className="font-mono" />
        <span className="ml-auto">{ext || "video"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatFileSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          className={`flex items-center gap-1 ${watching ? "text-success" : "text-muted-foreground"}`}
        >
          <span
            className={`inline-block size-[7px] rounded-full ${watching ? "bg-success shadow-[0_0_4px_var(--ok)]" : "bg-border"}`}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-card p-6">
        <div className="flex h-full w-full max-w-[960px] min-h-0 flex-col items-center justify-center">
          {error && (
            <div className="mb-3 text-center text-[13px] text-destructive">
              {error}
            </div>
          )}
          <video
            key={src}
            controls
            playsInline
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(t("files.videoLoadFailed"))}
            className="max-h-full max-w-full"
          />
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, initialPage, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const pageFragment = isPdf && initialPage && initialPage > 0 ? `#page=${initialPage}` : "";
  const previewUrl = isPdf
    ? `${getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)}${pageFragment}`
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;

    let active = true;
    const requestId = ++syncRequestRef.current;
    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (!active || requestId !== syncRequestRef.current) return;
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
          }
        }
      })
      .catch((nextError) => {
        if (active && requestId === syncRequestRef.current) setError(String(nextError));
      });

    return () => {
      active = false;
    };
  }, [filePath, isPdf, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((r) => r.json())
        .then((d: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (d.error) {
            setError(d.error);
            return;
          }
          if (typeof d.size === "number") {
            setSize(d.size);
            if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
              setError("DOCX too large for preview (>10MB)");
              return;
            }
          }
          setError(null);
          const version = fileVersion(d);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, isPdf, sourceSessionId, watchEnabled]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-1 text-xs text-muted-foreground">
        <PathLabel text={getRelativeFilePath(filePath, cwd)} title={filePath} className="font-mono" />
        <span className="ml-auto">{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatFileSize(size)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          className={`flex shrink-0 items-center gap-1 ${watching ? "text-success" : "text-muted-foreground"}`}
        >
          <span
            className={`inline-block size-[7px] rounded-full ${watching ? "bg-success shadow-[0_0_4px_var(--ok)]" : "bg-border"}`}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div className="min-h-0 flex-1 bg-card">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-destructive">
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            // The DOCX converter's own paper white behind the converted page.
            className={`h-full w-full border-0 ${isPdf ? "bg-background" : "bg-white"}`}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  initialPage,
  initialLine,
  onStateChange,
  watchEnabled: watchRequested = true,
}: Props) {
  // A page hidden past the grace lets go of its file watch (#1283: one browser
  // connection each); the watch's `connected` on return re-reads the file if it
  // changed meanwhile.
  const pageHidden = usePageHiddenFor(HIDDEN_PAGE_GRACE_MS);
  const watchEnabled = watchRequested && !pageHidden;
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isVideoPath(filePath)) {
    return <VideoViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} initialPage={initialPage} watchEnabled={watchEnabled} />;
  }
  return (
    <TextFileViewer
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
      onMentionLines={onMentionLines}
      onAtMention={onAtMention}
      gitRefreshKey={gitRefreshKey}
      initialDisplayMode={initialDisplayMode}
      initialState={initialState}
      initialLine={initialLine}
      onStateChange={onStateChange}
      watchEnabled={watchEnabled}
    />
  );
}

function TextFileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  initialLine,
  onStateChange,
  watchEnabled = true,
}: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffResolved, setGitDiffResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A line target is an explicit "show me this source line" intent: it only
  // makes sense in source mode, so it overrides a restored preview mode.
  const lineTargetRef = useRef<number | null>(initialLine ?? null);
  const requestedInitialDisplayMode = lineTargetRef.current !== null
    ? "source" as DisplayMode
    : resolveInitialFileDisplayMode(initialState, initialDisplayMode);
  const initialWrapLines = resolveInitialWrapLines(initialState, filePath);
  const initialScrollTop = initialState?.scrollTop ?? 0;
  const initialScrollLeft = initialState?.scrollLeft ?? 0;
  const [displayMode, setDisplayMode] = useState<DisplayMode>(requestedInitialDisplayMode);
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const contentRequestRef = useRef(0);
  // The version of the content on screen; a reconnect that finds it unchanged
  // keeps what is loaded (Load more chunks, scroll, highlighting).
  const shownVersionRef = useRef<string | null>(null);
  const gitDiffRequestRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoDiffAppliedRef = useRef(false);
  const defaultPreviewEligibleRef = useRef(
    initialState === undefined && initialDisplayMode === undefined && initialLine === undefined,
  );
  const scrollRestorePendingRef = useRef(true);
  const viewerStateRef = useRef<FileViewerState>({
    displayMode: requestedInitialDisplayMode,
    wrapLines: initialWrapLines,
    scrollTop: initialScrollTop,
    scrollLeft: initialScrollLeft,
  });
  const onStateChangeRef = useRef(onStateChange);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);
  // Whole file for an HTML preview whose source view is still chunked.
  const [htmlFull, setHtmlFull] = useState<{ text?: string; error?: string } | null>(null);

  onStateChangeRef.current = onStateChange;

  const updateDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    viewerStateRef.current.displayMode = nextDisplayMode;
    setDisplayMode(nextDisplayMode);
  }, []);

  const toggleWrapLines = useCallback(() => {
    setWrapLines((current) => {
      const next = !current;
      viewerStateRef.current.wrapLines = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const nextState: FileViewerState = {
      displayMode: requestedInitialDisplayMode,
      wrapLines: initialWrapLines,
      scrollTop: initialScrollTop,
      scrollLeft: initialScrollLeft,
    };

    viewerStateRef.current = nextState;
    scrollRestorePendingRef.current = true;
    autoDiffAppliedRef.current = false;
    setDisplayMode(requestedInitialDisplayMode);
    setWrapLines(initialWrapLines);

    return () => {
      onStateChangeRef.current?.({ ...viewerStateRef.current });
    };
  }, [
    filePath,
    sourceSessionId,
    requestedInitialDisplayMode,
    initialWrapLines,
    initialScrollTop,
    initialScrollLeft,
  ]);

  const fetchContent = useCallback((filePath: string, offset = 0) => {
    const requestId = ++contentRequestRef.current;
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId, { offset: offset || undefined }))
      .then((r) => r.json())
      .then((d: FileData & { mtime?: string; error?: string }) => {
        if (requestId !== contentRequestRef.current) return null;
        if (d.error) {
          setError(d.error);
          return null;
        }
        shownVersionRef.current = fileVersion(d);
        setError(null);
        setData((current) => offset && current
          ? { ...d, content: current.content + d.content }
          : d);
        return d;
      })
      .catch((e) => {
        if (requestId !== contentRequestRef.current) return null;
        setError(String(e));
        return null;
      });
  }, [sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    const requestId = ++gitDiffRequestRef.current;
    setGitDiffLoading(true);
    if (!cwd) {
      setGitDiff(null);
      setGitDiffLoading(false);
      setGitDiffResolved(true);
      return;
    }

    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/git/diff?${params.toString()}`);
      const next = await response.json() as GitFileDiffResponse & { error?: string };
      if (requestId !== gitDiffRequestRef.current) return;
      setGitDiff(response.ok && next.supported && typeof next.patch === "string" ? next : null);
    } catch {
      if (requestId === gitDiffRequestRef.current) setGitDiff(null);
    } finally {
      if (requestId === gitDiffRequestRef.current) {
        setGitDiffLoading(false);
        setGitDiffResolved(true);
      }
    }
  }, [cwd]);

  // Reset and load the file itself when its identity changes. Live watching is
  // managed separately so pausing it never clears the displayed content.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setGitDiff(null);
    setGitDiffResolved(false);
    setWatching(false);
    shownVersionRef.current = null;

    fetchContent(filePath).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [filePath, fetchContent, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      void fetchContent(filePath);
      void fetchGitDiff(filePath);
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      // The server emits connected only after its watcher exists. Reading now
      // closes the gap between the last snapshot and live events, unless the
      // file on screen is still the one on disk (a reconnect). The diff is read
      // again either way: a commit made meanwhile changes it, not the file.
      const shown = shownVersionRef.current;
      if (shown === null) {
        synchronize();
        return;
      }
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((meta: { size?: number; mtime?: string }) => {
          if (!active) return;
          if (fileVersionChanged(shownVersionRef.current, fileVersion(meta))) synchronize();
          else void fetchGitDiff(filePath);
        })
        .catch(() => {
          if (active) synchronize();
        });
    });

    es.addEventListener("change", synchronize);

    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, fetchContent, fetchGitDiff, sourceSessionId, watchEnabled]);

  useEffect(() => {
    void fetchGitDiff(filePath);
  }, [fetchGitDiff, filePath, gitRefreshKey]);

  const isBinary = data?.binary === true;
  const isDelimitedTable = !isBinary && isDelimitedTablePath(filePath);

  useEffect(() => {
    // HTML gets the same rendered-first treatment as markdown: a generated page
    // is usually more useful viewed than read as source. Both have a preview
    // mode already; the source tab stays one click away. A restored choice or
    // explicit mode hint always wins over this default. A CSV/TSV file opens
    // as its table, even while only its first chunk is loaded.
    if (
      defaultPreviewEligibleRef.current
      && data
      && !data.binary
      && (
        isDelimitedTable
        || (data.language === "markdown" && !data.truncated)
        || (data.language === "html" && (!data.truncated || data.size <= HTML_PREVIEW_MAX_BYTES))
      )
    ) {
      defaultPreviewEligibleRef.current = false;
      updateDisplayMode("preview");
    }
  }, [data, isDelimitedTable, updateDisplayMode]);

  // Large HTML: the source view loads 256 KB chunks, but a half document cannot
  // render, so the preview fetches the whole file once. A new `data` (watch
  // change, reload) refetches it; the previous page stays up meanwhile, so a
  // live change does not flash "Loading".
  const needsHtmlFull = displayMode === "preview"
    && data?.language === "html"
    && data.truncated
    && data.size <= HTML_PREVIEW_MAX_BYTES;
  useEffect(() => {
    if (!needsHtmlFull) {
      setHtmlFull(null);
      return;
    }
    const controller = new AbortController();
    fetch(getFileApiUrl(filePath, "download", sourceSessionId), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setHtmlFull({ text: await r.text() });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setHtmlFull({ error: String(e) });
      });
    return () => controller.abort();
  }, [needsHtmlFull, data, filePath, sourceSessionId]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";

  useEffect(() => {
    if (gitDiffResolved && !hasGitDiff && displayMode === "diff") updateDisplayMode("source");
  }, [displayMode, gitDiffResolved, hasGitDiff, updateDisplayMode]);

  // Wait for the git request before restoring diff mode so the unresolved
  // placeholder cannot immediately demote it back to source.
  useEffect(() => {
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && !autoDiffAppliedRef.current) {
      autoDiffAppliedRef.current = true;
      updateDisplayMode("diff");
    }
  }, [requestedInitialDisplayMode, hasGitDiff, updateDisplayMode]);

  const markdownPreview = useMemo(
    () => (data?.language === "markdown" ? normalizeDisplayMath(data.content) : ""),
    [data],
  );

  const frontmatter = useMemo(
    () => (data?.language === "markdown" ? parseFrontmatter(data.content) : null),
    [data],
  );

  const viewerContent = data?.content ?? "";
  const sourceLines = useMemo(() => viewerContent.split("\n"), [viewerContent]);
  const language = data?.language ?? "text";
  // A binary file has no Preview, whatever its extension (#1401).
  const isHtml = !isBinary && language === "html";
  const isMarkdown = !isBinary && language === "markdown";
  // A table shows a loaded prefix too, without its cut last record; an HTML
  // preview fetches the whole file up to HTML_PREVIEW_MAX_BYTES.
  const hasPreview = isDelimitedTable || (isHtml
    ? !!data && (!data.truncated || data.size <= HTML_PREVIEW_MAX_BYTES)
    : isMarkdown && !data?.truncated);
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;
  const rawHtml = data?.truncated ? htmlFull?.text : viewerContent;
  const htmlPreview = useMemo(
    () => isHtml && effectiveDisplayMode === "preview" ? injectSandboxedHtmlPolyfill(rawHtml ?? "") : "",
    [isHtml, effectiveDisplayMode, rawHtml],
  );
  // A partly loaded HTML file previews whole, so Load more belongs to its source view.
  const showLoadMore = !!data?.truncated && !(isHtml && effectiveDisplayMode === "preview");
  const useLightweightSource = sourceLines.length > SOURCE_HIGHLIGHT_MAX_LINES
    && !(effectiveDisplayMode === "diff" && hasGitDiff)
    && !(effectiveDisplayMode === "preview" && hasPreview);
  const lightweightSourceLines = useMemo(
    () => useLightweightSource ? sourceLines.map((line, lineIndex) => (
      <span
        className="file-source-line flex min-w-full"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
      >
        <span aria-hidden="true" style={FILE_LINE_NUMBER_STYLE}>
          {lineIndex + 1}
        </span>
        <span
          className={`file-source-line-content min-w-0 flex-auto ${
            wrapLines ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre"
          }`}
        >
          {line}
        </span>
      </span>
    )) : null,
    [sourceLines, useLightweightSource, wrapLines],
  );

  useEffect(() => {
    const updateSelectedLineRange = () => {
      const root = contentRef.current;
      setSelectedLineRange((current) => {
        const next = onMentionLines && displayMode === "source" && root
          ? getSelectedSourceLineRange(root, window.getSelection())
          : null;
        // Skip no-op updates: selectionchange fires continuously while dragging,
        // and a fresh-but-equal range object would re-render the whole viewer.
        if (current === null && next === null) return current;
        if (current && next && current.startLine === next.startLine && current.endLine === next.endLine) return current;
        return next;
      });
    };

    updateSelectedLineRange();
    if (!onMentionLines || displayMode !== "source") return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [data?.content, displayMode, onMentionLines]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    if (!onMentionLines || !lineRange) return;
    onMentionLines(
      getRelativeFilePath(filePath, cwd),
      lineRange.startLine,
      lineRange.endLine,
    );
  }, [cwd, filePath, onMentionLines]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;

      const root = contentRef.current;
      const lineRange = root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, mentionLineRange, onMentionLines]);

  useEffect(() => {
    if (!scrollRestorePendingRef.current || loading) return;
    if (error && !isDeletedDiff) return;
    if (requestedInitialDisplayMode === "diff" && !gitDiffResolved) return;
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && displayMode !== "diff") return;

    const content = contentRef.current;
    if (!content) return;

    const lineTarget = lineTargetRef.current;
    if (lineTarget !== null) {
      lineTargetRef.current = null;
      const target = content.querySelector<HTMLElement>(
        `.file-source-line[data-line-number="${lineTarget}"]`,
      );
      if (target) {
        const targetTop = target.getBoundingClientRect().top - content.getBoundingClientRect().top;
        content.scrollTop = Math.max(0, content.scrollTop + targetTop - content.clientHeight / 3);
        // The animation ends transparent on its own; the element is discarded
        // on the next content reload, so no cleanup timer is needed.
        target.classList.add("file-viewer-line-flash");
      }
      scrollRestorePendingRef.current = false;
      return;
    }

    content.scrollTop = viewerStateRef.current.scrollTop;
    content.scrollLeft = viewerStateRef.current.scrollLeft;
    scrollRestorePendingRef.current = false;
  }, [
    data?.content,
    displayMode,
    error,
    gitDiffResolved,
    hasGitDiff,
    isDeletedDiff,
    loading,
    requestedInitialDisplayMode,
  ]);

  if (loading || (requestedInitialDisplayMode === "diff" && gitDiffLoading && !data)) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        {t("i18n.loading")}
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-destructive">
        {error}
      </div>
    );
  }

  if (!data && !isDeletedDiff) return null;

  const content = viewerContent;
  const markdownDirectory = getFileDirectory(filePath);
  const lines = sourceLines;
  const displayModes: DisplayMode[] = isDeletedDiff
    ? ["diff"]
    : [
        "source",
        ...(hasPreview ? ["preview" as const] : []),
        ...(hasGitDiff ? ["diff" as const] : []),
      ];
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : isBinary
      ? `${t("files.binary")} · ${formatFileSize(data!.size)}`
      : `${language} · ${lines.length} lines · ${formatFileSize(data!.size)}`;

  return (
    <CodeBlockShell
      // The panel frame is the viewer's own chrome; the CodeBlock shell keeps
      // only its official structure (group, header, hover-revealed actions).
      className="file-viewer-shell h-full rounded-none! border-0! bg-transparent! dark:bg-transparent!"
    >
      <CodeBlockHeader className="shrink-0 pb-2">
        <CodeBlockTitle className="text-[13px]">
          <FileIcon aria-hidden="true" strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
          {getFileName(filePath)}
        </CodeBlockTitle>
        <PathLabel className="min-w-0 font-mono text-[11.5px]" text={getRelativeFilePath(filePath, cwd)} title={filePath} />
        <span className="min-w-0 truncate text-[11.5px] text-muted-foreground" title={metadata}>
          {metadata}
        </span>
        {isDeletedDiff ? undefined : (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className={`inline-block size-[7px] shrink-0 rounded-full ${watching ? "bg-success shadow-[0_0_4px_var(--color-success)]" : "bg-border"}`}
          />
        )}
        <CodeBlockActions className="pointer-coarse:opacity-100 opacity-0 transition-opacity group-focus-within/code-block:opacity-100 group-hover/code-block:opacity-100">
          {displayModes.length > 1 && (
            <div aria-label={t("i18n.fileViewMode")} className="flex items-center gap-0.5">
              {displayModes.map((mode) => {
                const active = effectiveDisplayMode === mode;
                return (
                  <Button
                    key={mode}
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => updateDisplayMode(mode)}
                    title={mode === "diff" ? t("i18n.compareHead") : undefined}
                    aria-pressed={active}
                    className={cn(active ? "text-foreground" : "text-muted-foreground")}
                  >
                    {FILE_MODE_LABELS[mode]}
                  </Button>
                );
              })}
            </div>
          )}
          {(effectiveDisplayMode === "source" || effectiveDisplayMode === "diff") && !isBinary && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={toggleWrapLines}
              title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              aria-pressed={wrapLines}
              className={cn("text-muted-foreground", wrapLines && "bg-accent text-foreground")}
            >
              <WrapText className="size-3.5" strokeWidth={1.8} />
            </Button>
          )}
          {(onAtMention || onMentionLines) && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              // Keep the composer's selection when the click lands.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                // Mention selected lines when a range is active (and line
                // mention is wired up); otherwise fall back to a whole-file
                // @mention. Same button, behavior follows the selection.
                if (selectedLineRange && onMentionLines) {
                  mentionLineRange(selectedLineRange);
                } else {
                  onAtMention?.(getRelativeFilePath(filePath, cwd), false);
                }
              }}
              title={
                selectedLineRange && onMentionLines
                  ? `${t("i18n.mentionSelectedLines")} (L${selectedLineRange.startLine}${selectedLineRange.startLine !== selectedLineRange.endLine ? `-L${selectedLineRange.endLine}` : ""})`
                  : t("files.insertPath")
              }
              aria-label={t("files.mention")}
              disabled={!onAtMention && !onMentionLines}
              className="text-muted-foreground"
            >
              <AtSign className="size-3.5" strokeWidth={1.8} />
            </Button>
          )}
          {!isDeletedDiff && !isBinary && (
            <CodeBlockCopyButton
              value={viewerContent}
              title={t("i18n.copy")}
              className="text-muted-foreground"
            />
          )}
          {!isDeletedDiff && <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />}
        </CodeBlockActions>
      </CodeBlockHeader>

      {showLoadMore && data?.truncated && (
        <div
          className="absolute right-3 bottom-3 z-[2] mx-3 flex max-w-[calc(100%-24px)] shrink-0 items-center justify-center gap-2.5 rounded-md border border-border bg-card px-2 py-[5px] text-xs text-muted-foreground shadow-[0_3px_12px_color-mix(in_srgb,var(--foreground)_18%,transparent)] [pointer-events:auto]"
        >
          <span>{formatFileSize(data.nextOffset)} / {formatFileSize(data.size)}</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void fetchContent(filePath, data.nextOffset).finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore ? t("i18n.loading") : t("i18n.loadMore")}
          </Button>
        </div>
      )}

      {/* Content area */}
      <div
        ref={contentRef}
        className={`file-viewer-content min-h-0 min-w-0 flex-1 overflow-auto bg-background ${
          effectiveDisplayMode === "diff" && hasGitDiff ? "px-3" : ""
        }${showLoadMore ? " pb-12" : ""}`}
        onScroll={(event) => {
          viewerStateRef.current.scrollTop = event.currentTarget.scrollTop;
          viewerStateRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        {effectiveDisplayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} wrapLines={wrapLines} />
        ) : isHtml && effectiveDisplayMode === "preview" && data?.truncated && !htmlFull?.text ? (
          <div className="p-6 text-xs text-muted-foreground">
            {htmlFull?.error ?? t("i18n.loading")}
          </div>
        ) : isHtml && effectiveDisplayMode === "preview" ? (
          <iframe
            srcDoc={htmlPreview}
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-background"
             title={t("i18n.htmlPreview")}
          />
        ) : isMarkdown && effectiveDisplayMode === "preview" ? (
          <div
            className="markdown-body markdown-file-preview px-8 py-6"
          >
            {frontmatter?.data && <FrontmatterCard data={frontmatter.data} />}
            <ReactMarkdown
              remarkPlugins={markdownPreviewRemarkPlugins}
              rehypePlugins={markdownPreviewRehypePlugins}
              urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
              components={{
                code({ className, children, ...props }) {
                  const lang = className?.replace("language-", "").toLowerCase() ?? "";
                  const raw = String(children);
                  const isBlock = className?.includes("language-") || raw.includes("\n");
                  if (isBlock) {
                    if (lang === "mermaid") {
                      return <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview />;
                    }
                    return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  // Render the code block directly — CodeBlock provides its own wrapping.
                  // For non-mermaid blocks, pass through to default pre rendering.
                  return <>{children}</>;
                },
                a({ href, children, ...props }) {
                  delete props.node;
                  const linkedFile = onOpenFile
                    ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  if (!linkedFile || !onOpenFile) {
                    // Like chat links: a web or app link must not replace Pi Web.
                    return isExternalMarkdownHref(href)
                      ? <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>
                      : <a href={href} {...props} onClick={jumpToMarkdownFragment}>{children}</a>;
                  }

                  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (!shouldOpenLocalFileInApp(event)) return;
                    event.preventDefault();
                    onOpenFile(linkedFile, parseFileOpenOptions(href));
                  };

                  return <a href={href} {...props} onClick={handleClick}>{children}</a>;
                },
                img({ src, alt, ...props }) {
                  delete props.node;
                  const imagePath = typeof src === "string"
                    ? resolveLocalFileHref(src, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  const imageSrc = imagePath
                    ? getFileApiUrl(imagePath, "read", sourceSessionId)
                    : src;
                  // Dynamic local paths are served directly by the file API.
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
                },
              }}
            >
              {markdownPreview}
            </ReactMarkdown>
          </div>
        ) : isDelimitedTable && effectiveDisplayMode === "preview" ? (
          <DelimitedTable
            content={content}
            filePath={filePath}
            complete={!data?.truncated}
            scrollRef={contentRef}
          />
        ) : isBinary ? (
          // Decoded bytes are noise; opening a file never downloads it on its own (#1401).
          <div className="flex h-full flex-col items-center justify-center gap-2.5 p-6 text-center text-[13px] text-muted-foreground">
            <span>{t("files.binaryNoPreview")}</span>
            <Button asChild variant="outline" size="xs">
              <a
                href={getFileApiUrl(filePath, "download", sourceSessionId)}
                download={getFileName(filePath)}
                className="no-underline"
              >
                {t("files.download")}
              </a>
            </Button>
          </div>
        ) : useLightweightSource ? (
          <div
            // FILE_CODE_STYLE comes from DiffView.tsx, shared with the
            // highlighted source view; the wrap width is the reader's choice.
            className={`file-source-view is-lightweight min-h-full min-w-full bg-background ${wrapLines ? "w-full" : "w-max"}`}
            style={FILE_CODE_STYLE}
          >
            {lightweightSourceLines}
          </div>
        ) : (
          <SourceCodeView content={viewerContent} language={language} wrapLines={wrapLines} />
        )}
      </div>
    </CodeBlockShell>
  );
}
