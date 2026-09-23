import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  DEFAULT_LOG_LIMIT,
  isSafeCommitFilePath,
  isValidCommitHash,
  parseLogLimit,
  parseLogOffset,
  parseLogRef,
  readBranches,
  readCommitFilePatch,
  readCommitFiles,
  readCommitLog,
} = await jiti.import("./git-history.ts");

const execFileAsync = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, LC_ALL: "C", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });

async function makeRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, content) => writeFile(path.join(root, name), content);
  await execFileAsync("git", ["init", "-q", "-b", "main", root]);
  await write("a.txt", "one\n");
  await execFileAsync("git", ["-C", root, "add", "a.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "add a"]);
  await write("a.txt", "one\ntwo\n");
  await write("b.txt", "bee\n");
  await execFileAsync("git", ["-C", root, "add", "-A"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "edit a, add b"]);
  await execFileAsync("git", ["-C", root, "mv", "b.txt", "c.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "rename b to c"]);
  await execFileAsync("git", ["-C", root, "rm", "-q", "a.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "delete a"]);
  return root;
}

test("commit summaries expose hash/shortHash/author/timestamp/subject", async (t) => {
  const repo = await makeRepo(t);
  const { commits, hasMore } = await readCommitLog(repo, DEFAULT_LOG_LIMIT, 0);
  assert.equal(commits.length, 4);
  assert.equal(hasMore, false);
  assert.deepEqual(commits.map((commit) => commit.subject), ["delete a", "rename b to c", "edit a, add b", "add a"]);
  for (const commit of commits) {
    assert.match(commit.hash, /^[0-9a-f]{40}$/);
    assert.match(commit.shortHash, /^[0-9a-f]{7,}$/);
    assert.equal(typeof commit.timestamp, "number");
    assert.ok(Number.isFinite(commit.timestamp));
  }
});

test("log pagination reports hasMore and honors offset", async (t) => {
  const repo = await makeRepo(t);
  const page = await readCommitLog(repo, 2, 0);
  assert.equal(page.commits.length, 2);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.commits.map((commit) => commit.subject), ["delete a", "rename b to c"]);
  const shifted = await readCommitLog(repo, 2, 2);
  assert.deepEqual(shifted.commits.map((commit) => commit.subject), ["edit a, add b", "add a"]);
  assert.equal(shifted.hasMore, false);
  const past = await readCommitLog(repo, 20, 99);
  assert.deepEqual(past.commits, []);
  assert.equal(past.hasMore, false);
});

test("commit summaries carry multi-line bodies and log can follow a ref", async (t) => {
  const repo = await makeRepo(t);
  await execFileAsync("git", ["-C", repo, "checkout", "-q", "-b", "feature/x"]);
  await writeFile(path.join(repo, "d.txt"), "dee\n");
  await execFileAsync("git", ["-C", repo, "add", "d.txt"]);
  await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", "subject line", "-m", "body line one\nbody line two"]);

  const branchLog = await readCommitLog(repo, DEFAULT_LOG_LIMIT, 0, "feature/x");
  assert.equal(branchLog.commits[0].subject, "subject line");
  assert.equal(branchLog.commits[0].body, "body line one\nbody line two");
  assert.deepEqual(branchLog.commits.map((commit) => commit.subject), [
    "subject line", "delete a", "rename b to c", "edit a, add b", "add a",
  ]);

  const mainLog = await readCommitLog(repo, DEFAULT_LOG_LIMIT, 0, "main");
  assert.deepEqual(mainLog.commits.map((commit) => commit.subject), ["delete a", "rename b to c", "edit a, add b", "add a"]);
  assert.ok(mainLog.commits.every((commit) => commit.body === ""));
});

 test("readBranches lists local branches and reports the checked-out one", async (t) => {
  const repo = await makeRepo(t);
  assert.deepEqual(await readBranches(repo), { branches: ["main"], current: "main" });
  await execFileAsync("git", ["-C", repo, "checkout", "-q", "-b", "feature/x"]);
  assert.deepEqual(await readBranches(repo), { branches: ["feature/x", "main"], current: "feature/x" });
  await execFileAsync("git", ["-C", repo, "checkout", "-q", "--detach", "HEAD"]);
  const detached = await readBranches(repo);
  assert.deepEqual(detached.branches, ["feature/x", "main"]);
  assert.equal(detached.current, null);
});

test("commit files expose A/M/D/R statuses with previousPath for renames", async (t) => {
  const repo = await makeRepo(t);
  const log = await readCommitLog(repo, 1, 0);
  const head = log.commits[0].hash;

  const deleteFiles = await readCommitFiles(repo, head);
  assert.deepEqual(deleteFiles, [{ path: "a.txt", status: "D" }]);

  const renameFiles = await readCommitFiles(repo, (await readCommitLog(repo, 1, 1)).commits[0].hash);
  assert.equal(renameFiles.length, 1);
  assert.equal(renameFiles[0].status, "R");
  assert.equal(renameFiles[0].path, "c.txt");
  assert.equal(renameFiles[0].previousPath, "b.txt");
});

test("commit file patch returns the unified diff of one file", async (t) => {
  const repo = await makeRepo(t);
  const editHash = (await readCommitLog(repo, 1, 2)).commits[0].hash;
  const patch = await readCommitFilePatch(repo, editHash, "a.txt");
  assert.match(patch, /^diff --git a\/a\.txt b\/a\.txt/);
  assert.match(patch, /\+two/);
  assert.equal(await readCommitFilePatch(repo, editHash, "never-touched.txt"), null);
});

test("empty repositories report no commits", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-history-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "-q", root]);
  const { commits, hasMore } = await readCommitLog(root, DEFAULT_LOG_LIMIT, 0);
  assert.deepEqual(commits, []);
  assert.equal(hasMore, false);
});

test("parsing and validation helpers reject bad input", () => {
  assert.equal(parseLogLimit(null), DEFAULT_LOG_LIMIT);
  assert.equal(parseLogLimit("5"), 5);
  assert.equal(parseLogLimit("0"), null);
  assert.equal(parseLogLimit("101"), null);
  assert.equal(parseLogLimit("abc"), null);
  assert.equal(parseLogOffset(null), 0);
  assert.equal(parseLogOffset("3"), 3);
  assert.equal(parseLogOffset("-1"), null);
  assert.equal(parseLogRef(null), "");
  assert.equal(parseLogRef(""), "");
  assert.equal(parseLogRef("main"), "main");
  assert.equal(parseLogRef("feature/x"), "feature/x");
  assert.equal(parseLogRef("HEAD"), "HEAD");
  assert.equal(parseLogRef("-upload-pack=x"), null);
  assert.equal(parseLogRef("a..b"), null);
  assert.equal(parseLogRef("a.lock"), null);
  assert.equal(parseLogRef("a b"), null);
  assert.equal(parseLogRef("".padStart(201, "a")), null);
  assert.equal(isValidCommitHash("0123456789abcdef"), true);
  assert.equal(isValidCommitHash("main"), false);
  assert.equal(isValidCommitHash("--upload-pack=x"), false);
  assert.equal(isSafeCommitFilePath("/repo", "src/a.txt"), true);
  assert.equal(isSafeCommitFilePath("/repo", "../outside.txt"), false);
  assert.equal(isSafeCommitFilePath("/repo", "/etc/passwd"), false);
  assert.equal(isSafeCommitFilePath("/repo", ""), false);
});
