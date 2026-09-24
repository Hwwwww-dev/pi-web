import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/file-types";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

export const DEFAULT_LOG_LIMIT = 20;
export const MAX_LOG_LIMIT = 100;

export interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  /** Commit time as a UNIX timestamp (seconds). */
  timestamp: number;
  subject: string;
  /** Commit message body (everything after the subject line), trimmed; empty when absent. */
  body: string;
  /** True when the commit is reachable from at least one remote branch. */
  pushed: boolean;
}

export interface CommitLogPage {
  commits: CommitSummary[];
  hasMore: boolean;
}

export interface BranchList {
  branches: string[];
  /** The checked-out branch; null on a detached HEAD. */
  current: string | null;
}

export interface CommitFileChange {
  path: string;
  /** First status letter from `git show --name-status` (A/M/D/R/C/T…). */
  status: string;
  /** Original path for renames and copies. */
  previousPath?: string;
}

export function isValidCommitHash(hash: string): boolean {
  return HASH_PATTERN.test(hash);
}

/** The requested file path must stay inside the repository. */
export function isSafeCommitFilePath(repoRoot: string, relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\0")) return false;
  const rel = path.relative(repoRoot, path.resolve(repoRoot, relativePath));
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

export function parseLogLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LOG_LIMIT;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MAX_LOG_LIMIT ? value : null;
}

export function parseLogOffset(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A `git log` ref from the query string: empty string means HEAD, null means
 * rejected. Only plain branch-shaped names pass — no option injection (`-`),
 * no range separators (`..`), no `.lock` suffix.
 */
export function parseLogRef(raw: string | null): string | null {
  if (raw === null || raw === "") return "";
  if (raw.length > 200) return null;
  return /^[A-Za-z0-9._][A-Za-z0-9./_-]*$/.test(raw) && !raw.includes("..") && !raw.endsWith(".lock") ? raw : null;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

export function isEmptyRepositoryError(error: unknown): boolean {
  return error instanceof Error && /does not have any commits yet/.test(error.message);
}

export async function readCommitLog(repoRoot: string, limit: number, offset: number, ref = ""): Promise<CommitLogPage> {
  let stdout: string;
  try {
    stdout = await git(repoRoot, [
      "log",
      ...(ref ? [ref] : []),
      "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%b%x1e",
      `--max-count=${limit + 1}`,
      `--skip=${offset}`,
    ]);
  } catch (error) {
    if (isEmptyRepositoryError(error)) return { commits: [], hasMore: false };
    throw error;
  }
  const records = stdout.split("\x1e").filter((record) => record.trim() !== "");
  const commits = records.map((record) => {
    const [hash, shortHash, author, timestamp, subject, body] = record.trim().split("\x1f");
    return { hash, shortHash, author, timestamp: Number(timestamp), subject, body: (body ?? "").trim() };
  });
  const hasMore = commits.length > limit;
  const page = hasMore ? commits.slice(0, limit) : commits;
  const pushed = await computeRemoteStatus(repoRoot, page.map((commit) => commit.hash));
  return { commits: page.map((commit, index) => ({ ...commit, pushed: pushed[index] })), hasMore };
}

/** Whether each commit is reachable from any remote branch. */
async function computeRemoteStatus(repoRoot: string, hashes: string[]): Promise<boolean[]> {
  if (hashes.length === 0) return [];
  try {
    // Fast path: one rev-list over all remote tips yields the exact pushed set
    // (a page of commits would otherwise cost one `branch -r --contains` per hash).
    const tipsOut = await git(repoRoot, ["for-each-ref", "refs/remotes", "--format=%(objectname)"]);
    const tips = [...new Set(tipsOut.split("\n").map((line) => line.trim()).filter((line) => /^[0-9a-f]{40}$/.test(line)))];
    if (tips.length === 0) return hashes.map(() => false);
    const walk = await git(repoRoot, ["rev-list", ...tips]);
    const reachable = new Set(walk.split("\n").map((line) => line.trim()));
    return hashes.map((hash) => reachable.has(hash));
  } catch {
    // Fallback (e.g. rev-list output beyond maxBuffer on huge repos): exact per-commit check.
    return Promise.all(hashes.map(async (hash) => {
      try {
        const out = await git(repoRoot, ["branch", "-r", "--contains", hash]);
        return out.trim() !== "";
      } catch {
        return false;
      }
    }));
  }
}

/** Local branches of the repository plus the currently checked-out one. */
export async function readBranches(repoRoot: string): Promise<BranchList> {
  const [heads, current] = await Promise.all([
    git(repoRoot, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]),
    git(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
  ]);
  const branches = heads.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const checkedOut = current.trim();
  return { branches, current: checkedOut !== "" ? checkedOut : null };
}

export async function readCommitFiles(repoRoot: string, hash: string): Promise<CommitFileChange[]> {
  const stdout = await git(repoRoot, ["show", hash, "--format=", "--name-status", "-z", "--no-color"]);
  const parts = stdout.split("\0");
  const files: CommitFileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    // Rename/copy statuses carry a similarity score ("R100"); keep the letter.
    const code = status[0].toUpperCase();
    const usesRenamePath = code === "R" || code === "C";
    // `-z` lists the OLD path first, then the new one.
    const firstPath = parts[++i];
    if (!firstPath) break;
    if (usesRenamePath) {
      const newPath = parts[++i] || "";
      files.push({ path: newPath, status: code, previousPath: firstPath });
    } else {
      files.push({ path: firstPath, status: code });
    }
  }
  return files;
}

export interface CommitDetailFile extends CommitFileChange {
  /** Added lines; null for binary files. */
  additions: number | null;
  /** Deleted lines; null for binary files. */
  deletions: number | null;
}

export interface CommitDetail {
  files: CommitDetailFile[];
  totalAdditions: number;
  totalDeletions: number;
}

/** One commit's changed files with per-file and total line counts. */
export async function readCommitDetail(repoRoot: string, hash: string): Promise<CommitDetail> {
  const [files, numstat] = await Promise.all([
    readCommitFiles(repoRoot, hash),
    git(repoRoot, ["show", hash, "--format=", "--numstat", "-z", "--no-color"]),
  ]);
  const records = numstat.split("\0");
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let i = 0; i < records.length; i++) {
    const match = records[i].match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
    if (!match) continue;
    let dest = match[3];
    if (dest === "") {
      // Rename/copy record: `counts\t\0old\0new\0` — the new path is the second next field.
      dest = records[i + 2] ?? "";
      i += 2;
    }
    if (dest === "") continue;
    counts.set(dest, {
      additions: match[1] === "-" ? null : Number(match[1]),
      deletions: match[2] === "-" ? null : Number(match[2]),
    });
  }
  const detailFiles: CommitDetailFile[] = files.map((file) => ({
    ...file,
    additions: counts.get(file.path)?.additions ?? null,
    deletions: counts.get(file.path)?.deletions ?? null,
  }));
  return {
    files: detailFiles,
    totalAdditions: detailFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    totalDeletions: detailFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
  };
}

/** The unified diff of one file within a commit, or null when unchanged there. */
export async function readCommitFilePatch(repoRoot: string, hash: string, filePath: string): Promise<string | null> {
  const stdout = await git(repoRoot, [
    "show", hash,
    "--format=",
    "--no-color",
    "--no-ext-diff",
    "--unified=3",
    "--",
    filePath,
  ]);
  return stdout.trim() === "" ? null : stdout;
}

function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "buffer",
      env: { ...process.env, LC_ALL: "C" },
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** The revision has no such path (as opposed to git itself failing). */
export class CommitFileMissingError extends Error {}

/**
 * The body of one file at one revision, as raw bytes. The caller decodes text
 * itself so the same blob can also be downloaded verbatim; keeping bytes here
 * is what makes binary files work at all.
 */
export async function readCommitFileBytes(repoRoot: string, hash: string, filePath: string): Promise<Buffer> {
  try {
    return await gitBytes(repoRoot, ["show", `${hash}:${filePath}`]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // git prints `fatal: path 'x' does not exist in 'abc'` for a blob that is
    // absent at that revision, and `exists on disk, but not in 'abc'` when the
    // path is in the worktree but not in that tree. Any other failure (timeout,
    // maxBuffer) is real.
    if (/does not exist in|exists on disk, but not in|invalid object name|unknown revision|bad revision|bad object/i.test(message)) {
      throw new CommitFileMissingError(message);
    }
    throw error;
  }
}

/**
 * Decode a blob for the source viewer the same way the file API chunks text:
 * bounded to the first text-preview bytes and cut back to a line boundary.
 * Returns null for binary blobs, which have no meaningful source view.
 */
export function decodeCommitFileText(bytes: Buffer): { content: string; truncated: boolean } | null {
  if (bytes.includes(0)) return null;
  if (bytes.length <= TEXT_PREVIEW_MAX_BYTES) return { content: bytes.toString("utf8"), truncated: false };

  const head = bytes.subarray(0, TEXT_PREVIEW_MAX_BYTES).toString("utf8");
  // Dropping the partial trailing line also drops any half-decoded code point
  // the byte boundary left behind.
  const lastNewline = head.lastIndexOf("\n");
  return { content: lastNewline >= 0 ? head.slice(0, lastNewline + 1) : head, truncated: true };
}
