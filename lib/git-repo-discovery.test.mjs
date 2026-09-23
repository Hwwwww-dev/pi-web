import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { discoverRepositories } = await jiti.import("./git-repo-discovery.ts");

const execFileAsync = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, LC_ALL: "C", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });

async function gitInit(dir, branch) {
  await execFileAsync("git", branch ? ["init", "-q", "-b", branch, dir] : ["init", "-q", dir]);
}

async function gitCommit(dir, message) {
  await execFileAsync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", message]);
}

// Every test uses its own tmpdir as the cache key, so cached entries from
// other tests never leak in; the cache itself is exercised explicitly.
async function freshRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `pi-web-repo-discovery-${prefix}-`));
}

test("discovers nested repositories including ignored ones and does not descend into a repository", async (t) => {
  const root = await freshRoot("nested");
  t.after(() => rm(root, { recursive: true, force: true }));

  // Outer repo with a nested repo that a real workspace would gitignore —
  // discovery scans the filesystem, so the ignore must not matter.
  await gitInit(root, "master");
  await gitCommit(root, "outer");
  await mkdir(path.join(root, "microservices"));
  const auth = path.join(root, "microservices", "auth");
  await mkdir(auth, { recursive: true });
  await gitInit(auth, "dev");
  await gitCommit(auth, "inner");
  // Inside the nested repo, still within the depth limit: found too.
  await mkdir(path.join(auth, "deeper"), { recursive: true });
  await gitInit(path.join(auth, "deeper"), "main");

  const { repositories, truncated } = await discoverRepositories(root, { refresh: true });
  assert.equal(truncated, false);
  assert.deepEqual(repositories.map((repo) => repo.relativePath), ["", "microservices/auth", "microservices/auth/deeper"]);
  assert.equal(repositories[0].name, path.basename(root));
  assert.equal(repositories[0].branch, "master");
  assert.equal(repositories[1].name, "auth");
  assert.equal(repositories[1].branch, "dev");
});

test("discovers repositories when the cwd itself is not a repository", async (t) => {
  const root = await freshRoot("plain");
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(path.join(root, "ea-modules"), { recursive: true });
  await gitInit(path.join(root, "ea-modules"), "dev");
  await gitCommit(path.join(root, "ea-modules"), "c");

  const { repositories } = await discoverRepositories(root, { refresh: true });
  assert.deepEqual(repositories.map((repo) => repo.relativePath), ["ea-modules"]);
  assert.equal(repositories[0].branch, "dev");
});

test("an empty repository yields a null branch", async (t) => {
  const root = await freshRoot("empty");
  t.after(() => rm(root, { recursive: true, force: true }));
  await gitInit(root);

  const { repositories } = await discoverRepositories(root, { refresh: true });
  assert.equal(repositories.length, 1);
  assert.equal(repositories[0].relativePath, "");
  assert.equal(repositories[0].branch, null);
});

test("skips hidden, dependency, and build directories", async (t) => {
  const root = await freshRoot("ignored-dirs");
  t.after(() => rm(root, { recursive: true, force: true }));

  const hidden = path.join(root, ".hidden", "repo");
  const deps = path.join(root, "node_modules", "repo");
  const build = path.join(root, "dist", "repo");
  for (const dir of [hidden, deps, build]) {
    await mkdir(dir, { recursive: true });
    await gitInit(dir);
  }
  const visible = path.join(root, "services", "keep");
  await mkdir(visible, { recursive: true });
  await gitInit(visible, "main");

  const { repositories } = await discoverRepositories(root, { refresh: true });
  assert.deepEqual(repositories.map((repo) => repo.relativePath), ["services/keep"]);
});

test("respects the three-level depth limit", async (t) => {
  const root = await freshRoot("depth");
  t.after(() => rm(root, { recursive: true, force: true }));

  const atLimit = path.join(root, "l1", "l2", "l3");
  const beyondLimit = path.join(root, "l1", "l2", "l3", "l4");
  await mkdir(atLimit, { recursive: true });
  await gitInit(atLimit);
  await mkdir(beyondLimit, { recursive: true });
  await gitInit(beyondLimit);

  const { repositories } = await discoverRepositories(root, { refresh: true });
  assert.deepEqual(repositories.map((repo) => repo.relativePath), ["l1/l2/l3"]);
});

test("reports truncation when the directory cap is exceeded", async (t) => {
  const root = await freshRoot("cap");
  t.after(() => rm(root, { recursive: true, force: true }));
  // No repository anywhere: the scan walks until the cap and reports it.
  const dirs = Array.from({ length: 2100 }, (_, i) => path.join(root, `d${String(i).padStart(4, "0")}`));
  for (const dir of dirs) await mkdir(dir);
  const { repositories, truncated } = await discoverRepositories(root, { refresh: true });
  assert.equal(truncated, true);
  assert.equal(repositories.length, 0);
});

test("caches results per cwd until refreshed", async (t) => {
  const root = await freshRoot("cache");
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await discoverRepositories(root, { refresh: true });
  assert.equal(first.repositories.length, 0);

  const added = path.join(root, "late");
  await mkdir(added, { recursive: true });
  await gitInit(added);
  // Not refreshed: the cached (empty) result is served.
  const cached = await discoverRepositories(root);
  assert.equal(cached.repositories.length, 0);
  // Refreshed: the new repository shows up.
  const refreshed = await discoverRepositories(root, { refresh: true });
  assert.deepEqual(refreshed.repositories.map((repo) => repo.relativePath), ["late"]);
});
