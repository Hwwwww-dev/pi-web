import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });

test("a joiner that names tools applies them to the start it joined instead of dropping them", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-inflight-join-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  });

  const { startRpcSession } = await jiti.import("./rpc-manager.ts");

  // The start lock is registered before the first call returns, so the second call joins it
  // deterministically — the shape of an SSE reconnect's bare start racing a POST that names tools.
  const first = startRpcSession("__new__inflight-join", "", dir);
  const joined = await startRpcSession("__new__inflight-join", "", dir, { toolNames: ["read", "bash"] });
  const started = await first;
  t.after(() => started.session.shutdown());

  // The join returns the same wrapper, with the joiner's selection applied: the default
  // loadout's edit and write are gone, read and bash stay.
  assert.equal(joined.session, started.session);
  assert.deepEqual([...joined.session.inner.getActiveToolNames()].sort(), ["bash", "read"]);
});
