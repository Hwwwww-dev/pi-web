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
  // Rows are the official CodeBlock lines: the gutter, tint and ::after marker
  // live in codeBlockLineVariants now; DiffView only picks the variant per
  // line type and lays the row out with its own class.
  assert.match(
    source,
    /variant=\{line\.type === "added" \? "added" : line\.type === "removed" \? "removed" : "default"\}/,
  );
  assert.match(source, /className="file-diff-line flex min-w-full"/);
  // The +/- marker column colors itself; the variant tint carries the row.
  assert.match(source, /line\.type === "added" && "text-success"/);
  assert.match(source, /line\.type === "removed" && "text-destructive"/);
  assert.match(source, /line\.type === "removed" \? line\.oldLineNo : line\.newLineNo/);
  // Collapsed hunks take the highlighted variant, marker column dropped.
  assert.match(source, /variant="highlighted"\s+className="flex min-w-full items-center py-0\.5 font-sans text-xs text-muted-foreground after:content-none"/);
});

test("DiffView collapses unchanged regions around 3 lines of context", () => {
  assert.match(source, /const CONTEXT = 3;/);
  assert.match(source, /unchanged lines/);
});

test("DiffView shows an empty state when a patch has no changes", () => {
  assert.match(source, /i18n\.noChanges/);
});
