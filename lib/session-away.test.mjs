import assert from "node:assert/strict";
import test from "node:test";

// localStorage 桩：session-away 的三个函数都用 try/catch 包裹，直接在 Node 里
// 没有 localStorage，注入一个最小实现测 roundtrip。
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { SESSION_AWAY_RELOAD_MS, recordSessionAway, readSessionAway, clearSessionAway } = await import("./session-away.ts");

test("records the away session and reads it back", () => {
  recordSessionAway("s1", 1_000);
  assert.deepEqual(readSessionAway(), { sessionId: "s1", leftAt: 1_000 });
  assert.equal(SESSION_AWAY_RELOAD_MS, 30_000);
});

test("a malformed record reads as null instead of throwing", () => {
  globalThis.localStorage.setItem("pi-web:session-away", "{broken");
  assert.equal(readSessionAway(), null);
  globalThis.localStorage.setItem("pi-web:session-away", JSON.stringify({ leftAt: "no" }));
  assert.equal(readSessionAway(), null);
});

test("clear removes the record", () => {
  recordSessionAway("s2", 2_000);
  clearSessionAway();
  assert.equal(readSessionAway(), null);
});
