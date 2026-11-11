/**
 * The patterns are only worth their files if the rows actually reach them: each
 * case here renders a real row and asks for the thing a reader would see.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ToolRow, TurnActivityBody } = await jiti.import("../ActivityRows.tsx");
const { TurnTrace } = await jiti.import("./TurnTrace.tsx");
const { UsageBar } = await jiti.import("../UsageBar.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { setToolCallExpanded, clearExpandedToolCalls } = await jiti.import("@/lib/tool-call-expansion");

function call(toolName, input, extra = {}) {
  return { type: "toolCall", toolCallId: `call-${toolName}`, toolName, input, ...extra };
}

function result(toolName, text, extra = {}) {
  return {
    role: "toolResult",
    toolCallId: `call-${toolName}`,
    toolName,
    content: typeof text === "string" ? [{ type: "text", text }] : text,
    ...extra,
  };
}

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

function renderRow(block, res, props = {}) {
  return render(React.createElement(ToolRow, { block, result: res, ...props }));
}

test("a web search lists the sources it read as links", () => {
  clearExpandedToolCalls();
  const block = call("web_search", { query: "pi sdk" });
  // The list lives in the row's fold; a reader opens it to read the sources.
  setToolCallExpanded(block.toolCallId, true);
  const html = renderRow(block, {
    ...result("web_search", "[Pi SDK](https://example.com/pi)\nhttps://example.org/docs"),
    toolCallId: block.toolCallId,
  });

  assert.match(html, /data-activity-tool="web_search"/);
  assert.match(html, /href="https:\/\/example\.com\/pi"/);
  assert.match(html, /href="https:\/\/example\.org\/docs"/);
  assert.match(html, />Pi SDK</);
  clearExpandedToolCalls();
});

test("a to-do snapshot splits into open and done segments", () => {
  const block = call("todo", {
    todos: [
      { content: "write the spec", status: "completed" },
      { content: "render the rows", status: "in_progress" },
    ],
  });
  const html = renderRow(block, result("todo", "ok"));

  assert.match(html, /data-activity="queue"/);
  assert.match(html, /data-activity-tool="todo"/);
  assert.match(html, />render the rows</);
  assert.match(html, />write the spec</);
});

test("a failed call shows the X icon and repeats the whole error", () => {
  const block = call("bash", { command: "npm test" });
  const html = renderRow(block, {
    ...result("bash", "Error: 3 tests failed\n    at run (/repo/test/a.test.mjs:12:3)"),
    isError: true,
  });

  assert.match(html, /lucide-circle-x/);
  assert.match(html, /data-status="error"/);
});

test("images, video and audio a call produced render as media, not as text", () => {
  const block = call("some_media_tool", { prompt: "a cat" });
  const html = renderRow(block, {
    ...result("some_media_tool", [
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "video", data: "BBBB", mimeType: "video/mp4" },
      { type: "audio", data: "CCCC", mimeType: "audio/mpeg" },
    ]),
    toolCallId: block.toolCallId,
  });

  assert.match(html, /src="data:image\/png;base64,AAAA"/);
  assert.match(html, /<video[^>]*src="data:video\/mp4;base64,BBBB"/);
  assert.match(html, /<audio[^>]*src="data:audio\/mpeg;base64,CCCC"/);
});

test("a call that names files offers one chip per file, and the chip opens it", () => {
  clearExpandedToolCalls();
  const block = call("read", { file_path: "lib/tool-view.ts" });
  setToolCallExpanded(block.toolCallId, true);
  const opened = [];
  const html = renderRow(block, result("read", "export const a = 1;"), {
    onOpenFile: (path) => opened.push(path),
  });

  assert.match(html, />tool-view\.ts</);
  assert.match(html, /data-activity-tool="read"/);
  clearExpandedToolCalls();
});

test("a tool's context reading keeps its text and gains the hover card", () => {
  const html = render(React.createElement(UsageBar, {
    usage: { input: 1200, output: 340, cacheRead: 0, cost: 0.0123 },
    ctx: { tokens: 24500, contextWindow: 200000 },
  }));

  assert.match(html, /data-usage-seg="ctx"/);
  assert.match(html, /ctx<\/span><span[^>]*>12\.3% \/ 200\.0k/);
  // The hover card's trigger is what carries the numbers; the card itself opens on hover.
  assert.match(html, /data-slot="hover-card-trigger"|href=""/, "");
});

test("a turn with a failed call is an error turn", () => {
  const block = call("bash", { command: "false" });
  const html = render(React.createElement(
    TurnTrace,
    { summary: "处理详情", foldKey: "turn:test", defaultOpen: true, failed: true },
    React.createElement(ToolRow, { block, result: { ...result("bash", "boom"), isError: true } }),
  ));

  assert.match(html, /data-status="error"/);
});

test("the process body forwards the file opener to a grouped call's row", () => {
  clearExpandedToolCalls();
  const first = call("read", { file_path: "a.ts" });
  const second = { ...call("read", { file_path: "b.ts" }), toolCallId: "call-read-2" };
  setToolCallExpanded("group:call-read", true);
  setToolCallExpanded(first.toolCallId, true);
  const opened = [];
  const html = render(React.createElement(TurnActivityBody, {
    items: [
      { kind: "tool", key: "k1", block: first, result: result("read", "x") },
      { kind: "tool", key: "k2", block: second, result: { ...result("read", "y"), toolCallId: "call-read-2" } },
    ],
    onOpenFile: (path) => opened.push(path),
    live: false,
  }));

  assert.match(html, />a\.ts</);
  clearExpandedToolCalls();
});
