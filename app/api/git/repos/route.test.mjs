import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function makeRequest(cwd, refresh) {
  const params = new URLSearchParams({ cwd });
  if (refresh) params.set("refresh", "1");
  return new NextRequest(`http://localhost/api/git/repos?${params.toString()}`);
}

test("returns discovered repositories for an allowed cwd", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-repos-route-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);

  const service = path.join(root, "svc");
  await mkdir(service, { recursive: true });
  await execFileAsync("git", ["init", "-q", "-b", "main", service]);
  await execFileAsync("git", ["-C", service, "commit", "-q", "--allow-empty", "-m", "c"]);

  const response = await GET(makeRequest(root, true));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.truncated, false);
  assert.match(data.scannedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(data.repositories.map((repo) => repo.relativePath), ["svc"]);
  assert.equal(data.repositories[0].branch, "main");
});

test("rejects a cwd outside the allowed roots", async (t) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-web-repos-route-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));

  const response = await GET(makeRequest(outside));
  assert.equal(response.status, 403);
});

test("rejects a relative cwd with 400", async () => {
  const response = await GET(makeRequest("relative/path"));
  assert.equal(response.status, 400);
});

test("returns 404 for a missing directory inside an allowed root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-repos-route-404-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);

  const response = await GET(makeRequest(path.join(root, "missing")));
  assert.equal(response.status, 404);
});

test("returns 400 when the cwd is a file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-repos-route-file-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  const filePath = path.join(root, "note.txt");
  await writeFile(filePath, "x");

  const response = await GET(makeRequest(filePath));
  assert.equal(response.status, 400);
});
