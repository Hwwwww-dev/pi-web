import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { workspaceKeyOf } = await jiti.import("./workspace-memory.ts");

test("workspaceKeyOf prefers projectKey, then projectRoot, then cwd", () => {
  assert.equal(
    workspaceKeyOf({ cwd: "/repos/a/worktrees/b", projectRoot: "/repos/a", projectKey: "project:a" }),
    "project:a",
  );
  assert.equal(workspaceKeyOf({ cwd: "/repos/a/worktrees/b", projectRoot: "/repos/a" }), "/repos/a");
  assert.equal(workspaceKeyOf({ cwd: "/plain/dir", projectRoot: null }), "/plain/dir");
  assert.equal(workspaceKeyOf({ cwd: "/plain/dir" }), "/plain/dir");
});
