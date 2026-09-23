import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

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
}

export interface CommitLogPage {
  commits: CommitSummary[];
  hasMore: boolean;
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

export async function readCommitLog(repoRoot: string, limit: number, offset: number): Promise<CommitLogPage> {
  let stdout: string;
  try {
    stdout = await git(repoRoot, [
      "log",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e",
      `--max-count=${limit + 1}`,
      `--skip=${offset}`,
    ]);
  } catch (error) {
    if (isEmptyRepositoryError(error)) return { commits: [], hasMore: false };
    throw error;
  }
  const records = stdout.split("\x1e").filter((record) => record.trim() !== "");
  const commits = records.map((record) => {
    const [hash, shortHash, author, timestamp, subject] = record.trim().split("\x1f");
    return { hash, shortHash, author, timestamp: Number(timestamp), subject };
  });
  const hasMore = commits.length > limit;
  return { commits: hasMore ? commits.slice(0, limit) : commits, hasMore };
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
