import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The route's project resolution and the allowed-roots catalogue must not read
// the user's real ~/.pi/agent: point the SDK at an empty scratch directory.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-validate-route-")));
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
const { POST } = await jiti.import("./route.ts");
const { projectIdentityKey } = await jiti.import("../../../../lib/project-identity.ts");

function request(body, contentType, headerOverrides = {}) {
  const headers = {
    host: "localhost",
    origin: "http://localhost",
    "sec-fetch-site": "same-origin",
    ...headerOverrides,
  };
  const init = { method: "POST", headers };
  if (body !== undefined) {
    headers["content-type"] = contentType ?? "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return POST(new Request("http://localhost/api/cwd/validate", init));
}

const scratchProject = path.join(base, "project");
fs.mkdirSync(scratchProject);

test("a same-origin JSON selection validates and grants the folder", async () => {
  const response = await request({ cwd: scratchProject });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(typeof data.projectRoot, "string");
  assert.notEqual(data.projectRoot, "");
});

test("validated cwd responses include server-resolved project identity", async () => {
  const response = await request({ cwd: scratchProject });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    cwd: scratchProject,
    projectRoot: scratchProject,
    projectKey: projectIdentityKey(scratchProject),
  });
});

test("a cross-site request is refused before any filesystem work", async () => {
  const response = await request(
    { cwd: scratchProject },
    undefined,
    { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Untrusted API request");
});

test("a non-JSON body is refused even with a same-origin header", async () => {
  // A text/plain body would skip CORS preflight; the content-type gate keeps
  // the root-granting route from being driven by a simple cross-site form.
  const response = await POST(new Request("http://localhost/api/cwd/validate", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "text/plain",
    },
    body: JSON.stringify({ cwd: scratchProject }),
  }));
  assert.equal(response.status, 415);
});

test("an empty cwd is a 400", async () => {
  const response = await request({ cwd: "   " });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Path is required");
});

test("a directory that does not exist is a 400, not a 500", async () => {
  const response = await request({ cwd: path.join(base, "missing") });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /does not exist/);
});
