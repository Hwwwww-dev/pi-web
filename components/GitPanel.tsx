"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsNarrowMobile } from "@/hooks/useIsMobile";
import { formatRelativeTime } from "@/lib/i18n/format";

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
}

/** One row of `GET /api/git/commit` (without `path`). */
interface CommitFileChange {
  path: string;
  status: string;
  previousPath?: string;
}

type GitView =
  | { type: "log" }
  | { type: "files"; commit: CommitSummary }
  | { type: "diff"; commit: CommitSummary; file: CommitFileChange };

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
}

/**
 * Read-only multi-repository git history browser.
 * Push navigation: repository select → commit log → commit files → file diff.
 * Only the desktop full-width panel splits the diff view into list-above-diff.
 */
export function GitPanel({ cwd, fullWidth = false }: Props) {
  const { t, locale } = useI18n();
  const narrowMobile = useIsNarrowMobile();

  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [view, setView] = useState<GitView>({ type: "log" });

  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);

  const [files, setFiles] = useState<CommitFileChange[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  // Commit hash whose file list is already loaded; shared by the files layer and the split diff view.
  const filesLoadedForRef = useRef<string | null>(null);

  const [patch, setPatch] = useState<string | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);

  const loadRepositories = useCallback(async (refresh = false) => {
    if (!cwd) return;
    setReposLoading(true);
    setReposError(null);
    try {
      const data = await fetchJson<{ repositories: GitRepository[] }>(
        `/api/git/repos?cwd=${encodeURIComponent(cwd)}${refresh ? "&refresh=1" : ""}`,
      );
      setRepositories(data.repositories);
      setSelectedRepo((current) => {
        if (current && data.repositories.some((repo) => trimTrailingSlash(repo.repositoryRoot) === trimTrailingSlash(current))) {
          return current;
        }
        const cwdRepo = data.repositories.find((repo) => trimTrailingSlash(repo.repositoryRoot) === trimTrailingSlash(cwd));
        return cwdRepo?.repositoryRoot ?? data.repositories[0]?.repositoryRoot ?? null;
      });
    } catch (error) {
      setReposError(error instanceof Error ? error.message : String(error));
    } finally {
      setReposLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setRepositories([]);
    setSelectedRepo(null);
    setView({ type: "log" });
    setCommits([]);
    setHasMore(false);
    filesLoadedForRef.current = null;
    void loadRepositories();
  }, [loadRepositories]);

  const loadCommits = useCallback(async (repo: string, offset: number) => {
    setCommitsLoading(true);
    setCommitsError(null);
    try {
      const data = await fetchJson<{ commits: CommitSummary[]; hasMore: boolean }>(
        `/api/git/log?repo=${encodeURIComponent(repo)}&limit=${LOG_PAGE_SIZE}&offset=${offset}`,
      );
      setCommits((current) => offset === 0 ? data.commits : [...current, ...data.commits]);
      setHasMore(data.hasMore);
    } catch (error) {
      setCommitsError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view.type !== "log" || !selectedRepo) return;
    setCommits([]);
    setHasMore(false);
    void loadCommits(selectedRepo, 0);
  }, [selectedRepo, view.type, loadCommits]);

  useEffect(() => {
    if ((view.type !== "files" && view.type !== "diff") || !selectedRepo) return;
    const { commit } = view;
    if (filesLoadedForRef.current === commit.hash) return;
    filesLoadedForRef.current = commit.hash;
    setFiles([]);
    setFilesLoading(true);
    setFilesError(null);
    let cancelled = false;
    fetchJson<{ files: CommitFileChange[] }>(
      `/api/git/commit?repo=${encodeURIComponent(selectedRepo)}&hash=${encodeURIComponent(commit.hash)}`,
    )
      .then((data) => { if (!cancelled) setFiles(data.files); })
      .catch((error: unknown) => {
        if (!cancelled) {
          filesLoadedForRef.current = null;
          setFilesError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [view, selectedRepo]);

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
  }, [view, selectedRepo]);

  const selectRepository = (repositoryRoot: string) => {
    if (repositoryRoot === selectedRepo) return;
    setSelectedRepo(repositoryRoot);
    setView({ type: "log" });
  };

  const buttonStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    minHeight: CONTROL_MIN_HEIGHT,
    padding: "0 10px",
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

  const renderFilesLayer = (commit: CommitSummary) => (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button type="button" onClick={() => setView({ type: "log" })} style={buttonStyle}>
          ‹ {t("gitPanel.back")}
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {commit.shortHash}
        </span>
        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {commit.subject}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {filesLoading && <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>}
        {filesError && renderError(filesError, () => setView({ type: "files", commit }))}
        {!filesError && !filesLoading && files.length === 0 && (
          <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.emptyFiles")}</div>
        )}
        {files.map((file) => (
          <button
            key={`${file.status}:${file.path}`}
            type="button"
            onClick={() => setView({ type: "diff", commit, file })}
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
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderDiffLayer = (commit: CommitSummary, file: CommitFileChange) => (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button type="button" onClick={() => setView({ type: "files", commit })} style={{ ...buttonStyle, flexShrink: 0 }}>
          ‹ {t("gitPanel.back")}
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
          {commit.shortHash}
        </span>
        <span data-gitpanel-diff-path style={{ fontSize: 12, fontFamily: "var(--font-mono)", wordBreak: "break-all", minWidth: 0 }}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {patchLoading && <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>}
        {patchError && renderError(patchError, () => setView({ type: "diff", commit, file }))}
        {!patchError && !patchLoading && patch !== null && (
          <pre
            data-gitpanel-diff
            style={{
              margin: 0, padding: 8,
              fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.5,
              whiteSpace: "pre", overflowX: "auto",
              color: "var(--text-muted)",
            }}
          >
            {patch}
          </pre>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-gitpanel-view={view.type}
      data-gitpanel-narrow={narrowMobile ? "true" : "false"}
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)" }}
    >
      {/* Toolbar: repository select + rescan */}
      <div
        data-gitpanel-toolbar
        style={{
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
          flexShrink: 0, padding: 8, borderBottom: "1px solid var(--border)",
        }}
      >
        <select
          value={selectedRepo ?? ""}
          onChange={(event) => selectRepository(event.target.value)}
          aria-label={t("gitPanel.selectRepository")}
          disabled={repositories.length === 0}
          style={{
            flex: narrowMobile ? "1 1 100%" : 1,
            minWidth: 0,
            minHeight: CONTROL_MIN_HEIGHT,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 12,
            padding: "0 8px",
          }}
        >
          {repositories.length === 0 && <option value="">{t("gitPanel.noRepositories")}</option>}
          {repositories.map((repo) => (
            <option key={repo.repositoryRoot} value={repo.repositoryRoot}>
              {repo.relativePath === "." || repo.relativePath === ""
                ? `${repo.name} (${repo.branch})`
                : `${repo.name} (${repo.relativePath} · ${repo.branch})`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => { void loadRepositories(true); }}
          disabled={reposLoading}
          title={t("gitPanel.refresh")}
          aria-label={t("gitPanel.refresh")}
          style={{ ...buttonStyle, flexShrink: 0, width: narrowMobile ? undefined : 36, padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      </div>

      {reposError && renderError(reposError, () => { void loadRepositories(true); })}

      {/* Log layer */}
      {view.type === "log" && selectedRepo && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {reposLoading && repositories.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.loading")}</div>
          )}
          {commitsError && renderError(commitsError, () => { void loadCommits(selectedRepo, 0); })}
          {!commitsError && !commitsLoading && commits.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>{t("gitPanel.emptyLog")}</div>
          )}
          {commits.map((commit) => (
            <button
              key={commit.hash}
              type="button"
              onClick={() => setView({ type: "files", commit })}
              style={{
                display: "block", width: "100%", textAlign: "left",
                minHeight: LIST_ROW_MIN_HEIGHT,
                padding: "6px 12px",
                background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
                  {commit.shortHash}
                </span>
                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {commit.subject}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                {commit.author} · {formatRelativeTime(new Date(commit.timestamp * 1000), locale)}
              </div>
            </button>
          ))}
          {hasMore && (
            <div style={{ padding: 8 }}>
              <button
                type="button"
                onClick={() => { void loadCommits(selectedRepo, commits.length); }}
                disabled={commitsLoading}
                style={{ ...buttonStyle, width: "100%" }}
              >
                {commitsLoading ? t("gitPanel.loading") : t("gitPanel.loadMore")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Files layer */}
      {view.type === "files" && renderFilesLayer(view.commit)}

      {/* Diff layer: desktop full-width splits list above patch, otherwise single column */}
      {view.type === "diff" && fullWidth && (
        <div data-gitpanel-split style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderBottom: "1px solid var(--border)" }}>
            {renderFilesLayer(view.commit)}
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
