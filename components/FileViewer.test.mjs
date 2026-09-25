import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source previews bypass the per-line syntax highlighter", async () => {
  // The source renderer is shared with the git commit diff view.
  const sourceCodeViewSource = await readFile(new URL("./SourceCodeView.tsx", import.meta.url), "utf8");
  assert.match(sourceCodeViewSource, /export const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;/);
  assert.match(sourceCodeViewSource, /const useLightweightSource = sourceLines\.length > SOURCE_HIGHLIGHT_MAX_LINES/);

  // Both source trees are memoized so unrelated re-renders (panel open/close,
  // selection changes) reuse them instead of rebuilding every line element.
  assert.match(sourceCodeViewSource, /const highlightedSource = useMemo\(/);

  const lightweightStart = sourceCodeViewSource.indexOf("const lightweightSourceLines = useMemo(");
  const lightweightEnd = sourceCodeViewSource.indexOf("[sourceLines, useLightweightSource, wrapLines]", lightweightStart);
  assert.notEqual(lightweightStart, -1);
  assert.notEqual(lightweightEnd, -1);

  const lightweightSource = sourceCodeViewSource.slice(lightweightStart, lightweightEnd);
  assert.match(lightweightSource, /useLightweightSource \? sourceLines\.map\(\(line, lineIndex\) =>/);
  assert.match(lightweightSource, /className="file-source-line"/);
  assert.match(lightweightSource, /className="file-source-line-content"/);
  assert.match(lightweightSource, /style=\{FILE_LINE_NUMBER_STYLE\}/);

  // The lightweight tree still wins over the syntax highlighter.
  assert.match(sourceCodeViewSource, /if \(!useLightweightSource\) return highlightedSource;/);
  assert.match(sourceCodeViewSource, /className="file-source-view is-lightweight"/);
});

test("lightweight source rows are skipped for highlighted, diff, and preview views", async () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const sourceCodeViewSource = await readFile(new URL("./SourceCodeView.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("SourceCodeView.tsx", sourceCodeViewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const view = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SourceCodeView");
  const calculations = view.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["sourceLines", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (content, wrapLines = false) => {
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const FILE_LINE_NUMBER_STYLE = {};
      ${calculations}
      return lightweightSourceLines;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", outputText)(React, (calculate) => calculate());
  const large = "line\n".repeat(1_000);

  assert.equal(render("line\n".repeat(999)), null);
  const rows = render(large);
  assert.equal(rows.length, 1_001);
  assert.equal(rows[0].props["data-line-number"], 1);
  assert.equal(rows[0].props.children[1].props.children, "line");
  assert.equal(render(large, true)[0].props.children[1].props.style.whiteSpace, "pre-wrap");

  // Diff and preview modes render their own viewers, so the source rows are
  // only ever reached by the source mode.
  assert.match(source, /effectiveDisplayMode === "diff" && hasGitDiff \? \(\s*<DiffView patch=\{gitDiff\.patch!\} wrapLines=\{wrapLines\} \/>/);
  assert.match(source, /<SourceCodeView content=\{viewerContent\} language=\{language\} wrapLines=\{wrapLines\} \/>/);
});

test("markdown preview links carry page/line fragments", () => {
  assert.match(source, /parseFileOpenOptions/);
  assert.match(source, /onOpenFile\(linkedFile, parseFileOpenOptions\(href\)\)/);
});
