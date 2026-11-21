import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The route reads the sessions catalogue through the SDK; keep it off the
// user's real ~/.pi/agent with an empty scratch directory.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-worktrees-route-")));
const scratchAgent = path.join(base, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = scratchAgent;
fs.mkdirSync(scratchAgent);

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { DELETE, POST } = await jiti.import("./route.ts");

function request(handler, body, headerOverrides = {}) {
  const headers = {
    host: "localhost",
    origin: "http://localhost",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    ...headerOverrides,
  };
  const init = { method: handler === POST ? "POST" : "DELETE", headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return handler(new Request("http://localhost/api/worktrees", init));
}

const scratchProject = path.join(base, "project");
fs.mkdirSync(scratchProject);

test("a cross-site create is refused before any filesystem work", async () => {
  const response = await request(POST, { cwd: scratchProject, branch: "wip" }, {
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Untrusted API request");
});

test("a cross-site removal is refused before any filesystem work", async () => {
  const response = await request(DELETE, { cwd: scratchProject, path: scratchProject }, {
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Untrusted API request");
});

test("a non-JSON body is refused even with a same-origin header", async () => {
  // A text/plain body skips CORS preflight; the content-type gate keeps the
  // mutating route from being driven by a simple cross-site form post.
  for (const handler of [POST, DELETE]) {
    const response = await request(handler, "{}", { "content-type": "text/plain" });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error, "Content-Type must be application/json");
  }
});

test("same-origin JSON reaches the handler's own validation", async () => {
  const missingCwd = await request(POST, {});
  assert.equal(missingCwd.status, 400);
  assert.equal((await missingCwd.json()).error, "cwd is required");

  const missingBranch = await request(POST, { cwd: scratchProject });
  assert.equal(missingBranch.status, 400);
  assert.equal((await missingBranch.json()).error, "branch is required");

  const removalMissing = await request(DELETE, { cwd: scratchProject });
  assert.equal(removalMissing.status, 400);
  assert.equal((await removalMissing.json()).error, "path is required");
});
