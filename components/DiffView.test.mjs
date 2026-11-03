import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DiffView.tsx", import.meta.url), "utf8");

test("DiffView parses unified patches through the shared parser", () => {
  assert.match(source, /import \{ parseUnifiedPatch \} from "@\/lib\/patch";/);
  assert.match(source, /const files = parseUnifiedPatch\(patch\);/);
});

test("DiffView renders added/removed lines with tinted rows and line numbers", () => {
  assert.match(source, /file-diff-view min-w-full/);
  assert.match(source, /file-diff-line flex min-w-full border-l-\[3px\]/);
  // Added/removed rows take the diff tokens (globals.css); unchanged rows stay
  // on the view's own background with a dim marker.
  assert.match(source, /bg-diff-add-bg border-l-diff-add text-diff-add/);
  assert.match(source, /bg-diff-del-bg border-l-diff-del text-diff-del/);
  assert.match(source, /border-l-transparent text-dim/);
  assert.match(source, /line\.type === "removed" \? line\.oldLineNo : line\.newLineNo/);
});

test("DiffView collapses unchanged regions around 3 lines of context", () => {
  assert.match(source, /const CONTEXT = 3;/);
  assert.match(source, /unchanged lines/);
});

test("DiffView shows an empty state when a patch has no changes", () => {
  assert.match(source, /i18n\.noChanges/);
});
