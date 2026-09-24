import assert from "node:assert/strict";
import test from "node:test";

import { inlineCodeFilePath, inlineCodeLineSuffix } from "./markdown.ts";

test("accepts absolute and relative paths with an extension", () => {
  assert.equal(inlineCodeFilePath("/abs/path/file.ts"), "/abs/path/file.ts");
  assert.equal(inlineCodeFilePath("hooks/useAgentSession.ts"), "hooks/useAgentSession.ts");
  assert.equal(inlineCodeFilePath("./components/ChatInput.tsx"), "./components/ChatInput.tsx");
  assert.equal(inlineCodeFilePath("~/notes/todo.md"), "~/notes/todo.md");
  assert.equal(inlineCodeFilePath("C:\\repo\\app\\main.py"), "C:\\repo\\app\\main.py");
  assert.equal(inlineCodeFilePath("//host/share/doc.pdf"), "//host/share/doc.pdf");
});

test("strips a trailing line / line:column suffix", () => {
  assert.equal(inlineCodeFilePath("lib/main.ts:120"), "lib/main.ts");
  assert.equal(inlineCodeFilePath("lib/main.ts:120:8"), "lib/main.ts");
  const both = inlineCodeLineSuffix("lib/main.ts:120:8");
  assert.equal(both.line, 120);
  assert.equal(both.column, 8);
  const onlyLine = inlineCodeLineSuffix("lib/main.ts:120");
  assert.equal(onlyLine.line, 120);
  assert.equal(onlyLine.column, undefined);
  assert.equal(inlineCodeLineSuffix("lib/main.ts"), null);
});

test("rejects non-path inline code", () => {
  assert.equal(inlineCodeFilePath("index0f"), null);
  assert.equal(inlineCodeFilePath("t(\"chat.cancel\")"), null);
  assert.equal(inlineCodeFilePath("npm run dev"), null);
  assert.equal(inlineCodeFilePath("README.md"), null); // bare filename, no separator
  assert.equal(inlineCodeFilePath("https://example.com/a.ts"), null);
  assert.equal(inlineCodeFilePath("foo"), null);
  assert.equal(inlineCodeFilePath(""), null);
  assert.equal(inlineCodeFilePath("a b/c.ts"), null);
  assert.equal(inlineCodeFilePath("lib/main.ts:abc"), null); // suffix must be digits
});
