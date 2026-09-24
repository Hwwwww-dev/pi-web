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
const { TEXT_PREVIEW_MAX_BYTES } = await jiti.import("@/lib/file-types");
const { NextRequest } = await jiti.import("next/server");

const execFileAsync = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, LC_ALL: "C", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });

function makeRequest(params) {
  return new NextRequest(`http://localhost/api/git/file?${new URLSearchParams(params).toString()}`);
}

async function makeAllowedRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-file-route-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  await execFileAsync("git", ["init", "-q", "-b", "main", root]);
  await writeFile(path.join(root, "config.yml"), "name: one\n");
  await execFileAsync("git", ["-C", root, "add", "config.yml"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "add config"]);
  const older = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).trim();
  await writeFile(path.join(root, "config.yml"), "name: two\n");
  await writeFile(path.join(root, "gone.txt"), "bye\n");
  await writeFile(path.join(root, "logo.bin"), Buffer.from([0x89, 0x00, 0x50]));
  await execFileAsync("git", ["-C", root, "add", "-A"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "edit config, drop gone, add logo"]);
  const head = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).trim();
  await execFileAsync("git", ["-C", root, "rm", "-q", "gone.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "remove gone"]);
  const deletion = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).trim();
  return { root, older, head, deletion };
}

test("serves one file as it exists at a revision with its language", async (t) => {
  const { root, older, head } = await makeAllowedRepo(t);

  const atHead = await GET(makeRequest({ repo: root, hash: head, path: "config.yml" }));
  assert.equal(atHead.status, 200);
  const headBody = await atHead.json();
  assert.equal(headBody.content, "name: two\n");
  assert.equal(headBody.language, "yaml");
  assert.equal(headBody.size, "name: two\n".length);
  assert.equal(headBody.truncated, false);

  // Same path, earlier revision: the source view follows the commit, not the worktree.
  const atOlder = await GET(makeRequest({ repo: root, hash: older, path: "config.yml" }));
  assert.equal((await atOlder.json()).content, "name: one\n");
});

test("a path that does not exist at the revision returns 404", async (t) => {
  const { root, head, deletion } = await makeAllowedRepo(t);

  const removed = await GET(makeRequest({ repo: root, hash: deletion, path: "gone.txt" }));
  assert.equal(removed.status, 404);
  assert.match((await removed.json()).error, /does not exist in this commit/);

  const neverTracked = await GET(makeRequest({ repo: root, hash: head, path: "never.txt" }));
  assert.equal(neverTracked.status, 404);

  const unknownHash = await GET(makeRequest({ repo: root, hash: "0123456789abcdef0123456789abcdef01234567", path: "config.yml" }));
  assert.equal(unknownHash.status, 404);
});

test("binary blobs are refused instead of rendered as text", async (t) => {
  const { root, head } = await makeAllowedRepo(t);

  const response = await GET(makeRequest({ repo: root, hash: head, path: "logo.bin" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /binary file/);
});

test("long files are truncated on a line boundary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-file-large-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  await execFileAsync("git", ["init", "-q", "-b", "main", root]);
  const body = `${"x".repeat(99)}\n`.repeat(4_000);
  await writeFile(path.join(root, "big.txt"), body);
  await execFileAsync("git", ["-C", root, "add", "big.txt"]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "add big"]);
  const head = (await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).trim();

  const response = await GET(makeRequest({ repo: root, hash: head, path: "big.txt" }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.truncated, true);
  assert.ok(payload.content.length <= TEXT_PREVIEW_MAX_BYTES);
  assert.ok(payload.content.endsWith("\n"));
  assert.equal(payload.size, body.length);
});

test("download returns the raw blob as an attachment", async (t) => {
  const { root, head } = await makeAllowedRepo(t);

  const response = await GET(makeRequest({ repo: root, hash: head, path: "logo.bin", download: "1" }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="logo\.bin"/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0x89, 0x00, 0x50]);
});

test("rejects a repository outside the allowed roots", async (t) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-file-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));

  const response = await GET(makeRequest({ repo: outside, hash: "0123456", path: "a.txt" }));
  assert.equal(response.status, 403);
});

test("validates the repository path, hash and blob path", async (t) => {
  const { root, head } = await makeAllowedRepo(t);

  assert.equal((await GET(makeRequest({ repo: "relative/repo", hash: head, path: "config.yml" }))).status, 400);
  for (const hash of ["main", "--upload-pack=x", "xyz"]) {
    assert.equal((await GET(makeRequest({ repo: root, hash, path: "config.yml" }))).status, 400, hash);
  }
  assert.equal((await GET(makeRequest({ repo: root, hash: head, path: "../outside.txt" }))).status, 400);
});
