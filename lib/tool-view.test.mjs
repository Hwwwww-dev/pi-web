import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { toToolView, humanizeToolName, countDiffLines, resultSources, getWrittenFileText } = await jiti.import("./tool-view.ts");

/** Stands in for the translator: the key plus its parameters, so a title can be asserted. */
const t = (key, params) => (params ? `${key}(${Object.values(params).join(",")})` : key);

const call = (toolName, input, extra = {}) => ({ type: "toolCall", toolCallId: `call-${toolName}`, toolName, input, ...extra });
const result = (text, extra = {}) => ({
  role: "toolResult",
  toolCallId: "call",
  content: [{ type: "text", text }],
  ...extra,
});
const view = (block, res) => toToolView({ block, result: res, t });
const kinds = (v) => v.sections.map((section) => section.kind);

test("bash is a terminal row: the command is the title, the output the section", () => {
  const v = view(
    call("bash", { command: "pnpm build" }),
    result("built in 1.2s"),
  );
  assert.equal(v.kind, "terminal");
  assert.match(v.title, /^chat\.trace\.ran\(pnpm build\)$/);
  assert.equal(v.command, "pnpm build");
  assert.deepEqual(kinds(v), ["code"]);
  assert.equal(v.sections[0].text, "built in 1.2s");
});

test("a multi-line command names the row with its first line and keeps the whole text", () => {
  const v = view(call("bash", { command: "cat <<EOF\nhello\nEOF" }), result("hello"));
  assert.match(v.title, /cat <<EOF/);
  assert.equal(v.command, "cat <<EOF\nhello\nEOF");
});

test("read is a file row titled with the file name", () => {
  const v = view(call("read", { path: "lib/tool-view.ts" }), result("export {}"));
  assert.equal(v.kind, "file-read");
  assert.match(v.title, /^chat\.trace\.read\(tool-view\.ts\)$/);
  assert.deepEqual(v.filePaths, ["lib/tool-view.ts"]);
});

test("write shows the file it writes instead of its JSON", () => {
  const v = view(call("write", { path: "a/b.md", content: "# hi" }), result("wrote 4 bytes"));
  assert.equal(v.kind, "file-write");
  assert.deepEqual(kinds(v), ["code", "code"]);
  assert.equal(v.sections[0].text, "# hi");
  assert.equal(v.sections[0].label, "parameters");
});

test("an edit shows the result's patch and counts its lines", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "@@", "-old", "+new", "+more"].join("\n");
  const v = view(call("edit", { path: "x.ts", old_string: "old", new_string: "new" }), result("ok", { details: { patch } }));
  assert.equal(v.kind, "file-edit");
  assert.match(v.title, /^chat\.trace\.edited\(x\.ts\)$/);
  assert.deepEqual(kinds(v), ["diff"]);
  assert.deepEqual(v.diffStat, { added: 2, removed: 1 });
});

test("a multi-file patch gets one diff section per file, and a count title", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: a/one.ts",
    "+export const one = 1",
    "*** Update File: a/two.ts",
    "-export const two = 2",
    "+export const two = 3",
    "*** End Patch",
  ].join("\n");
  const v = view(call("apply_patch", { input: patch }), result("applied"));
  assert.equal(v.kind, "file-edit");
  assert.match(v.title, /^chat\.trace\.editedFiles\(2\)$/);
  assert.equal(v.sections[0].kind, "diff");
  assert.equal(v.sections[0].files.length, 2);
  assert.equal(v.diffStat, undefined);
});

test("grep is a search row naming its pattern", () => {
  const v = view(call("grep", { pattern: "TODO", path: "lib" }), result("lib/a.ts:3: TODO"));
  assert.equal(v.kind, "search");
  assert.match(v.title, /^chat\.trace\.searched\(TODO\)$/);
});

test("a web search lists the URLs it found", () => {
  const text = "See [the docs](https://example.com/docs) and https://example.com/docs, plus https://other.test/x.";
  const v = view(call("web_search", { query: "pi docs" }), result(text));
  assert.equal(v.kind, "web");
  assert.match(v.title, /^chat\.trace\.sources\(2\)$/);
  assert.deepEqual(v.sources.map((source) => source.url), ["https://example.com/docs", "https://other.test/x"]);
  assert.equal(v.sources[0].title, "the docs");
  assert.equal(v.sections.length, 0);
});

test("a codemode script shows the script, then the calls it made", () => {
  const v = view(
    call("codemode", { code: "const a = await tools.read({path:'x'})" }),
    result("done", { details: { calls: [{ id: "1", name: "read", args: "{}", status: "ok", durationMs: 12 }], omittedCalls: 0 } }),
  );
  assert.equal(v.kind, "codemode");
  assert.match(v.title, /^chat\.trace\.script$/);
  assert.deepEqual(kinds(v).slice(0, 2), ["code", "steps"]);
  assert.equal(v.sections[1].steps[0].title, "read");
  assert.equal(v.sections[1].steps[0].status, "done");
});

test("an MCP call is titled server/tool and never shows the registered name", () => {
  const v = view(
    call("mcp__docs__search", { query: "x" }),
    result("hit", { details: { server: "docs", tool: "search" } }),
  );
  assert.equal(v.kind, "mcp");
  assert.match(v.title, /^docs\/search$/);
});

test("a to-do tool lists its items, split by status", () => {
  const v = view(
    call("todo", { todos: [{ content: "first", status: "completed" }, { content: "second", status: "in_progress" }] }),
  );
  assert.equal(v.kind, "queue");
  assert.match(v.title, /^chat\.trace\.todoOpen\(1\)$/);
  assert.deepEqual(v.sections[0].steps.map((step) => step.status), ["done", "running"]);
});

test("an unknown tool gets a humanized title instead of raw JSON", () => {
  const v = view(call("get_search_content", { query: "x" }, { rawInput: undefined }));
  assert.equal(v.kind, "generic");
  assert.equal(v.title, "Get search content");
  assert.equal(v.sections[0].label, "parameters");
});

test("streamed input is announced, not rendered as incomplete JSON", () => {
  const v = view(call("read", {}, { rawInput: '{"pa' }));
  assert.equal(v.streamingInput, true);
  assert.equal(v.sections.length, 0);
});

test("an empty or absent result adds no section", () => {
  assert.equal(view(call("read", { path: "a.ts" }), result("")).sections.length, 1);
  assert.equal(view(call("bash", { command: "true" }), result("(no output)")).sections.length, 0);
  assert.equal(view(call("bash", { command: "true" })).sections.length, 0);
});

test("a failed result is an error row carrying the first line of the output", () => {
  const v = view(call("bash", { command: "false" }), result("boom: broken\nstack line", { isError: true }));
  assert.equal(v.status, "error");
  assert.equal(v.error, "boom: broken");
});

test("a failed apply_patch result is an error even when pi does not mark it", () => {
  const v = view(
    call("apply_patch", { input: "*** Begin Patch\n*** End Patch" }),
    result("2 failures", { details: { result: { failures: ["a.ts"] } } }),
  );
  assert.equal(v.status, "error");
});

test("counts a patch's added and removed lines, skipping the file headers", () => {
  assert.deepEqual(countDiffLines("--- a\n+++ b\n+x\n-y\n-y2"), { added: 1, removed: 2 });
});

test("a write is only read as file text when it carries nothing but path and content", () => {
  assert.equal(getWrittenFileText(call("write", { path: "a", content: "# hi" })), "# hi");
  assert.equal(getWrittenFileText(call("write", { path: "a", content: "# hi", mode: "append" })), null);
});

test("humanize turns a decorated name into a sentence", () => {
  assert.equal(humanizeToolName("get_subagent_result"), "Get subagent result");
  assert.equal(humanizeToolName("mcp__docs__searchDocs"), "Search Docs");
});

test("resultSources keeps the text's order and drops Markdown punctuation", () => {
  assert.deepEqual(resultSources("[a](https://a.test/x), [b](https://b.test/y)").map((s) => s.title), ["a", "b"]);
  assert.deepEqual(resultSources("plain").length, 0);
});
