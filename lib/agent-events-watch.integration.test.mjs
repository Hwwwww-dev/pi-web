import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// One jiti instance on purpose: the route's "@/..." imports and the test's own imports must
// share one module graph, so the registry the route watches is the one the test starts into.
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": process.cwd() },
});

test("the events route watches instead of starting sessions", { timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-events-watch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  });

  const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");
  const rpc = await jiti.import("../lib/rpc-manager.ts");
  const { GET: listSessions } = await jiti.import("../app/api/sessions/route.ts");
  const { RPC_SESSION_WATCH_INTERVAL_MS } = rpc;

  // A real session file on disk, no wrapper anywhere. create() is lazy: the first appended
  // message is what writes the jsonl the session list reads.
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const sm = SessionManager.create(dir);
  sm.appendMessage({ role: "user", content: "first message", timestamp: Date.now() });
  const listed = await (await listSessions(new Request("http://test/api/sessions"))).json();
  const { id, path: filePath } = listed.sessions[0];
  assert.equal(id, sm.getSessionId());
  assert.ok(id && filePath, "the session file is listed");

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await GET(
    new Request(`http://test/api/agent/${encodeURIComponent(id)}/events`, { signal: controller.signal }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const first = await reader.read();
  assert.ok(!first.done);
  text += decoder.decode(first.value, { stream: true });

  // Past a couple of watch intervals the stream has no session to attach to: no `connected`
  // frame, and — the regression this guards — the route must not have started one.
  await new Promise((resolve) => setTimeout(resolve, RPC_SESSION_WATCH_INTERVAL_MS * 2 + 500));
  assert.ok(!text.includes('"type":"connected"'), "the stream must stay unconnected without a session");
  assert.equal(rpc.getRpcSession(id), undefined, "watching must not start a session");

  // A start another caller asked for registers the wrapper; the same stream attaches to it.
  const { session } = await rpc.startRpcSession(id, filePath);
  t.after(() => session.shutdown());
  const deadline = Date.now() + 8_000;
  while (!text.includes('"type":"connected"')) {
    if (Date.now() > deadline) break;
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.ok(text.includes('"type":"connected"'), "the watcher attaches once a wrapper registers");
  assert.ok(text.includes(JSON.stringify(id).slice(1, -1)), "the connected frame names the session");
});
