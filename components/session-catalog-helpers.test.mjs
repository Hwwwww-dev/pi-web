import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatalogRow } from "./session-catalog-helpers.ts";

function row(overrides = {}) {
  return {
    path: "/s.jsonl", id: "s1", cwd: "/p", created: "2026-01-01", modified: "2026-01-02",
    messageCount: 0, firstMessage: "", transient: false, ...overrides,
  };
}

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
  const merged = mergeCatalogRow(
    row({ modified: "2026-01-02", messageCount: 1 }),
    row({ modified: "2026-06-01", messageCount: 99, relation: { kind: "subagent", parentSessionId: "p1" } }),
  );
  assert.equal(merged.modified, "2026-06-01");
  assert.equal(merged.messageCount, 99);
  assert.deepEqual(merged.relation, { kind: "subagent", parentSessionId: "p1" });
});
