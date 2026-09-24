import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { getToolCategory, getToolFilePaths, getToolPreviewText } = await jiti.import("./tool-categories.ts");

test("maps pi built-in tool names to categories", () => {
  assert.equal(getToolCategory("read"), "view");
  assert.equal(getToolCategory("ls"), "view");
  assert.equal(getToolCategory("grep"), "search");
  assert.equal(getToolCategory("edit"), "edit");
  assert.equal(getToolCategory("write"), "edit");
  assert.equal(getToolCategory("apply_patch"), "edit");
  assert.equal(getToolCategory("bash"), "terminal");
  assert.equal(getToolCategory("powershell"), "terminal");
  assert.equal(getToolCategory("Agent"), "subagent");
  assert.equal(getToolCategory("compress"), "compact");
  assert.equal(getToolCategory("webfetch"), "web");
});

test("tolerates decorated MCP tool-name variants", () => {
  assert.equal(getToolCategory("mcp__fs.read"), "view");
  assert.equal(getToolCategory("read_file"), "view");
  assert.equal(getToolCategory("server.bash"), "terminal");
  assert.equal(getToolCategory("str_replace_editor"), "edit");
});

test("unknown tools fall back to the other category", () => {
  assert.equal(getToolCategory("quantum_flip"), "other");
});

test("extracts file paths from conventional input keys", () => {
  assert.deepEqual(getToolFilePaths({ path: "/a/b.ts" }), ["/a/b.ts"]);
  assert.deepEqual(getToolFilePaths({ file_path: "/a/b.ts" }), ["/a/b.ts"]);
  assert.deepEqual(getToolFilePaths({ paths: ["/a.ts", "", "/b.ts"] }), ["/a.ts", "/b.ts"]);
  assert.deepEqual(getToolFilePaths({ command: "ls" }), []);
  assert.deepEqual(getToolFilePaths(undefined), []);
});

test("preview prefers command then path-like keys", () => {
  assert.equal(getToolPreviewText({ input: { command: "ls -la" } }), "ls -la");
  assert.equal(getToolPreviewText({ input: { path: "/a/b.ts" } }), "/a/b.ts");
  assert.equal(getToolPreviewText({ input: { pattern: "foo.*bar" } }), "foo.*bar");
});

test("preview stringifies non-primitive values instead of [object Object]", () => {
  const input = { messages: [{ role: "user" }, { role: "assistant" }] };
  assert.equal(getToolPreviewText({ input }), JSON.stringify(input.messages));
  assert.equal(getToolPreviewText({ input: { count: 3 } }), "3");
  assert.equal(getToolPreviewText({ input: { flag: true } }), "true");
});
