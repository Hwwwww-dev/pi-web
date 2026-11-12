import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
/** From the session cwd, repositories are discovered at most this many levels down. */
const SCAN_MAX_DEPTH = 3;
/** Hard cap on visited directories so a huge workspace cannot stall the scan. */
const SCAN_MAX_DIRECTORIES = 2000;
const DISCOVERY_CACHE_TTL_MS = 60_000;

// Same skip-list semantics as the file index: hidden directories and the
// common heavy build/dependency directories are never descended into.
const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".venv", "venv", ".gradle", ".idea",
]);

export interface DiscoveredRepository {
  repositoryRoot: string;
  /** Basename of the repository root directory. */
  name: string;
  /** Slash-separated path relative to the scanned cwd ("" for the cwd itself). */
  relativePath: string;
  branch: string | null;
}

export interface DiscoveryResult {
  repositories: DiscoveredRepository[];
  /** True when the directory cap stopped the scan before it finished. */
  truncated: boolean;
}

declare global {
  var __piRepoDiscoveryCache: Map<string, { result: DiscoveryResult; expiresAt: number }> | undefined;
  var __piRepoDiscoveryInflight: Map<string, Promise<DiscoveryResult>> | undefined;
}

function getDiscoveryCache(): Map<string, { result: DiscoveryResult; expiresAt: number }> {
  if (!globalThis.__piRepoDiscoveryCache) globalThis.__piRepoDiscoveryCache = new Map();
  return globalThis.__piRepoDiscoveryCache;
}

function getDiscoveryInflight(): Map<string, Promise<DiscoveryResult>> {
  if (!globalThis.__piRepoDiscoveryInflight) globalThis.__piRepoDiscoveryInflight = new Map();
  return globalThis.__piRepoDiscoveryInflight;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readBranch(repositoryRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C" },
    });
    const ref = stdout.trim();
    // Detached HEAD has no branch name worth showing.
    return ref && ref !== "HEAD" ? ref : null;
  } catch {
    return null;
  }
}

function scanForRepositories(rootCwd: string): { repositoryRoots: string[]; truncated: boolean } {
  const repositoryRoots: string[] = [];
  let visited = 0;
  let truncated = false;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootCwd, depth: 0 }];
  while (queue.length > 0) {
    if (visited >= SCAN_MAX_DIRECTORIES) {
      truncated = true;
      break;
    }
    const { dir, depth } = queue.shift()!;
    visited += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    // A `.git` entry (directory or worktree file) marks a repository. The scan
    // keeps descending so repos nested inside another repo (an outer workspace
    // repo wrapping per-service repos) are still found; the depth and directory
    // caps bound the walk.
    if (entries.some((entry) => entry.name === ".git")) {
      repositoryRoots.push(dir);
    }
    if (depth >= SCAN_MAX_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return { repositoryRoots, truncated };
}

async function discoverRepositoriesUncached(rootCwd: string): Promise<DiscoveryResult> {
  const { repositoryRoots, truncated } = scanForRepositories(rootCwd);
  const branches = await Promise.all(repositoryRoots.map((root) => readBranch(root)));
  const repositories = repositoryRoots
    .map((root, index): DiscoveredRepository => ({
      repositoryRoot: root,
      name: path.basename(root),
      relativePath: toPosixPath(path.relative(rootCwd, root)),
      branch: branches[index],
    }))
    .sort((a, b) => {
      // The scanned cwd itself lists first; the rest sort by relative path.
      if (a.relativePath === "") return -1;
      if (b.relativePath === "") return 1;
      return a.relativePath.localeCompare(b.relativePath);
    });
  return { repositories, truncated };
}

/**
 * Discover git repositories under `cwd` (including `cwd` itself), with a
 * short-TTL cache and concurrent-dedup so repeated panel opens do not rescan.
 * `refresh: true` bypasses the cached entry.
 */
export async function discoverRepositories(rootCwd: string, options: { refresh?: boolean } = {}): Promise<DiscoveryResult> {
  const now = Date.now();
  if (!options.refresh) {
    const cached = getDiscoveryCache().get(rootCwd);
    if (cached && cached.expiresAt > now) return cached.result;
  }
  const inflight = getDiscoveryInflight().get(rootCwd);
  if (inflight) return inflight;

  const task = discoverRepositoriesUncached(rootCwd)
    .then((result) => {
      getDiscoveryCache().set(rootCwd, { result, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
      return result;
    })
    .finally(() => {
      if (getDiscoveryInflight().get(rootCwd) === task) getDiscoveryInflight().delete(rootCwd);
    });
  getDiscoveryInflight().set(rootCwd, task);
  return task;
}
