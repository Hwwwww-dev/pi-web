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
  return new NextRequest(`http://localhost/api/git/log?${new URLSearchParams(params).toString()}`);
}

async function makeAllowedRepo(t, commits = 3) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-log-route-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  await execFileAsync("git", ["init", "-q", "-b", "main", root]);
  for (let i = 0; i < commits; i++) {
    await writeFile(path.join(root, `f${i}.txt`), String(i));
    await execFileAsync("git", ["-C", root, "add", `f${i}.txt`]);
    await execFileAsync("git", ["-C", root, "commit", "-q", "-m", `commit ${i}`]);
  }
  return root;
}

test("returns commit summaries for an allowed repository", async (t) => {
  const repo = await makeAllowedRepo(t);
  const response = await GET(makeRequest({ repo }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.commits.length, 3);
  assert.equal(data.hasMore, false);
  assert.equal(data.commits[0].subject, "commit 2");
  assert.match(data.commits[0].hash, /^[0-9a-f]{40}$/);
});

test("paginates with limit and offset", async (t) => {
  const repo = await makeAllowedRepo(t);
  const page = await GET(makeRequest({ repo, limit: "2" }));
  const data = await page.json();
  assert.equal(data.commits.length, 2);
  assert.equal(data.hasMore, true);
  const shifted = await GET(makeRequest({ repo, limit: "2", offset: "2" }));
  const shiftedData = await shifted.json();
  assert.deepEqual(shiftedData.commits.map((commit) => commit.subject), ["commit 0"]);
  assert.equal(shiftedData.hasMore, false);
});

test("an empty repository yields an empty page, not an error", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-log-route-empty-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  await execFileAsync("git", ["init", "-q", root]);

  const response = await GET(makeRequest({ repo: root }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { commits: [], hasMore: false });
});

test("rejects a repository outside the allowed roots", async (t) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-log-route-denied-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const response = await GET(makeRequest({ repo: outside }));
  assert.equal(response.status, 403);
});

test("rejects invalid limit and offset values", async () => {
  for (const params of [{ repo: "/tmp/x", limit: "0" }, { repo: "/tmp/x", limit: "101" }, { repo: "/tmp/x", offset: "-1" }, { repo: "/tmp/x", limit: "abc" }]) {
    const response = await GET(makeRequest(params));
    assert.equal(response.status, 400, JSON.stringify(params));
  }
});

test("rejects a missing repository with 404", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-log-route-404-"));
  t.after(() => {
    getAdditionalAllowedRoots().delete(path.normalize(root + "/"));
    return rm(root, { recursive: true, force: true });
  });
  allowFileRoot(root);
  const response = await GET(makeRequest({ repo: path.join(root, "missing") }));
  assert.equal(response.status, 404);
});
