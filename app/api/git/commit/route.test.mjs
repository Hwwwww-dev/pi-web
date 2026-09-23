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
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot, getAdditionalAllowedRoots } = await jiti.import("@/lib/allowed-roots");
const { NextRequest } = await jiti.import("next/server");

const execFileAsync = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, LC_ALL: "C", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });

function makeRequest(params) {
  return new NextRequest(`http://localhost/api/git/commit?${new URLSearchParams(params).toString()}`);
}

async function makeAllowedRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-commit-route-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  await execFileAsync("git", ["init", "-q", "-b", "main", root]);
  await writeFile(path.join(root, "a.txt"), "one\n");
  await execFileAsync("git", ["-C", root, "add", "a.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "add a"]);
  await writeFile(path.join(root, "a.txt"), "one\ntwo\n");
  await writeFile(path.join(root, "b.txt"), "bee\n");
  await execFileAsync("git", ["-C", root, "add", "-A"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "edit a, add b"]);
  const head = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).trim();
  const headParent = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD~1"])).trim();
  return { root, head, headParent };
}

test("lists changed files of a commit with line counts", async (t) => {
  const { root, head } = await makeAllowedRepo(t);
  const response = await GET(makeRequest({ repo: root, hash: head }));
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.deepEqual(detail.files, [
    { path: "a.txt", status: "M", additions: 1, deletions: 0 },
    { path: "b.txt", status: "A", additions: 1, deletions: 0 },
  ]);
  assert.equal(detail.totalAdditions, 2);
  assert.equal(detail.totalDeletions, 0);
});

test("returns the unified diff of one file within a commit", async (t) => {
  const { root, head } = await makeAllowedRepo(t);
  const response = await GET(makeRequest({ repo: root, hash: head, path: "a.txt" }));
  assert.equal(response.status, 200);
  const { patch } = await response.json();
  assert.match(patch, /^diff --git a\/a\.txt b\/a\.txt/);
  assert.match(patch, /\+two/);
});

test("a file unchanged in the commit returns 404", async (t) => {
  const { root, head, headParent } = await makeAllowedRepo(t);
  const unchanged = await GET(makeRequest({ repo: root, hash: headParent, path: "b.txt" }));
  assert.equal(unchanged.status, 404);
  const later = await GET(makeRequest({ repo: root, hash: head, path: "b.txt" }));
  assert.equal(later.status, 200);
});

test("path traversal outside the repository is rejected", async (t) => {
  const { root, head } = await makeAllowedRepo(t);
  const response = await GET(makeRequest({ repo: root, hash: head, path: "../outside.txt" }));
  assert.equal(response.status, 400);
});

test("malformed commit hashes are rejected", async (t) => {
  const { root } = await makeAllowedRepo(t);
  for (const hash of ["main", "--upload-pack=x", "xyz"]) {
    const response = await GET(makeRequest({ repo: root, hash }));
    assert.equal(response.status, 400, hash);
  }
});

test("an unknown commit id returns 400", async (t) => {
  const { root } = await makeAllowedRepo(t);
  const response = await GET(makeRequest({ repo: root, hash: "0123456789abcdef0123456789abcdef01234567" }));
  assert.equal(response.status, 400);
});

test("rejects a repository outside the allowed roots", async (t) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-commit-route-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const response = await GET(makeRequest({ repo: outside, hash: "0123456" }));
  assert.equal(response.status, 403);
});
