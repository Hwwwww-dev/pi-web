import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatalogRow, mergePolledRow } from "./session-catalog-helpers.ts";

function row(overrides = {}) {
  return {
    path: "/s.jsonl", id: "s1", cwd: "/p", created: "2026-01-01", modified: "2026-01-02",
    messageCount: 0, firstMessage: "", transient: false, ...overrides,
  };
}

test("a hydrated row clears the pending marker the first paint set", () => {
  // The catalogue omits detailsPending once details arrive, so a plain spread
  // would leave the selected session marked pending forever.
  const pending = row({ detailsPending: true, messageCount: 0, firstMessage: "" });
  const hydrated = row({ messageCount: 12, firstMessage: "real first message" });
  const merged = mergeCatalogRow(pending, hydrated);
  assert.equal(merged.detailsPending, undefined);
  assert.equal(merged.messageCount, 12);
  assert.equal(merged.firstMessage, "real first message");
});

test("dropped optional keys are cleared, not inherited", () => {
  const current = row({
    relation: { kind: "fork" },
    branch: "feature/x",
    isWorktree: true,
  });
  const merged = mergeCatalogRow(current, row());
  assert.equal(merged.relation, undefined);
  assert.equal(merged.branch, undefined);
  assert.equal(merged.isWorktree, undefined);
});

test("a locally applied title survives until the catalogue carries it", () => {
  // AppShell writes an auto-generated name onto the selected session before the
  // next listing has picked it up off disk.
  const named = row({ name: "auto-generated title" });
  const merged = mergeCatalogRow(named, row());
  assert.equal(merged.name, "auto-generated title");
  // ...and the catalogue wins once it does carry one.
  assert.equal(mergeCatalogRow(named, row({ name: "renamed on disk" })).name, "renamed on disk");
});

test("values the catalogue does carry always win", () => {
  const merged = mergeCatalogRow(row({ modified: "2026-01-02", messageCount: 1 }), row({ modified: "2026-06-01", messageCount: 99, relation: { kind: "subagent", parentSessionId: "p1" } }));
  assert.equal(merged.modified, "2026-06-01");
  assert.equal(merged.messageCount, 99);
  assert.deepEqual(merged.relation, { kind: "subagent", parentSessionId: "p1" });
});

test("a summary-grade poll row never blanks the details already on screen", () => {
  // The running-state poll defers details for just-changed files; taking such a
  // row as-is printed "…" for the count on every tick of the active session.
  const onScreen = row({ name: "busy session", firstMessage: "hello", messageCount: 2384, modified: "2026-01-02" });
  const polled = row({ name: undefined, firstMessage: "", messageCount: 0, modified: "2026-01-03", detailsPending: true });
  const merged = mergePolledRow(onScreen, polled);
  assert.equal(merged.messageCount, 2384);
  assert.equal(merged.firstMessage, "hello");
  assert.equal(merged.name, "busy session");
  assert.equal(merged.modified, "2026-01-03");
  assert.equal(merged.detailsPending, undefined);
});

test("a poll row that carries details hydrates the row on screen", () => {
  const merged = mergePolledRow(row({ detailsPending: true, messageCount: 0 }), row({ messageCount: 7, firstMessage: "later" }));
  assert.equal(merged.messageCount, 7);
  assert.equal(merged.firstMessage, "later");
  assert.equal(merged.detailsPending, undefined);
});

test("a row seen for the first time passes through still pending", () => {
  // Its details are unknown, so the caller can ask for a full listing.
  const polled = row({ detailsPending: true, messageCount: 0 });
  assert.equal(mergePolledRow(undefined, polled).detailsPending, true);
});
