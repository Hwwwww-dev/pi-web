import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./chat-keepalive.ts");
}

function session(id) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "",
  };
}

function slot(id, lastActiveAt, epoch = 0) {
  return { session: session(id), lastActiveAt, epoch };
}

test("upsert inserts new slot and caps to maxSessions by evicting least-recently-active", async () => {
  const { upsertKeepAliveSlot } = await loadSubject();
  const slots = [
    slot("a", 100),
    slot("b", 300),
    slot("c", 200),
  ];
  const next = upsertKeepAliveSlot(slots, session("d"), 400, 3);
  assert.deepEqual(next.map((s) => s.session.id), ["b", "c", "d"]);
});

test("upsert never evicts the just-selected session", async () => {
  const { upsertKeepAliveSlot } = await loadSubject();
  const slots = [
    slot("a", 100),
    slot("b", 300),
  ];
  const next = upsertKeepAliveSlot(slots, session("c"), 400, 1);
  assert.deepEqual(next.map((s) => s.session.id), ["c"]);
});

test("upsert refreshes snapshot and bumps epoch only on remount", async () => {
  const { upsertKeepAliveSlot } = await loadSubject();
  const existing = [slot("a", 100, 2)];
  const touched = upsertKeepAliveSlot(existing, session("a"), 400, 5);
  assert.equal(touched[0].lastActiveAt, 400);
  assert.equal(touched[0].epoch, 2);
  const remounted = upsertKeepAliveSlot(existing, session("a"), 400, 5, true);
  assert.equal(remounted[0].epoch, 3);
});

test("saveKeepAliveConfig clamps values to configured limits", async () => {
  const { saveKeepAliveConfig, KEEP_ALIVE_CONFIG_LIMITS } = await loadSubject();
  const stored = {};
  const original = globalThis.window;
  globalThis.window = { localStorage: { setItem: (k, v) => { stored[k] = v; } } };
  try {
    const normalized = saveKeepAliveConfig({ maxSessions: 999, idleTimeoutMinutes: -5 });
    assert.equal(normalized.maxSessions, KEEP_ALIVE_CONFIG_LIMITS.maxSessions.max);
    assert.equal(normalized.idleTimeoutMinutes, KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.min);
    assert.deepEqual(JSON.parse(stored["pi-web:chat-keepalive"]), normalized);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
