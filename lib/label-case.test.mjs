import assert from "node:assert/strict";
import test from "node:test";

import { displayLabel } from "./label-case.ts";

test("one word gets a capital first letter", () => {
  assert.equal(displayLabel("goal"), "Goal");
  assert.equal(displayLabel("build"), "Build");
});

test("an initials token is all caps", () => {
  assert.equal(displayLabel("mcp"), "MCP");
  assert.equal(displayLabel("ssh"), "SSH");
  assert.equal(displayLabel("lsp"), "LSP");
});

test("text that is already cased keeps its casing", () => {
  assert.equal(displayLabel("YOLO"), "YOLO");
  assert.equal(displayLabel("Build"), "Build");
  assert.equal(displayLabel("/mode toggle"), "/mode toggle");
});

test("translated text is never re-cased", () => {
  assert.equal(displayLabel("插件状态"), "插件状态");
  assert.equal(displayLabel("模式"), "模式");
});

test("whitespace is trimmed, empty stays empty", () => {
  assert.equal(displayLabel("  goal  "), "Goal");
  assert.equal(displayLabel("   "), "");
});
