import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-turns-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import("@/lib/session-reader.ts");

const CWD = "/work/turns";
const sessionsDir = path.join(agentDir, "sessions", encodeURIComponent(CWD));
const at = (ms) => new Date(ms).toISOString();

async function writeSession(id, lines) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(sessionsDir, { recursive: true }));
  const header = { type: "session", version: 3, id, timestamp: at(0), cwd: CWD };
  await writeFile(path.join(sessionsDir, `${id}.jsonl`), `${[header, ...lines].map((line) => JSON.stringify(line)).join("\n")}\n`);
  invalidateSessionListCache();
  invalidateSessionPathCache();
}

function turn(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp: at(1000), message: { role, content } };
}

function get(id, query = "") {
  return GET(new Request(`http://localhost/api/sessions/${id}/turns${query}`), {
    params: Promise.resolve({ id }),
  });
}

test("lists the leaf branch's user turns oldest first; missing session is 404", async () => {
  await writeSession("t1", [
    turn("e0", null, "user", "first question"),
    turn("e1", "e0", "assistant", [{ type: "text", text: "answer" }]),
    turn("e2", "e1", "user", "follow-up"),
    turn("e3", "e1", "user", "off-branch"),
  ]);

  const ok = await get("t1");
  assert.equal(ok.status, 200);
  const body = await ok.json();
  // Without leafId the leaf is the file's last entry (e3): the branch is
  // e3 -> e1 -> e0, so the off-branch-looking e3 is actually the tip.
  assert.deepEqual(body.turns.map((t) => t.entryId), ["e0", "e3"]);
  assert.equal(body.turns[0].preview, "first question");

  // With an explicit leafId the walk stops at e2's ancestry instead.
  const leafBody = await (await get("t1", "?leafId=e2")).json();
  assert.deepEqual(leafBody.turns.map((t) => t.entryId), ["e0", "e2"]);

  const missing = await get("does-not-exist");
  assert.equal(missing.status, 404);
});

test("leafId steers the branch; a leaf with no user turns yields an empty list", async () => {
  await writeSession("t2", [
    turn("a0", null, "user", "root"),
    turn("a1", "a0", "assistant", [{ type: "text", text: "ok" }]),
    turn("a2", "a1", "assistant", [{ type: "text", text: "more" }]),
  ]);

  const body = await (await get("t2", "?leafId=a2")).json();
  assert.deepEqual(body.turns.map((t) => t.entryId), ["a0"]);

  const unknownLeaf = await (await get("t2", "?leafId=zzzz")).json();
  assert.deepEqual(unknownLeaf.turns, []);
});
