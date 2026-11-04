import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DiffView.tsx", import.meta.url), "utf8");

test("DiffView parses unified patches through the shared parser", () => {
  assert.match(source, /import \{ parseUnifiedPatch \} from "@\/lib\/patch";/);
  assert.match(source, /const files = parseUnifiedPatch\(patch\);/);
});

test("DiffView renders added/removed lines with the official CodeBlock line variants", () => {
  assert.match(source, /file-diff-view min-w-full/);
  // Rows are the vendored CodeBlock lines: the shared line class carries the
  // gutter layout, the variant carries the tint; the variant's absolute ::after
  // marker is dropped for the aligned marker column.
  assert.match(source, /cn-code-block-line file-diff-line flex min-w-full after:content-none/);
  assert.match(source, /cn-code-block-line-variant-added/);
  assert.match(source, /cn-code-block-line-variant-removed/);
  // Unchanged rows stay on the view's own background, no variant.
  assert.match(source, /rowTone = line\.type === "added"/);
  assert.match(source, /line\.type === "removed" \? line\.oldLineNo : line\.newLineNo/);
  // Collapsed hunks take the highlighted variant.
  assert.match(source, /cn-code-block-line-variant-highlighted/);
});

test("DiffView collapses unchanged regions around 3 lines of context", () => {
  assert.match(source, /const CONTEXT = 3;/);
  assert.match(source, /unchanged lines/);
});

test("DiffView shows an empty state when a patch has no changes", () => {
  assert.match(source, /i18n\.noChanges/);
});
