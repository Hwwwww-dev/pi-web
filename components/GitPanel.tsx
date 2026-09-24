"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsNarrowMobile } from "@/hooks/useIsMobile";
import { formatFileSize } from "@/lib/file-types";
import { formatRelativeTime } from "@/lib/i18n/format";
import { getRelativeFilePath, joinFilePath } from "@/lib/file-paths";
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

const STATUS_COLORS: Record<string, string> = {
  A: "#4caf50",
  M: "#e2b93d",
  D: "#e06c60",
  R: "#61afef",
  C: "#61afef",
  T: "#e2b93d",
};

const LIST_ROW_MIN_HEIGHT = 36;
const CONTROL_MIN_HEIGHT = 36;

interface DropdownOption {
  value: string;
  primary: string;
  secondary?: string;
}

/** Custom dropdown (no native select), modeled after the sidebar branch switcher. */
function GitDropdown({ value, options, onSelect, ariaLabel, placeholder, icon, stretch, disabled = false }: {
  value: string | null;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  icon: React.ReactNode;
  stretch: boolean;
  disabled?: boolean;
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
    <div ref={rootRef} style={{ position: "relative", flex: stretch ? "1 1 100%" : 1, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: "100%", minHeight: CONTROL_MIN_HEIGHT,
          display: "flex", alignItems: "center", gap: 6, padding: "0 10px",
          background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6,
          color: "var(--text)", fontSize: 12, cursor: disabled ? "default" : "pointer", textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0, color: "var(--text-dim)" }} aria-hidden="true">{icon}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.primary : placeholder}
        </span>
        {selected?.secondary && (
          <span style={{
            flexShrink: 0, maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)",
          }}>{selected.secondary}</span>
        )}
        <svg
          width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.10)", overflow: "hidden",
          }}
        >
          <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto", touchAction: "pan-y" }}>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => { setOpen(false); onSelect(option.value); }}
                  style={{
                    display: "flex", width: "100%", alignItems: "center", gap: 7,
                    minHeight: LIST_ROW_MIN_HEIGHT, padding: "6px 10px",
                    background: "var(--bg)", border: "none", borderBottom: "1px solid var(--border)",
                    color: isSelected ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer", textAlign: "left", fontSize: 12,
                  }}
                >
                  {isSelected ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  ) : (
                    <span style={{ width: 10, flexShrink: 0 }} />
                  )}
                  <span style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.primary}</span>
                  {option.secondary && (
                    <span style={{
                      flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "right",
                    }}>{option.secondary}</span>
                  )}
                </button>
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

  const buttonStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    minHeight: CONTROL_MIN_HEIGHT,
    padding: "0 10px",
    flexShrink: 0,
    whiteSpace: "nowrap",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text-muted)",
    fontSize: 12,
    cursor: "pointer",
  };

  const renderError = (message: string, retry: () => void) => (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <div style={{ color: "var(--text-muted)", fontSize: 12, wordBreak: "break-word" }}>
        {t("gitPanel.error", { message })}
      </div>
      <button type="button" onClick={retry} style={buttonStyle}>{t("gitPanel.retry")}</button>
    </div>
  );

  const renderDetailLayer = (commit: CommitSummary) => (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 0, wordBreak: "break-word" }}>
          {commit.subject}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", touchAction: "pan-y" }}>
        <div style={{
          padding: "8px 12px", borderBottom: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 5,
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", wordBreak: "break-all" }}>
            {commit.hash}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 8px", fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{commit.author}</span>
            <span title={new Date(commit.timestamp * 1000).toLocaleString()} style={{ flexShrink: 0 }}>
              {formatRelativeTime(new Date(commit.timestamp * 1000), locale)}
            </span>
            <span style={{
              flexShrink: 0, fontSize: 10, padding: "1px 6px", borderRadius: 8,
              border: `1px solid ${commit.pushed ? "var(--border)" : "#e2b93d"}`,
              color: commit.pushed ? "var(--text-dim)" : "#e2b93d",
            }}>
              {t(commit.pushed ? "gitPanel.pushed" : "gitPanel.notPushed")}
            </span>
            {!filesLoading && files.length > 0 && (
              <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)" }}>
                {t("gitPanel.filesChanged", { count: files.length })}
                <span style={{ color: "var(--diff-add)" }}>{` +${totals.additions}`}</span>
                <span style={{ color: "var(--diff-del)" }}>{` −${totals.deletions}`}</span>
              </span>
            )}
          </div>
          {commit.body !== "" && (
            <div style={{
              fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {commit.body}
            </div>
          )}
        </div>
        {filesLoading && <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>}
        {filesError && renderError(filesError, () => setView({ type: "detail", commit }))}
        {!filesError && !filesLoading && files.length === 0 && (
          <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.emptyFiles")}</div>
        )}
        {files.map((file) => (
          <button
            key={`${file.status}:${file.path}`}
            type="button"
            onClick={() => openCommitFile(commit, file)}
            style={{
              display: "flex", width: "100%", alignItems: "center", gap: 8, textAlign: "left",
              minHeight: LIST_ROW_MIN_HEIGHT,
              padding: "6px 12px",
              background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, flexShrink: 0,
              width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 4,
              color: STATUS_COLORS[file.status] ?? "var(--text-muted)",
              border: `1px solid ${STATUS_COLORS[file.status] ?? "var(--border)"}`,
            }}>
              {file.status}
            </span>
            <PathLabel text={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "var(--font-mono)" }} />
            {file.additions !== null && file.deletions !== null && (
              <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "var(--diff-add)" }}>+{file.additions}</span>{" "}
                <span style={{ color: "var(--diff-del)" }}>−{file.deletions}</span>
              </span>
            )}
          </button>
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
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
            <a
              href={commitFileUrl(selectedRepo, commit.hash, file.path, true)}
              title={t("i18n.downloadFile")}
              aria-label={t("i18n.downloadFile")}
              className="file-viewer-icon-button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
              </svg>
            </a>
          )}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
          {showSource ? (
            <>
              {sourceLoading && <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>}
              {sourceError && renderError(sourceError, () => setView({ type: "diff", commit, file }))}
              {!sourceError && !sourceLoading && sourceFile && (
                <SourceCodeView content={sourceFile.content} language={sourceFile.language} wrapLines={wrapLines} />
              )}
            </>
          ) : (
            <>
              {patchLoading && <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>}
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
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)" }}
    >
      {/* The row that never scrolls away owns the one back affordance. */}
      <div
        data-gitpanel-toolbar
        style={{
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
          flexShrink: 0, padding: 8, borderBottom: "1px solid var(--border)",
        }}
      >
        {view.type !== "log" && (
          <button
            type="button"
            onClick={goBack}
            title={t("gitPanel.back")}
            aria-label={t("gitPanel.back")}
            style={{ ...buttonStyle, width: CONTROL_MIN_HEIGHT, padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        <GitDropdown
          stretch={narrowMobile}
          value={selectedRepo}
          disabled={repositories.length === 0}
          ariaLabel={t("gitPanel.selectRepository")}
          placeholder={reposLoading ? t("gitPanel.loading") : t("gitPanel.noRepositories")}
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          }
          options={repositories.map((repo) => ({
            value: repo.repositoryRoot,
            primary: repo.name,
            secondary: repo.relativePath === "." || repo.relativePath === "" ? undefined : repo.relativePath,
          }))}
          onSelect={selectRepository}
        />
        <div style={{ display: "flex", flex: narrowMobile ? "1 1 100%" : 1, minWidth: 0, gap: 8, alignItems: "center" }}>
          <GitDropdown
            stretch={false}
            value={selectedBranch}
          disabled={branches.length === 0}
          ariaLabel={t("gitPanel.selectBranch")}
          placeholder={t("gitPanel.branch")}
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          }
          options={branches.map((branch) => ({ value: branch, primary: branch }))}
          onSelect={selectBranch}
          />
          <button
            type="button"
            onClick={refresh}
            disabled={reposLoading}
            title={t("gitPanel.refresh")}
            aria-label={t("gitPanel.refresh")}
            style={{ ...buttonStyle, flexShrink: 0, width: 36, padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
        </div>
      </div>

      {reposError && renderError(reposError, refresh)}

      {/* Log layer */}
      {view.type === "log" && selectedRepo && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", touchAction: "pan-y" }}>
          {reposLoading && repositories.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>
          )}
          {commitsError && renderError(commitsError, () => { void loadCommits(selectedRepo, selectedBranch ?? "", 0); })}
          {!commitsError && !commitsLoading && commits.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.emptyLog")}</div>
          )}
          {commits.map((commit, index) => (
            <button
              key={commit.hash}
              type="button"
              onClick={() => setView({ type: "detail", commit })}
              style={{
                display: "block", width: "100%", textAlign: "left",
                minHeight: LIST_ROW_MIN_HEIGHT,
                padding: "7px 12px",
                background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 12, fontWeight: 600, minWidth: 0,
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {commit.subject}
                </span>
                {(index === 0 || commits[index - 1].pushed !== commit.pushed) && (
                  <span style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 400, padding: "0 6px", borderRadius: 8,
                    border: `1px solid ${commit.pushed ? "var(--border)" : "#e2b93d"}`,
                    color: commit.pushed ? "var(--text-dim)" : "#e2b93d",
                  }}>
                    {t(commit.pushed ? "gitPanel.pushed" : "gitPanel.notPushed")}
                  </span>
                )}
              </div>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 6,
                marginTop: 3, fontSize: 11, color: "var(--text-dim)", minWidth: 0,
              }}>
                <span style={{ fontFamily: "var(--font-mono)", flexShrink: 0 }}>{commit.shortHash}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{commit.author}</span>
                <span style={{ flexShrink: 0 }}>{formatRelativeTime(new Date(commit.timestamp * 1000), locale)}</span>
              </div>
            </button>
          ))}
          {hasMore && (
            <div style={{ padding: 8 }}>
              <button
                type="button"
                onClick={() => { void loadCommits(selectedRepo, selectedBranch ?? "", commits.length); }}
                disabled={commitsLoading}
                style={{ ...buttonStyle, width: "100%" }}
              >
                {commitsLoading ? t("gitPanel.loading") : t("gitPanel.loadMore")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detail layer: full commit info + changed files with line counts */}
      {view.type === "detail" && renderDetailLayer(view.commit)}

      {/* Diff layer: desktop full-width splits list above patch, otherwise single column */}
      {view.type === "diff" && fullWidth && (
        <div data-gitpanel-split style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderBottom: "1px solid var(--border)" }}>
            {renderDetailLayer(view.commit)}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {renderDiffLayer(view.commit, view.file)}
          </div>
        </div>
      )}
      {view.type === "diff" && !fullWidth && renderDiffLayer(view.commit, view.file)}
    </div>
  );
}
