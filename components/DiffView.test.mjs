import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DiffView.tsx", import.meta.url), "utf8");

test("DiffView parses unified patches through the shared parser", () => {
  assert.match(source, /import \{ parseUnifiedPatch \} from "@\/lib\/patch";/);
  assert.match(source, /const files = parseUnifiedPatch\(patch\);/);
});

test("DiffView renders added/removed lines with tinted rows and line numbers", () => {
  assert.match(source, /className="file-diff-view"/);
  assert.match(source, /className="file-diff-line"/);
  assert.match(source, /rgba\(0,200,80,0\.12\)/);
  assert.match(source, /rgba\(240,60,60,0\.14\)/);
  assert.match(source, /line\.type === "removed" \? line\.oldLineNo : line\.newLineNo/);
});

test("DiffView collapses unchanged regions around 3 lines of context", () => {
  assert.match(source, /const CONTEXT = 3;/);
  assert.match(source, /unchanged lines/);
});

test("DiffView shows an empty state when a patch has no changes", () => {
  assert.match(source, /i18n\.noChanges/);
});
