"use client";

import { forwardRef, useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  AtSignIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleMinusIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderTreeIcon,
  ListIcon,
  LoaderCircleIcon,
  LoaderIcon,
  SearchIcon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { DismissButton } from "./DismissButton";
import { cn } from "@/lib/utils";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { uploadFiles, type DroppedItem, type UploadConflictStrategy, type UploadError, type UploadResponse } from "@/lib/file-upload-client";
import { buildSearchTree, type SearchTreeNode } from "@/lib/search-tree";
import type { FileTreeHiddenReason } from "@/lib/file-tree-visibility";
import { createExpandedPathsMemory } from "@/lib/file-tree-expansion";
import { loadChangesViewMode, saveChangesViewMode, type ChangesViewMode } from "@/lib/sidebar-prefs";
import { droppedItems } from "@/hooks/useDragDrop";
import { useI18n } from "@/hooks/useI18n";
type Translate = ReturnType<typeof useI18n>["t"];

/** Why a listed entry is normally left out; only listings with `hidden=1` report it. */
type HiddenReason = Exclude<FileTreeHiddenReason, "always">;

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  /** Where a directory link leads when that is outside the browsable roots. */
  outsideLinkTarget?: string;
  /** That target contains the project or the home folder. */
  outsideLinkEncloses?: boolean;
  hidden?: HiddenReason;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
  outsideLinkTarget?: string;
  outsideLinkEncloses?: boolean;
  hidden?: HiddenReason;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  changesCollapsed: boolean;
  onChangesCountChange?: (count: number) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
  /** Also list what Git ignores, dimmed (the explorer bar's switch). */
  showHidden?: boolean;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
}

type UploadPhase = "idle" | "checking" | "uploading";

// Each folder's open directories for the page's life, so moving to another
// project and back (a session picked in another group) does not fold the tree.
const expandedPathsByCwd = createExpandedPathsMemory();

interface UploadSummary {
  directory: string;
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

interface PendingConflict {
  directory: string;
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

async function responseError(res: Response, fallback: string): Promise<Error> {
  let message = `${fallback} (HTTP ${res.status})`;
  try {
    const data = await res.json() as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // ignore non-JSON error bodies
  }
  return new Error(message);
}

async function fetchEntries(dirPath: string, showHidden = false): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list${showHidden ? "&hidden=1" : ""}`);
  if (!res.ok) throw await responseError(res, "Failed to load files");
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
    outsideLinkTarget: e.outsideLinkTarget,
    outsideLinkEncloses: e.outsideLinkEncloses,
    hidden: e.hidden,
  }));
}

// Sends the target the operator was shown, so a link pointed elsewhere since
// the listing is refused instead of granting a directory nobody looked at.
async function allowOutsideLink(linkPath: string, target: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(linkPath)}?type=allow-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw await responseError(res, "Failed to allow the linked folder");
}

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
}

const GIT_STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

// Git 状态取色走 token 工具类（modified/amber→warning、added/renamed-green→success、
// deleted/red→destructive、renamed/blue→primary），由状态键查类名，保持单一来源。
const GIT_STATUS_TEXT_CLASSES: Record<GitFileStatusKind, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-destructive",
  renamed: "text-primary",
  untracked: "text-success",
  conflict: "text-destructive",
};

function GitStatusBadge({ status, t }: { status: GitFileStatus; t: Translate }) {
  return (
    <span
      title={t(GIT_STATUS_KEYS[status.status])}
      aria-label={t(GIT_STATUS_KEYS[status.status])}
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center font-mono text-xs font-semibold",
        GIT_STATUS_TEXT_CLASSES[status.status],
      )}
    >
      {status.code}
    </span>
  );
}

// Listed only while the explorer shows ignored files: dimmed like VS Code's
// ignored entries, the reason in the name's tooltip.
const HIDDEN_REASON_KEYS = {
  ignored: "files.hiddenIgnored",
  excluded: "files.hiddenExcluded",
} as const satisfies Record<HiddenReason, string>;

export function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  changedDirectoryPaths,
  showHidden = false,
  parentHidden,
  dropTargetPath,
  onDropFiles,
  onDropTargetChange,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken?: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  showHidden?: boolean;
  /** Set inside a hidden directory: Git has no answer there, so its entries inherit the reason. */
  parentHidden?: HiddenReason;
  dropTargetPath?: string | null;
  onDropFiles?: (directory: string, items: DroppedItem[]) => void;
  onDropTargetChange?: (path: string | null) => void;
  t: Translate;
}) {
  const open = expandedPaths.has(node.fullPath);
  const hidden = node.hidden ?? parentHidden;
  const isDropTarget = node.isDir && dropTargetPath === node.fullPath;
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [allowedLinkTarget, setAllowedLinkTarget] = useState<string | null>(null);
  const [allowingLink, setAllowingLink] = useState(false);
  const [allowLinkError, setAllowLinkError] = useState<string | null>(null);
  // A link leading outside the project is refused until the operator allows
  // its target, so it asks for that instead of listing (#748).
  const pendingLinkTarget = node.outsideLinkTarget && node.outsideLinkTarget !== allowedLinkTarget
    ? node.outsideLinkTarget
    : null;

  // A listing that reports the link again (a server restart forgets allowed
  // targets, or the link was pointed elsewhere) needs a new decision.
  useEffect(() => {
    setAllowedLinkTarget(null);
    setAllowLinkError(null);
  }, [node.outsideLinkTarget]);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    setLoadError(null);
    try {
      const entries = await fetchEntries(node.fullPath, showHidden);
      setChildren(entries);
      setLoaded(true);
    } catch (error: unknown) {
      // Surface the failure inline; loaded stays false so the next click retries.
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath, showHidden]);

  // The switch changes what every listing holds: reload an open directory now
  // and a collapsed one when it next opens.
  const listedShowHiddenRef = useRef(showHidden);
  useEffect(() => {
    if (listedShowHiddenRef.current === showHidden) return;
    listedShowHiddenRef.current = showHidden;
    if (!loaded) return;
    if (open && !pendingLinkTarget) loadChildren(true);
    else setLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  // A hidden directory left expanded mounts open again when the switch comes
  // back on, before anything listed it.
  useEffect(() => {
    if (node.isDir && open && !loaded && !pendingLinkTarget) loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch children when the tree refreshes: an open directory now, a
  // collapsed one when it next opens (a file dropped onto its row).
  useEffect(() => {
    if (refreshToken === undefined || !loaded || pendingLinkTarget) return;
    if (open) loadChildren(true);
    else setLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded && !pendingLinkTarget) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, pendingLinkTarget, loadChildren, onOpenFile, onToggleExpanded]);

  const handleAllowLink = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!pendingLinkTarget) return;
    // A link to `/`, `~` or a parent of the project opens far more than a
    // sibling folder, and a cloned repository can contain one.
    if (node.outsideLinkEncloses && !window.confirm(t("files.allowEnclosingLinkConfirm", { target: pendingLinkTarget }))) {
      return;
    }
    setAllowingLink(true);
    setAllowLinkError(null);
    try {
      await allowOutsideLink(node.fullPath, pendingLinkTarget);
      setAllowedLinkTarget(pendingLinkTarget);
      await loadChildren(true);
    } catch (error) {
      setAllowLinkError(error instanceof Error ? error.message : String(error));
    } finally {
      setAllowingLink(false);
    }
  }, [node.fullPath, node.outsideLinkEncloses, pendingLinkTarget, loadChildren, t]);

  return (
    <div>
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={node.isDir ? (event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          onDropTargetChange?.(node.fullPath);
        } : undefined}
        onDrop={node.isDir ? (event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          onDropTargetChange?.(null);
          onDropFiles?.(node.fullPath, droppedItems(event.dataTransfer));
        } : undefined}
        className={cn(
          "relative flex h-[var(--file-row-height)] cursor-pointer items-center gap-1 rounded-sm pr-2 select-none",
          // 拖拽目标虚线框优先于行悬停底色（hovered 态不触发于拖拽中，二者不冲突）
          isDropTarget &&
            "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] outline-1 outline-dashed outline-primary -outline-offset-1",
          !isDropTarget && hovered && "bg-secondary",
        )}
        style={{ paddingLeft: 8 + depth * 14 }} /* 树深度缩进为逐行计算值 */
      >
        {node.isDir && (
          <ChevronRightIcon
            size={13}
            strokeWidth={1.8}
            className={cn("shrink-0 text-dim transition-transform duration-100", open && "rotate-90")}
          />
        )}
        {!node.isDir && <span className="w-2.5 shrink-0" />}
        <span className={cn("flex shrink-0 items-center", hidden && "opacity-55")}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        <span
          data-hidden-reason={hidden}
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            hidden ? "text-muted-foreground opacity-55" : "text-foreground",
          )}
          title={hidden ? `${node.fullPath}\n${t(HIDDEN_REASON_KEYS[hidden])}` : node.fullPath}
        >
          {node.name}
        </span>
        {!hovered && pendingLinkTarget && (
          <span
            title={t("files.outsideLink", { target: pendingLinkTarget })}
            aria-label={t("files.outsideLink", { target: pendingLinkTarget })}
            className="flex size-3.5 shrink-0 items-center justify-center text-dim"
          >
            <ExternalLinkIcon size={13} strokeWidth={1.8} />
          </span>
        )}
        {highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            <span className="size-1.5 rounded-full bg-primary" />
          </span>
        )}
        {!hovered && !node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {!hovered && containsGitChanges && (
          <span
            title={t("files.containsChangedFiles")}
            aria-label={t("files.containsChangedFiles")}
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            <span className="size-1.5 rounded-full bg-warning" />
          </span>
        )}
        {loading && (
          <LoaderIcon size={13} strokeWidth={1.8} className="shrink-0 text-dim" />
        )}
        {onAtMention && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            className={cn(
              "absolute top-1/2 flex h-[calc(var(--file-row-height)-4px)] -translate-y-1/2 cursor-pointer items-center justify-center gap-1 rounded-sm border border-border bg-card px-2 py-0 text-xs font-semibold whitespace-nowrap text-primary",
              "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              node.isDir ? "right-1" : "right-7",
            )}
          >
            <AtSignIcon size={13} strokeWidth={1.8} />
            {t("files.mention")}
          </button>
        )}
        {hovered && !node.isDir && (
          <a
            href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
            download
            onClick={(e) => e.stopPropagation()}
            title={t("files.download")}
            className="absolute right-1 top-1/2 flex h-[calc(var(--file-row-height)-4px)] -translate-y-1/2 cursor-pointer items-center justify-center gap-1 rounded-sm border border-border bg-card px-[5px] py-0 text-xs font-semibold text-muted-foreground no-underline outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <DownloadIcon size={13} strokeWidth={1.8} />
          </a>
        )}
      </div>
      {node.isDir && open && pendingLinkTarget && (
        <div
          className="flex flex-col items-start gap-1 pb-[5px] pr-2 pt-[3px] text-xs text-dim"
          style={{ paddingLeft: 8 + (depth + 1) * 14 }} /* 树深度缩进为逐行计算值 */
        >
          <span className="break-all">{t("files.outsideLink", { target: pendingLinkTarget })}</span>
          {node.outsideLinkEncloses && (
            <span className="text-warning">{t("files.outsideLinkEncloses")}</span>
          )}
          <button
            type="button"
            title={t("files.allowOutsideLinkTitle", { target: pendingLinkTarget })}
            className="h-[calc(var(--file-row-height)-4px)] rounded-sm border border-border bg-card px-2 py-0 text-xs font-semibold whitespace-nowrap text-primary outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer disabled:cursor-default disabled:opacity-60"
            onClick={handleAllowLink}
            disabled={allowingLink}
          >
            {t("files.allowOutsideLink")}
          </button>
          {allowLinkError && (
            <span role="alert" className="break-words text-destructive">{allowLinkError}</span>
          )}
        </div>
      )}
      {node.isDir && open && !pendingLinkTarget && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              gitStatusByPath={gitStatusByPath}
              changedDirectoryPaths={changedDirectoryPaths}
              showHidden={showHidden}
              parentHidden={hidden}
              dropTargetPath={dropTargetPath}
              onDropFiles={onDropFiles}
              onDropTargetChange={onDropTargetChange}
              t={t}
            />
          ))}
          {children.length === 0 && loaded && !loadError && (
            <div
              className="flex h-[22px] items-center text-xs text-dim"
              style={{ paddingLeft: 8 + (depth + 1) * 14 }} /* 树深度缩进为逐行计算值 */
            >
              empty
            </div>
          )}
          {!loading && loadError !== null && (
            <div
              role="alert"
              onClick={(e) => { e.stopPropagation(); void loadChildren(true); }}
              title={`${loadError} — click to retry`}
              className="flex h-[22px] min-w-0 cursor-pointer items-center gap-1 text-xs text-destructive"
              style={{ paddingLeft: 8 + (depth + 1) * 14 }} /* 树深度缩进为逐行计算值 */
            >
              <span className="truncate">{loadError}</span>
              <span className="shrink-0">↻</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };

type OpenFileHandler = (filePath: string, fileName: string, options?: OpenFileOptions) => void;

function ChangeRow({
  status,
  cwd,
  onOpenFile,
  onAtMention,
  t,
  depth = 0,
  treeMode = false,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
  depth?: number;
  treeMode?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  // Split the path so the directory part ellipsizes while the file name stays fully visible
  const lastSlash = rel.lastIndexOf("/");
  const dirPart = !treeMode && lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
  const baseName = treeMode ? name : (lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel);
  return (
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      className={cn(
        "relative flex h-[var(--file-row-height)] cursor-pointer items-center rounded-sm pr-2 select-none",
        treeMode ? "gap-1" : "gap-1.5",
        hovered && "bg-secondary",
      )}
      style={{ paddingLeft: treeMode ? 8 + depth * 14 : 10 }} /* 树深度缩进为逐行计算值 */
    >
      <GitStatusBadge status={status} t={t} />
      {treeMode && <span className="w-2.5 shrink-0" />}
      <span className="flex shrink-0 items-center opacity-85">
        {getFileIcon(name, 13)}
      </span>
      <span
        title={status.filePath}
        className="flex min-w-0 flex-1 items-center text-xs text-foreground"
      >
        {dirPart && (
          <span className="min-w-0 flex-[0_1_auto] truncate text-dim">
            {dirPart}
          </span>
        )}
        <span className={cn("max-w-full truncate", treeMode ? "shrink" : "shrink-0")}>
          {baseName}
        </span>
      </span>
      {onAtMention && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAtMention(rel, false);
          }}
          title={t("files.insertPath")}
          className="absolute right-1 top-1/2 flex h-[calc(var(--file-row-height)-4px)] -translate-y-1/2 cursor-pointer items-center justify-center gap-1 rounded-sm border border-border bg-card px-2 py-0 text-xs font-semibold whitespace-nowrap text-primary outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <AtSignIcon size={13} strokeWidth={1.8} />
          {t("files.mention")}
        </button>
      )}
    </div>
  );
}

function ChangesFolderRow({
  node,
  depth,
  open,
  onToggle,
}: {
  node: SearchTreeNode;
  depth: number;
  open: boolean;
  onToggle: (path: string, open: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => onToggle(node.path, !open)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={node.path}
      className={cn(
        "flex h-[var(--file-row-height)] cursor-pointer items-center gap-1 rounded-sm pr-2 select-none",
        hovered && "bg-secondary",
      )}
      style={{ paddingLeft: 8 + depth * 14 }} /* 树深度缩进为逐行计算值 */
    >
      <ChevronRightIcon
        size={13}
        strokeWidth={1.8}
        className={cn("shrink-0 text-dim transition-transform duration-100", open && "rotate-90")}
      />
      <span className="flex shrink-0 items-center">
        <FolderIcon size={14} open={open} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {node.name}
      </span>
    </div>
  );
}

function ChangesTreeRows({
  nodes,
  depth,
  cwd,
  statusByPath,
  collapsedPaths,
  onToggleExpanded,
  onOpenFile,
  onAtMention,
  t,
}: {
  nodes: SearchTreeNode[];
  depth: number;
  cwd: string;
  statusByPath: Map<string, GitFileStatus>;
  collapsedPaths: Set<string>;
  onToggleExpanded: (path: string, open: boolean) => void;
  onOpenFile: OpenFileHandler;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.isDir) {
          const open = !collapsedPaths.has(node.path);
          return (
            <div key={`dir:${node.path}`}>
              <ChangesFolderRow
                node={node}
                depth={depth}
                open={open}
                onToggle={onToggleExpanded}
              />
              {open && (
                <ChangesTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  cwd={cwd}
                  statusByPath={statusByPath}
                  collapsedPaths={collapsedPaths}
                  onToggleExpanded={onToggleExpanded}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                  t={t}
                />
              )}
            </div>
          );
        }
        const status = statusByPath.get(node.path);
        if (!status) return null;
        return (
          <ChangeRow
            key={status.filePath}
            status={status}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onAtMention={onAtMention}
            t={t}
            depth={depth}
            treeMode
          />
        );
      })}
    </>
  );
}

function ChangesViewToggleIcon({ mode }: { mode: ChangesViewMode }) {
  if (mode === "tree") {
    // List icon: switching back to the flat list
    return <ListIcon size={14} strokeWidth={1.8} />;
  }
  // Tree icon: switching to the folder tree
  return <FolderTreeIcon size={14} strokeWidth={1.8} />;
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(function FileExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
  changesCollapsed,
  onChangesCountChange,
  fileSearchOpen = false,
  onFileSearchOpenChange,
  showHidden = false,
}, ref) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [gitLineStats, setGitLineStats] = useState({ additions: 0, deletions: 0 });
  const [changesViewMode, setChangesViewMode] = useState<ChangesViewMode>("list");
  // Folders stay open unless collapsed here, so a refresh or a newly changed folder never folds them.
  const [collapsedChangeDirs, setCollapsedChangeDirs] = useState<Set<string>>(() => new Set());
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPaths, setSearchPaths] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const fileDragDepthRef = useRef(0);
  const prevCwdRef = useRef<string | null>(null);
  const expandedPathsRef = useRef(expandedPaths);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Reuse the cached, bounded file index used by @ mentions.
  useEffect(() => {
    if (!fileSearchOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchPaths([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ matches?: FileIndexEntry[] }> : Promise.reject(new Error("Search failed")))
        .then((data) => setSearchPaths((data.matches ?? []).filter((entry) => !entry.isDir).map((entry) => entry.path)))
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchPaths([]);
            setSearchError(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cwd, fileSearchOpen, searchQuery]);

  // Focus the search input whenever the search panel opens.
  useEffect(() => {
    if (fileSearchOpen) searchInputRef.current?.focus();
  }, [fileSearchOpen]);

  // Results render as a tree; keep every directory that contains a match
  // expanded, while preserving the user's manual collapses as they type.
  useEffect(() => {
    if (searchPaths.length === 0) return;
    const dirs = new Set<string>();
    for (const relative of searchPaths) {
      const parts = relative.split("/");
      let path = "";
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        dirs.add(joinFilePath(cwd, path));
      }
    }
    setSearchExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of dirs) {
        if (!next.has(dir)) { next.add(dir); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [cwd, searchPaths]);

  const searchRoots = useMemo(() => {
    const toFileNode = (node: SearchTreeNode): FileNode => ({
      name: node.name,
      fullPath: joinFilePath(cwd, node.path),
      isDir: node.isDir,
      size: 0,
      children: node.children.map(toFileNode),
      loaded: true,
    });
    return buildSearchTree(searchPaths).map(toFileNode);
  }, [cwd, searchPaths]);

  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const changesByRelativePath = useMemo(() => new Map(gitFiles.map((status) => [
    normalizeFilePathSlashes(getRelativeFilePath(status.filePath, cwd)).replace(/^\/+/, ""),
    status,
  ])), [cwd, gitFiles]);
  const changesTree = useMemo(() => buildSearchTree([...changesByRelativePath.keys()]), [changesByRelativePath]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const applyUploadResult = useCallback((data: UploadResponse, directory: string) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    setUploadSummary({ directory, uploaded, skipped, errors });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map((name) => joinFilePath(directory, name))));
      setTreeRefreshKey((key) => key + 1);
    }
  }, []);

  const performUpload = useCallback(async (
    files: File[],
    strategy: UploadConflictStrategy,
    directory: string,
  ) => {
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(directory, files, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({
          directory,
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(data, directory);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult]);

  const prepareUpload = useCallback(async (files: File[], directory: string) => {
    if (files.length === 0 || uploadBusy) return;
    setUploadSummary(null);
    setHighlightedPaths(new Set());
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const res = await fetch(
        `/api/files/${encodeFilePathForApi(directory)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileNames: files.map((file) => file.name) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        setPendingConflict({
          directory,
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }

      await performUpload(files, "error", directory);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [performUpload, uploadBusy]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void prepareUpload(files, cwd);
  }, [cwd, prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker() {
      if (!uploadBusy) uploadInputRef.current?.click();
    },
  }), [uploadBusy]);

  const resetFileDrag = useCallback(() => {
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    setDropTargetPath(null);
  }, []);

  const handleExplorerDragEnter = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  }, []);

  const handleExplorerDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    // Directory rows stop dragover propagation, so this handler only runs
    // while hovering the panel background: those uploads target the cwd.
    setDropTargetPath((prev) => (prev === null ? prev : null));
  }, []);

  const handleExplorerDragLeave = useCallback(() => {
    if (fileDragDepthRef.current <= 0) return;
    fileDragDepthRef.current -= 1;
    if (fileDragDepthRef.current === 0) {
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
      setDropTargetPath(null);
    }
  }, []);

  const handleDropFiles = useCallback((directory: string, items: DroppedItem[]) => {
    resetFileDrag();
    // The endpoint writes files only: a dropped folder would fail the whole
    // upload, so folders are left out with the chat drop's notice.
    const files = items.flatMap((item) => (item.kind === "file" ? [item.file] : []));
    const folders = items.flatMap((item) => (item.kind === "folder" ? [item.name] : []));
    void prepareUpload(files, directory).then(() => {
      if (folders.length === 0) return;
      const notice = t("chat.dropFoldersUnsupported", { names: folders.join(", ") });
      // An error from this upload says why its files did not land: keep it.
      setUploadError((error) => (error && files.length > 0 ? error : notice));
    });
  }, [prepareUpload, resetFileDrag, t]);

  const handleExplorerDrop = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    handleDropFiles(dropTargetPath ?? cwd, droppedItems(event.dataTransfer));
  }, [cwd, dropTargetPath, handleDropFiles]);

  const handleDropTargetChange = useCallback((path: string | null) => {
    setDropTargetPath((prev) => (prev === path ? prev : path));
  }, []);

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  // Declared before the cwd effect, so that one saves the set the user last saw.
  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  // An explorer that unmounts (its cwd gone, then back) saves its folder's set too, so it comes back open.
  useEffect(() => () => {
    if (prevCwdRef.current !== null) expandedPathsByCwd.save(prevCwdRef.current, expandedPathsRef.current);
  }, []);

  useEffect(() => {
    const previousCwd = prevCwdRef.current;
    const cwdChanged = previousCwd !== cwd;
    prevCwdRef.current = cwd;

    // Swap the open directories only when cwd changes, not on refreshKey bumps.
    // The roots unmount while the new cwd loads, so each restored directory
    // mounts open and lists itself; one that is gone is never listed to look.
    if (cwdChanged) {
      if (previousCwd !== null) expandedPathsByCwd.save(previousCwd, expandedPathsRef.current);
      const restored = expandedPathsByCwd.restore(cwd);
      expandedPathsRef.current = restored;
      setExpandedPaths(restored);
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd, showHidden)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey, showHidden]);

  // Files changed outside pi-web (an editor, a terminal) show up once the
  // window is back in front (#1144).
  useEffect(() => {
    const refresh = () => setTreeRefreshKey((key) => key + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)
      .then((status) => {
        if (!cancelled) {
          setGitFiles(status.isGitRepository ? status.files : []);
          setGitLineStats(status.isGitRepository
            ? { additions: status.additions, deletions: status.deletions }
            : { additions: 0, deletions: 0 });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitFiles([]);
          setGitLineStats({ additions: 0, deletions: 0 });
        }
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  useEffect(() => {
    setChangesViewMode(loadChangesViewMode());
  }, []);

  const handleToggleChangesExpanded = useCallback((path: string, open: boolean) => {
    setCollapsedChangeDirs((prev) => {
      const next = new Set(prev);
      if (open) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleChangesViewModeToggle = useCallback(() => {
    setChangesViewMode((prev) => {
      const next: ChangesViewMode = prev === "list" ? "tree" : "list";
      saveChangesViewMode(next);
      return next;
    });
  }, []);

  const showUploadFeedback = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => getRelativeFilePath(joinFilePath(uploadSummary.directory, name), cwd)),
    );
  }, [cwd, onAtMentions, uploadSummary]);

  return (
    <div
      className="min-h-full"
      onDragEnter={handleExplorerDragEnter}
      onDragOver={handleExplorerDragOver}
      onDragLeave={handleExplorerDragLeave}
      onDrop={handleExplorerDrop}
    >
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      {showUploadFeedback && (
        <div className="border-b border-border px-2 py-1.5">
        {uploadBusy && (
          <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}>
            <div className="flex min-h-[14px] items-center justify-between gap-2 text-muted-foreground">
              {uploadPhase === "checking" ? (
                <LoaderCircleIcon size={13} strokeWidth={1.8} className="animate-spin" />
              ) : (
                <UploadIcon size={13} strokeWidth={1.8} />
              )}
              {uploadPhase === "uploading" && <span className="text-[10px]">{uploadProgress}%</span>}
            </div>
            {uploadPhase === "uploading" && (
              <div className="mt-1 h-[3px] overflow-hidden rounded-[2px] bg-border">
                <div className="h-full bg-muted-foreground transition-[width] duration-[120ms]" style={{ width: `${uploadProgress}%` }} /* 进度百分比为动态测量值 */ />
              </div>
            )}
          </div>
        )}

        {pendingConflict && (
          <div role="alert" className="rounded-sm border border-[color-mix(in_srgb,var(--warning)_55%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_9%,var(--bg-panel))] p-[7px]">
            <div className="text-xs leading-[1.35] text-foreground [overflow-wrap:anywhere]">
              {t("files.conflictSummary", { count: pendingConflict.conflicts.length, countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s", files: pendingConflict.conflicts.join(", ") })}
            </div>
            {pendingConflict.nonReplaceable.length > 0 && (
              <div className="mt-[3px] text-[10px] leading-[1.35] text-warning [overflow-wrap:anywhere]">
                {t("files.cannotReplace", { files: pendingConflict.nonReplaceable.join(", ") })}
              </div>
            )}
            <div className="mt-[7px] flex gap-[5px]">
              <button type="button" onClick={() => void performUpload(pendingConflict.files, "overwrite", pendingConflict.directory)} className="h-[22px] cursor-pointer rounded-sm border border-destructive bg-transparent px-[7px] py-0 text-[10px] text-destructive outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {t("files.replace")}
              </button>
              <button type="button" onClick={() => void performUpload(pendingConflict.files, "skip", pendingConflict.directory)} className="h-[22px] cursor-pointer rounded-sm border border-border bg-card px-[7px] py-0 text-[10px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {t("files.skipExisting")}
              </button>
              <button type="button" onClick={() => setPendingConflict(null)} className="h-[22px] cursor-pointer rounded-sm border-none bg-transparent px-[7px] py-0 text-[10px] text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {t("files.cancel")}
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div role="alert" className="flex items-start gap-1.5 text-xs leading-[1.35] text-destructive">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{uploadError}</span>
            <DismissButton onClick={() => setUploadError(null)} title={t("files.dismissError")} />
          </div>
        )}

        {uploadSummary && (
          <div aria-live="polite">
            <div className="flex min-h-[22px] items-center gap-2 text-xs">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {uploadSummary.uploaded.length > 0 && (
                  <span title={t("files.uploadedCount", { count: uploadSummary.uploaded.length })} aria-label={t("files.uploadedCount", { count: uploadSummary.uploaded.length })} className="flex items-center gap-[3px] text-success">
                    <CheckIcon size={13} strokeWidth={1.8} />
                    <span>{uploadSummary.uploaded.length}</span>
                  </span>
                )}
                {uploadSummary.skipped.length > 0 && (
                  <span title={t("files.skippedCount", { count: uploadSummary.skipped.length })} aria-label={t("files.skippedCount", { count: uploadSummary.skipped.length })} className="flex items-center gap-[3px] text-dim">
                    <CircleMinusIcon size={13} strokeWidth={1.8} />
                    <span>{uploadSummary.skipped.length}</span>
                  </span>
                )}
                {uploadSummary.errors.length > 0 && (
                  <span title={t("files.failedCount", { count: uploadSummary.errors.length })} aria-label={t("files.failedCount", { count: uploadSummary.errors.length })} className="flex items-center gap-[3px] text-destructive">
                    <TriangleAlertIcon size={13} strokeWidth={1.8} />
                    <span>{uploadSummary.errors.length}</span>
                  </span>
                )}
              </div>
              {uploadSummary.uploaded.length > 0 && onAtMentions && (
                <button
                  type="button"
                  onClick={addUploadedFilesToChat}
                  title={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  aria-label={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  className="flex h-[22px] shrink-0 cursor-pointer items-center justify-center gap-1 rounded-sm border border-border bg-card px-[7px] py-0 text-xs font-semibold whitespace-nowrap text-primary outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <AtSignIcon size={13} strokeWidth={1.8} />
                  {t("files.mention")}
                </button>
              )}
              <DismissButton onClick={() => setUploadSummary(null)} title={t("files.dismissUploadResults")} />
            </div>
            {uploadSummary.errors.map((item) => (
              <div key={item.name} title={item.error} className="mt-[3px] flex min-w-0 items-center gap-1 text-[10px] text-destructive">
                <CircleAlertIcon size={13} strokeWidth={1.8} className="shrink-0" />
                <span className="min-w-0 truncate">{item.name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {fileSearchOpen && (
      <div className="px-2 pb-1.5 pt-0.5">
        <div className="relative">
          <SearchIcon size={13} strokeWidth={1.8} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            ref={searchInputRef}
            id="file-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Handled here: the debug panel and other document listeners leave this Escape alone.
              event.preventDefault();
              onFileSearchOpenChange?.(false);
            }}
            placeholder={t("sidebar.searchFilesPlaceholder")}
            aria-label={t("sidebar.searchFiles")}
            className="w-full rounded-md border border-border bg-background px-6 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title={t("sidebar.clearSearch")}
              aria-label={t("sidebar.clearSearch")}
              className="absolute right-1 top-1/2 flex size-[18px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-dim outline-none transition-colors enabled:hover:bg-secondary enabled:hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <XIcon size={13} strokeWidth={1.8} />
            </button>
          )}
        </div>
        {hasSearchQuery && (
          <div className="pt-[3px]">
            {searchLoading && <div role="status" className="px-[2px] py-1.5 text-[10px] text-dim">{t("sidebar.searchingFiles")}</div>}
            {!searchLoading && searchError && <div role="alert" className="px-[2px] py-1.5 text-[10px] text-destructive">{t("i18n.networkError")}</div>}
            {!searchLoading && !searchError && searchPaths.length === 0 && <div className="px-[2px] py-1.5 text-[10px] text-dim">{t("sidebar.noMatchingFiles")}</div>}
            {!searchLoading && !searchError && searchPaths.length > 0 && (
              <div>
                {searchRoots.map((node) => (
                  <TreeNode
                    key={`${searchQuery}:${node.fullPath}`}
                    node={node}
                    depth={0}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    onAtMention={onAtMention}
                    expandedPaths={searchExpanded}
                    onToggleExpanded={(fullPath, open) => {
                      setSearchExpanded((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(fullPath); else next.delete(fullPath);
                        return next;
                      });
                    }}
                    highlightedPaths={highlightedPaths}
                    gitStatusByPath={gitStatusByPath}
                    changedDirectoryPaths={changedDirectoryPaths}
                    dropTargetPath={dropTargetPath}
                    onDropFiles={handleDropFiles}
                    onDropTargetChange={handleDropTargetChange}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!changesCollapsed && gitFiles.length > 0 && (
        <div className="px-1 pb-0.5">
          <div
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            className="flex h-6 items-center gap-1.5 pl-2.5 pr-1.5 text-xs"
          >
            <span className="text-dim">
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span className="font-mono text-success">+{gitLineStats.additions}</span>
            <span className="font-mono text-destructive">-{gitLineStats.deletions}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleChangesViewModeToggle}
              title={changesViewMode === "list" ? t("files.viewAsTree") : t("files.viewAsList")}
              aria-label={changesViewMode === "list" ? t("files.viewAsTree") : t("files.viewAsList")}
              aria-pressed={changesViewMode === "tree"}
              className="flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-dim outline-none transition-colors enabled:hover:bg-secondary enabled:hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChangesViewToggleIcon mode={changesViewMode} />
            </button>
          </div>
          {changesViewMode === "tree" ? (
            <ChangesTreeRows
              nodes={changesTree}
              depth={0}
              cwd={cwd}
              statusByPath={changesByRelativePath}
              collapsedPaths={collapsedChangeDirs}
              onToggleExpanded={handleToggleChangesExpanded}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              t={t}
            />
          ) : (
            gitFiles.map((status) => (
              <ChangeRow
                key={status.filePath}
                status={status}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                t={t}
              />
            ))
          )}
        </div>
      )}

      {(changesCollapsed || gitFiles.length === 0) && (!fileSearchOpen || !hasSearchQuery) && (
        <div className="px-1 py-[2px]">
          {loading ? (
            <div className="px-3 py-2 text-xs text-dim">{t("files.loading")}</div>
          ) : error ? (
            <div className="px-3 py-2 text-xs text-destructive">{error}</div>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={node.fullPath}
                node={node}
                depth={0}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                expandedPaths={expandedPaths}
                onToggleExpanded={handleToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                changedDirectoryPaths={changedDirectoryPaths}
                showHidden={showHidden}
                dropTargetPath={dropTargetPath}
                onDropFiles={handleDropFiles}
                onDropTargetChange={handleDropTargetChange}
                t={t}
              />
            ))
          )}
          {!loading && !error && roots.length === 0 && (
            <div className="px-3 py-2 text-xs text-dim">
              {t("files.noFiles")}
            </div>
          )}
        </div>
      )}
      {/* Last, pinned to the bottom: at the top it pushed every row down as
          a drag came in, so the row under the pointer changed. Drags pass
          through it to the row it covers. */}
      {fileDragActive && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none sticky bottom-0 z-[1] flex select-none items-center gap-1.5 border-t border-border bg-card px-2 py-1.5 text-xs text-primary"
        >
          <UploadIcon size={13} strokeWidth={1.8} className="shrink-0" />
          {t("files.dropToUpload", {
            directory: dropTargetPath
              ? (getRelativeFilePath(dropTargetPath, cwd) || dropTargetPath)
              : (getFileName(cwd) || cwd),
          })}
        </div>
      )}
    </div>
  );
});
