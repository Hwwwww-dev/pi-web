"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FolderIcon,
  GitBranchIcon,
  RotateCwIcon,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useIsNarrowMobile } from "@/hooks/useIsMobile";
import { formatFileSize } from "@/lib/file-types";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRelativeFilePath, joinFilePath } from "@/lib/file-paths";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DiffView } from "./DiffView";
import { PathLabel } from "./PathLabel";
import { FileMentionButton, FileToolbar, FILE_MODE_LABELS } from "./FileToolbar";
import { SourceCodeView } from "./SourceCodeView";

/** One row of `GET /api/git/repos`. */
interface GitRepository {
  repositoryRoot: string;
  name: string;
  relativePath: string;
  branch: string;
}

/** One row of `GET /api/git/log`. */
interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  timestamp: number;
  subject: string;
  body: string;
  /** Reachable from at least one remote branch. */
  pushed: boolean;
}

/** One row of `GET /api/git/branches`. */
interface RepositoryBranches {
  branches: string[];
  current: string | null;
}

/** One row of `GET /api/git/commit` (without `path`): changed file with line counts. */
interface CommitDetailFile {
  path: string;
  status: string;
  previousPath?: string;
  /** Added lines; null for binary files. */
  additions: number | null;
  /** Deleted lines; null for binary files. */
  deletions: number | null;
}

/** `GET /api/git/file` — one file as it exists at one commit. */
interface CommitFileContent {
  content: string;
  language: string;
  size: number;
  truncated: boolean;
}

type SourceFileState = CommitFileContent & { lines: number };

/** The diff layer shows the commit's patch or the file's content at that commit. */
type DiffLayerMode = "source" | "diff";

type GitView =
  | { type: "log" }
  | { type: "detail"; commit: CommitSummary }
  | { type: "diff"; commit: CommitSummary; file: CommitDetailFile };

const LOG_PAGE_SIZE = 20;

/** Status letter → status-pill classes (added/modified/deleted/renamed/copied/typechange). */
const STATUS_CLASSES: Record<string, string> = {
  A: "text-success bg-success/15",
  M: "text-warning bg-warning/15",
  D: "text-destructive bg-destructive/10",
  R: "text-primary bg-primary/15",
  C: "text-primary bg-primary/15",
  T: "text-warning bg-warning/15",
};

const STATUS_FALLBACK_CLASS = "text-muted-foreground bg-muted";

/** Shared panel button: 36px touch target, token palette, hover/disabled per §5.6. */
const buttonClass =
  "inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent enabled:hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";

/** Toolbar pickers take the whole row on narrow phones (was `useIsNarrowMobile`). */
const NARROW_FULL_ROW = "max-[480px]:flex-[1_1_100%]";

interface DropdownOption {
  value: string;
  primary: string;
  secondary?: string;
}

/** Custom dropdown (no native select), modeled after the sidebar branch switcher. */
function GitDropdown({ value, options, onSelect, ariaLabel, placeholder, icon, disabled = false, className }: {
  value: string | null;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  icon: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <div ref={rootRef} className={cn("relative min-w-0 flex-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="default"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "h-auto py-0 justify-start has-[>svg]:px-2.5",
          "flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-left text-xs text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <span className="flex shrink-0 items-center text-muted-foreground" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">
          {selected ? selected.primary : placeholder}
        </span>
        {selected?.secondary && (
          <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">{selected.secondary}</span>
        )}
        <ChevronDownIcon
          className={cn("size-[13px] shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={1.8}
        />
      </Button>
      {open && (
        <div
          role="listbox"
          // 定位锚定：自定义下拉（见 GitPanel.test：不用 native select / Radix），
          // 面板锚在触发器正下方并随触发器宽度拉伸。
          className="absolute inset-x-0 top-[calc(100%+4px)] z-[100] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div className="max-h-[min(40vh,300px)] touch-pan-y overflow-y-auto">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  role="option"
                  variant="ghost"
                  size="default"
                  aria-selected={isSelected}
                  onClick={() => { setOpen(false); onSelect(option.value); }}
                  className={cn(
                    "h-auto justify-start focus-visible:ring-0 focus-visible:border-transparent has-[>svg]:px-2",
                    "flex min-h-9 w-full cursor-pointer items-center gap-[7px] rounded-sm px-2 py-1.5 text-left text-xs outline-none focus-visible:bg-accent hover:bg-accent",
                    isSelected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {isSelected ? (
                    <CheckIcon className="size-[13px] shrink-0 text-primary" strokeWidth={1.8} />
                  ) : (
                    <span className="w-[13px] shrink-0" />
                  )}
                  <span className="shrink-0 truncate">{option.primary}</span>
                  {option.secondary && (
                    <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">{option.secondary}</span>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data as T;
}

interface Props {
  /** Session cwd used to discover repositories; null while no session is active. */
  cwd: string | null;
  /** Desktop expanded panel: the diff view renders the file list above the patch. */
  fullWidth?: boolean;
  /** Insert a path into the composer's @ mention list. */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}

/** `/api/git/file` URL for one blob at one revision. */
function commitFileUrl(repo: string, hash: string, filePath: string, download: boolean): string {
  const query = `repo=${encodeURIComponent(repo)}&hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(filePath)}`;
  return `/api/git/file?${query}${download ? "&download=1" : ""}`;
}

/**
 * Read-only multi-repository git history browser.
 * Push navigation: repository select → commit log → commit files → file diff.
 * Only the desktop full-width panel splits the diff view into list-above-diff.
 */
export function GitPanel({ cwd, fullWidth = false, onAtMention }: Props) {
  const { t, locale } = useI18n();
  const narrowMobile = useIsNarrowMobile();

  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [view, setView] = useState<GitView>({ type: "log" });

  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);

  const [files, setFiles] = useState<CommitDetailFile[]>([]);
  const [totals, setTotals] = useState<{ additions: number; deletions: number }>({ additions: 0, deletions: 0 });
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  // Commit hash whose file list is already loaded; shared by the files layer and the split diff view.
  const filesLoadedForRef = useRef<string | null>(null);

  const [patch, setPatch] = useState<string | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);

  const [diffMode, setDiffMode] = useState<DiffLayerMode>("diff");
  const [wrapLines, setWrapLines] = useState(false);
  const [sourceFile, setSourceFile] = useState<SourceFileState | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Bumped by the refresh button so every layer refetches even when its key did not change.
  const [refreshToken, setRefreshToken] = useState(0);

  // Monotonic ids: a slow response from a superseded request must never land.
  const reposRequestRef = useRef(0);
  const logRequestRef = useRef(0);

  const loadRepositories = useCallback(async (refresh = false) => {
    if (!cwd) return;
    const requestId = ++reposRequestRef.current;
    setReposLoading(true);
    setReposError(null);
    try {
      const data = await fetchJson<{ repositories: GitRepository[] }>(
        `/api/git/repos?cwd=${encodeURIComponent(cwd)}${refresh ? "&refresh=1" : ""}`,
      );
      if (requestId !== reposRequestRef.current) return;
      setRepositories(data.repositories);
      setSelectedRepo((current) => {
        if (current && data.repositories.some((repo) => trimTrailingSlash(repo.repositoryRoot) === trimTrailingSlash(current))) {
          return current;
        }
        const cwdRepo = data.repositories.find((repo) => trimTrailingSlash(repo.repositoryRoot) === trimTrailingSlash(cwd));
        return cwdRepo?.repositoryRoot ?? data.repositories[0]?.repositoryRoot ?? null;
      });
    } catch (error) {
      if (requestId !== reposRequestRef.current) return;
      setReposError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === reposRequestRef.current) setReposLoading(false);
    }
  }, [cwd]);

  const refresh = useCallback(() => {
    // A rescan can see commits made since the panel opened, so every layer
    // reloads: the repository list, the log, and the open commit's file list.
    filesLoadedForRef.current = null;
    setRefreshToken((token) => token + 1);
    void loadRepositories(true);
  }, [loadRepositories]);

  useEffect(() => {
    setRepositories([]);
    setSelectedRepo(null);
    setBranches([]);
    setSelectedBranch(null);
    setView({ type: "log" });
    setCommits([]);
    setHasMore(false);
    filesLoadedForRef.current = null;
    void loadRepositories();
  }, [loadRepositories]);

  // Branch list follows the selected repository; the checked-out branch is the default.
  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setSelectedBranch(null);
      return;
    }
    let cancelled = false;
    setBranchesLoading(true);
    fetchJson<RepositoryBranches>(`/api/git/branches?repo=${encodeURIComponent(selectedRepo)}`)
      .then((data) => {
        if (cancelled) return;
        setBranches(data.branches);
        setSelectedBranch(data.current ?? data.branches[0] ?? null);
      })
      .catch(() => {
        // No branch list (e.g. a non-branch checkout): the log falls back to HEAD.
        if (!cancelled) {
          setBranches([]);
          setSelectedBranch(null);
        }
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedRepo]);

  const loadCommits = useCallback(async (repo: string, ref: string, offset: number) => {
    const requestId = ++logRequestRef.current;
    setCommitsLoading(true);
    setCommitsError(null);
    try {
      const data = await fetchJson<{ commits: CommitSummary[]; hasMore: boolean }>(
        `/api/git/log?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&limit=${LOG_PAGE_SIZE}&offset=${offset}`,
      );
      if (requestId !== logRequestRef.current) return;
      setCommits((current) => offset === 0 ? data.commits : [...current, ...data.commits]);
      setHasMore(data.hasMore);
    } catch (error) {
      if (requestId !== logRequestRef.current) return;
      setCommitsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === logRequestRef.current) setCommitsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view.type !== "log" || !selectedRepo || branchesLoading) return;
    setCommits([]);
    setHasMore(false);
    void loadCommits(selectedRepo, selectedBranch ?? "", 0);
  }, [selectedRepo, selectedBranch, branchesLoading, view.type, loadCommits, refreshToken]);

  useEffect(() => {
    if ((view.type !== "detail" && view.type !== "diff") || !selectedRepo) return;
    const { commit } = view;
    if (filesLoadedForRef.current === commit.hash) return;
    filesLoadedForRef.current = commit.hash;
    setFiles([]);
    setTotals({ additions: 0, deletions: 0 });
    setFilesLoading(true);
    setFilesError(null);
    // Landing is keyed on filesLoadedForRef, not a cleanup flag: detail→diff unmounts this
    // effect but the same request still belongs to the visible layer, while a newer commit
    // (ref moved on) discards the stale response.
    fetchJson<{ files: CommitDetailFile[]; totalAdditions: number; totalDeletions: number }>(
      `/api/git/commit?repo=${encodeURIComponent(selectedRepo)}&hash=${encodeURIComponent(commit.hash)}`,
    )
      .then((data) => {
        if (filesLoadedForRef.current !== commit.hash) return;
        setFiles(data.files);
        setTotals({ additions: data.totalAdditions, deletions: data.totalDeletions });
      })
      .catch((error: unknown) => {
        if (filesLoadedForRef.current !== commit.hash) return;
        filesLoadedForRef.current = null;
        setFilesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (filesLoadedForRef.current === commit.hash || filesLoadedForRef.current === null) setFilesLoading(false); });
  }, [view, selectedRepo, refreshToken]);

  useEffect(() => {
    if (view.type !== "diff" || !selectedRepo) return;
    const { commit, file } = view;
    setPatch(null);
    setPatchLoading(true);
    setPatchError(null);
    let cancelled = false;
    fetchJson<{ patch: string }>(
      `/api/git/commit?repo=${encodeURIComponent(selectedRepo)}&hash=${encodeURIComponent(commit.hash)}&path=${encodeURIComponent(file.path)}`,
    )
      .then((data) => { if (!cancelled) setPatch(data.patch); })
      .catch((error: unknown) => { if (!cancelled) setPatchError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setPatchLoading(false); });
    return () => { cancelled = true; };
  }, [view, selectedRepo, refreshToken]);

  // The source tab loads on demand: the diff is what a commit file opens on.
  useEffect(() => {
    if (view.type !== "diff" || !selectedRepo || diffMode !== "source") return;
    const { commit, file } = view;
    setSourceFile(null);
    setSourceLoading(true);
    setSourceError(null);
    let cancelled = false;
    fetchJson<CommitFileContent>(
      commitFileUrl(selectedRepo, commit.hash, file.path, false),
    )
      .then((data) => {
        if (!cancelled) setSourceFile({ ...data, lines: data.content.split("\n").length });
      })
      .catch((error: unknown) => { if (!cancelled) setSourceError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [view, selectedRepo, diffMode, refreshToken]);

  const openCommitFile = (commit: CommitSummary, file: CommitDetailFile) => {
    // Every file opens on its diff; the source tab is a per-file choice.
    setDiffMode("diff");
    setSourceFile(null);
    setView({ type: "diff", commit, file });
  };

  // One step back through the push stack: file view → commit files → log.
  const goBack = () => {
    if (view.type === "diff") setView({ type: "detail", commit: view.commit });
    else if (view.type === "detail") setView({ type: "log" });
  };

  const selectRepository = (repositoryRoot: string) => {
    if (repositoryRoot === selectedRepo) return;
    setSelectedRepo(repositoryRoot);
    setBranches([]);
    setSelectedBranch(null);
    setView({ type: "log" });
  };

  const selectBranch = (branch: string) => {
    if (branch === selectedBranch) return;
    setSelectedBranch(branch);
    setView({ type: "log" });
  };

  const renderError = (message: string, retry: () => void) => (
    <div className="flex flex-col items-start gap-2 p-3">
      <div className="break-words text-xs text-muted-foreground">
        {t("gitPanel.error", { message })}
      </div>
      <Button type="button" variant="outline" size="default" onClick={retry} className={cn("h-auto py-0", buttonClass)}>{t("gitPanel.retry")}</Button>
    </div>
  );

  const renderDetailLayer = (commit: CommitSummary) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="min-w-0 break-words text-xs font-semibold">
          {commit.subject}
        </span>
      </div>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto">
        <div className="flex flex-col gap-[5px] border-b border-border px-3 py-2">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {commit.hash}
          </span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">{commit.author}</span>
            <span title={new Date(commit.timestamp * 1000).toLocaleString()} className="shrink-0">
              {formatRelativeTime(new Date(commit.timestamp * 1000), locale)}
            </span>
            <span className={cn(
              "inline-flex h-4 shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold leading-none",
              commit.pushed ? "text-muted-foreground bg-muted" : "text-warning bg-warning/15",
            )}>
              {t(commit.pushed ? "gitPanel.pushed" : "gitPanel.notPushed")}
            </span>
            {!filesLoading && files.length > 0 && (
              <span className="shrink-0 font-mono">
                {t("gitPanel.filesChanged", { count: files.length })}
                <span className="text-diff-add">{` +${totals.additions}`}</span>
                <span className="text-diff-del">{` −${totals.deletions}`}</span>
              </span>
            )}
          </div>
          {commit.body !== "" && (
            <div className="whitespace-pre-wrap break-words text-xs leading-[1.45] text-muted-foreground">
              {commit.body}
            </div>
          )}
        </div>
        {filesLoading && <div className="p-3 text-xs text-muted-foreground">{t("gitPanel.loading")}</div>}
        {filesError && renderError(filesError, () => setView({ type: "detail", commit }))}
        {!filesError && !filesLoading && files.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">{t("gitPanel.emptyFiles")}</div>
        )}
        {files.map((file) => (
          <Button
            key={`${file.status}:${file.path}`}
            type="button"
            variant="ghost"
            size="default"
            onClick={() => openCommitFile(commit, file)}
            className={cn(
              "h-auto justify-start focus-visible:ring-0 focus-visible:border-transparent",
              "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-foreground outline-none hover:bg-accent/50 focus-visible:bg-accent/50",
            )}
          >
            <span className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-semibold leading-none",
              STATUS_CLASSES[file.status] ?? STATUS_FALLBACK_CLASS,
            )}>
              {file.status}
            </span>
            <PathLabel text={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} className="min-w-0 flex-1 font-mono text-xs" />
            {file.additions !== null && file.deletions !== null && (
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-diff-add">+{file.additions}</span>{" "}
                <span className="text-diff-del">−{file.deletions}</span>
              </span>
            )}
          </Button>
        ))}
      </div>
    </div>
  );

  const renderDiffLayer = (commit: CommitSummary, file: CommitDetailFile) => {
    // A file that does not exist at this revision has no source to show.
    const deleted = file.status === "D";
    const showSource = diffMode === "source" && !deleted;
    const relativePath = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
    const lineCounts = file.additions !== null && file.deletions !== null
      ? ` · +${file.additions} −${file.deletions}`
      : "";
    const meta = showSource && sourceFile
      ? `${sourceFile.language} · ${sourceFile.lines} lines · ${formatFileSize(sourceFile.size)}${sourceFile.truncated ? ` · ${t("gitPanel.truncated")}` : ""}`
      : `${commit.shortHash}${lineCounts}`;
    const mentionPath = getRelativeFilePath(
      selectedRepo ? joinFilePath(selectedRepo, file.path) : file.path,
      cwd ?? undefined,
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <FileToolbar
          pathLabel={relativePath}
          meta={meta}
          modes={(deleted ? ["diff"] : ["source", "diff"]).map((mode) => ({
            mode: mode as DiffLayerMode,
            label: FILE_MODE_LABELS[mode],
            title: mode === "diff" ? t("gitPanel.compareCommit") : undefined,
          }))}
          activeMode={showSource ? "source" : "diff"}
          onSelectMode={setDiffMode}
          actions={onAtMention && !deleted
            ? <FileMentionButton onClick={() => onAtMention(mentionPath, false)} title={t("files.insertPath")} />
            : undefined}
          wrapLines={wrapLines}
          onToggleWrapLines={() => setWrapLines((current) => !current)}
          download={deleted || !selectedRepo ? undefined : (
            <Button asChild variant="outline" size="icon-xs" title={t("i18n.downloadFile")} aria-label={t("i18n.downloadFile")}>
              <a href={commitFileUrl(selectedRepo, commit.hash, file.path, true)}>
                <ArrowDownToLineIcon className="size-[14px]" strokeWidth={1.8} />
              </a>
            </Button>
          )}
        />
        <div className="min-h-0 flex-1 overflow-auto bg-background">
          {showSource ? (
            <>
              {sourceLoading && <div className="p-3 text-xs text-muted-foreground">{t("gitPanel.loading")}</div>}
              {sourceError && renderError(sourceError, () => setView({ type: "diff", commit, file }))}
              {!sourceError && !sourceLoading && sourceFile && (
                <SourceCodeView content={sourceFile.content} language={sourceFile.language} wrapLines={wrapLines} />
              )}
            </>
          ) : (
            <>
              {patchLoading && <div className="p-3 text-xs text-muted-foreground">{t("gitPanel.loading")}</div>}
              {patchError && renderError(patchError, () => setView({ type: "diff", commit, file }))}
              {!patchError && !patchLoading && patch !== null && <DiffView patch={patch} wrapLines={wrapLines} />}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      data-gitpanel-view={view.type}
      data-gitpanel-narrow={narrowMobile ? "true" : "false"}
      className="flex h-full flex-col overflow-hidden text-foreground"
    >
      {/* The row that never scrolls away owns the one back affordance. */}
      <div
        data-gitpanel-toolbar
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2"
      >
        {view.type !== "log" && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goBack}
            title={t("gitPanel.back")}
            aria-label={t("gitPanel.back")}
            className={cn(buttonClass, "w-9 p-0")}
          >
            <ChevronLeftIcon className="size-[14px]" strokeWidth={1.8} />
          </Button>
        )}
        <GitDropdown
          className={NARROW_FULL_ROW}
          value={selectedRepo}
          disabled={repositories.length === 0}
          ariaLabel={t("gitPanel.selectRepository")}
          placeholder={reposLoading ? t("gitPanel.loading") : t("gitPanel.noRepositories")}
          icon={<FolderIcon className="size-[13px]" strokeWidth={1.8} />}
          options={repositories.map((repo) => ({
            value: repo.repositoryRoot,
            primary: repo.name,
            secondary: repo.relativePath === "." || repo.relativePath === "" ? undefined : repo.relativePath,
          }))}
          onSelect={selectRepository}
        />
        <div className={cn("flex min-w-0 flex-1 items-center gap-2", NARROW_FULL_ROW)}>
          <GitDropdown
            value={selectedBranch}
            disabled={branches.length === 0}
            ariaLabel={t("gitPanel.selectBranch")}
            placeholder={t("gitPanel.branch")}
            icon={<GitBranchIcon className="size-[13px]" strokeWidth={1.8} />}
            options={branches.map((branch) => ({ value: branch, primary: branch }))}
            onSelect={selectBranch}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={reposLoading}
            title={t("gitPanel.refresh")}
            aria-label={t("gitPanel.refresh")}
            className={cn(buttonClass, "w-9 p-0")}
          >
            <RotateCwIcon className="size-[14px]" strokeWidth={1.8} />
          </Button>
        </div>
      </div>

      {reposError && renderError(reposError, refresh)}

      {/* Log layer */}
      {view.type === "log" && selectedRepo && (
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto">
          {reposLoading && repositories.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">{t("gitPanel.loading")}</div>
          )}
          {commitsError && renderError(commitsError, () => { void loadCommits(selectedRepo, selectedBranch ?? "", 0); })}
          {!commitsError && !commitsLoading && commits.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">{t("gitPanel.emptyLog")}</div>
          )}
          {commits.map((commit, index) => (
            <Button
              key={commit.hash}
              type="button"
              variant="ghost"
              size="default"
              onClick={() => setView({ type: "detail", commit })}
              className={cn(
                "h-auto focus-visible:ring-0 focus-visible:border-transparent",
                "block min-h-9 w-full cursor-pointer rounded-lg px-2.5 py-[7px] text-left text-foreground outline-none hover:bg-accent/50 focus-visible:bg-accent/50",
              )}
            >
              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold">
                <span className="min-w-0 flex-1 truncate">
                  {commit.subject}
                </span>
                {(index === 0 || commits[index - 1].pushed !== commit.pushed) && (
                  <span className={cn(
                    "inline-flex h-4 shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold leading-none",
                    commit.pushed ? "text-muted-foreground bg-muted" : "text-warning bg-warning/15",
                  )}>
                    {t(commit.pushed ? "gitPanel.pushed" : "gitPanel.notPushed")}
                  </span>
                )}
              </div>
              <div className="mt-[3px] flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className="shrink-0 font-mono">{commit.shortHash}</span>
                <span className="min-w-0 flex-1 truncate">{commit.author}</span>
                <span className="shrink-0">{formatRelativeTime(new Date(commit.timestamp * 1000), locale)}</span>
              </div>
            </Button>
          ))}
          {hasMore && (
            <div className="p-2">
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => { void loadCommits(selectedRepo, selectedBranch ?? "", commits.length); }}
                disabled={commitsLoading}
                className={cn("h-auto py-0", buttonClass, "w-full")}
              >
                {commitsLoading ? t("gitPanel.loading") : t("gitPanel.loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Detail layer: full commit info + changed files with line counts */}
      {view.type === "detail" && renderDetailLayer(view.commit)}

      {/* Diff layer: desktop full-width splits list above patch, otherwise single column */}
      {view.type === "diff" && fullWidth && (
        <div data-gitpanel-split className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border">
            {renderDetailLayer(view.commit)}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderDiffLayer(view.commit, view.file)}
          </div>
        </div>
      )}
      {view.type === "diff" && !fullWidth && renderDiffLayer(view.commit, view.file)}
    </div>
  );
}
