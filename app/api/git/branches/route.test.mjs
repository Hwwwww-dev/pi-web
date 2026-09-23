import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
    execFile(file, args, { env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });

function makeRequest(params) {
  return new NextRequest(`http://localhost/api/git/branches?${new URLSearchParams(params).toString()}`);
}

async function makeAllowedRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-branches-route-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  await execFileAsync("git", ["init", "-q", "-b", "main", root]);
  await execFileAsync("git", ["-C", root, "commit", "-q", "--allow-empty", "-m", "init"]);
  return root;
}

test("returns local branches with the checked-out one", async (t) => {
  const repo = await makeAllowedRepo(t);
  await execFileAsync("git", ["-C", repo, "branch", "-q", "feature/x"]);

  const response = await GET(makeRequest({ repo }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { branches: ["feature/x", "main"], current: "main" });
});

test("rejects a repository outside the allowed roots", async (t) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-branches-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const response = await GET(makeRequest({ repo: outside }));
  assert.equal(response.status, 403);
});

test("rejects a missing repository with 404 and a relative path with 400", async (t) => {
  const repo = await makeAllowedRepo(t);
  const missing = await GET(makeRequest({ repo: path.join(repo, "missing") }));
  assert.equal(missing.status, 404);
  const relative = await GET(makeRequest({ repo: "relative/path" }));
  assert.equal(relative.status, 400);
});
