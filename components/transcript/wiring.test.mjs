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
const { SubagentTrace } = await jiti.import("./SubagentTrace.tsx");
const { isFailedResult } = await jiti.import("@/lib/tool-view");
const { resolveLocalFilePath } = await jiti.import("@/lib/file-links");
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

test("a to-do snapshot renders as the Plan pattern", () => {
  const block = call("todo", {
    todos: [
      { content: "write the spec", status: "completed" },
      { content: "render the rows", status: "in_progress" },
    ],
  });
  const html = renderRow(block, result("todo", "ok"));

  assert.match(html, /data-activity-tool="todo"/);
  // The row names the task in progress, never the raw arguments (第 4.2 节).
  assert.match(html, /Plan: render the rows/);
  assert.match(html, /1 \/ 2/);
  assert.match(html, />write the spec</);
  assert.doesNotMatch(html, /&quot;todos&quot;/);
});

test("a failed call shows the X icon and repeats the whole error", () => {
  clearExpandedToolCalls();
  const block = call("edit", { file_path: "a.ts" });
  setToolCallExpanded(block.toolCallId, true);
  const html = renderRow(block, {
    ...result("edit", "Error: 3 tests failed\n    at run (/repo/test/a.test.mjs:12:3)"),
    isError: true,
  });

  assert.match(html, /lucide-circle-x/);
  assert.match(html, /data-status="error"/);
  assert.match(html, /Error: 3 tests failed/);
  clearExpandedToolCalls();
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

test("the usage line carries no ctx segment — the top bar owns the context reading", () => {
  const html = render(React.createElement(UsageBar, {
    usage: { input: 1200, output: 340, cacheRead: 0, cost: 0.0123 },
  }));

  assert.doesNotMatch(html, /data-usage-seg="ctx"/);
  assert.match(html, /data-usage-seg="in"/);
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

test("a grouped call's chip resolves against the session cwd too", () => {
  clearExpandedToolCalls();
  const first = call("custom_tool", { file_path: "lib/a.ts" });
  const second = { ...call("custom_tool", { file_path: "lib/b.ts" }), toolCallId: "call-custom_tool-2" };
  setToolCallExpanded(`group:${first.toolCallId}`, true);
  const html = render(React.createElement(TurnActivityBody, {
    items: [
      { kind: "tool", key: "k1", block: first, result: { ...result("custom_tool", "x") } },
      { kind: "tool", key: "k2", block: second, result: { ...result("custom_tool", "y"), toolCallId: "call-custom_tool-2" } },
    ],
    cwd: "/repo/pi-web",
    onOpenFile: () => {},
    live: false,
  }));

  // 分组行同样需要 cwd，否则 chip 退化为不可点击的静态文本。
  assert.match(html, /title="\/repo\/pi-web\/lib\/a\.ts"/);
  assert.match(html, /title="\/repo\/pi-web\/lib\/b\.ts"/);
  // chip 使用官方胶囊按钮（第 4 节），非自绘 span。
  assert.match(html, /data-slot="button"[^>]*rounded-full/);
  clearExpandedToolCalls();
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

test("a failed command keeps its command header and copy button, and says what failed", () => {
  clearExpandedToolCalls();
  const block = call("bash", { command: "npm test" });
  setToolCallExpanded(block.toolCallId, true);
  const html = renderRow(block, { ...result("bash", "boom"), isError: true });

  // The failed row keeps the command on its header; the wording is localized, so
  // assert the command itself instead of the label.
  assert.match(html, /npm test/);
  assert.match(html, /\$ npm test/);
  assert.match(html, /aria-label="Copy"|Copy/);
  assert.match(html, /data-activity-tool="bash"/);
  clearExpandedToolCalls();
});

test("a running command says it is running", () => {
  const block = call("bash", { command: "pnpm build" });
  const html = renderRow(block, undefined, { isStreaming: true });

  assert.match(html, /pnpm build/);
  assert.match(html, /data-status="running"/);
});

test("a relative path chip resolves against the session cwd", () => {
  clearExpandedToolCalls();
  // 仅当标题不含文件名时，chip 才有存在意义。
  const block = call("custom_tool", { file_path: "lib/tool-view.ts" });
  const html = renderRow(block, result("custom_tool", "x"), { cwd: "/repo/pi-web", onOpenFile: () => {} });

  assert.match(html, /title="\/repo\/pi-web\/lib\/tool-view\.ts"/);
  assert.equal(resolveLocalFilePath("lib/tool-view.ts", "/repo/pi-web"), "/repo/pi-web/lib/tool-view.ts");
});

test("a file row shows the name once, in the chip that opens it", () => {
  clearExpandedToolCalls();
  const block = call("read", { file_path: "probe-label.png" });
  const html = renderRow(block, result("read", "x"), { cwd: "/repo/pi-web", onOpenFile: () => {} });

  // 标题只写动作（Read），文件名由 chip 承担，且可点击跳转。
  assert.match(html, /aria-label="Read"/);
  assert.match(html, /data-slot="button"[^>]*rounded-full/);
  assert.match(html, /title="\/repo\/pi-web\/probe-label\.png"/);
  // 标题与描述均不重复文件名，仅由 chip 承担。
  assert.doesNotMatch(html, /data-slot="trace-title"[^>]*>probe-label\.png/);
  assert.doesNotMatch(html, /data-slot="trace-description"[^>]*>probe-label\.png/);
});

test("section labels are translated, never the raw key", () => {
  clearExpandedToolCalls();
  const block = call("read", { file_path: "a.ts" });
  setToolCallExpanded(block.toolCallId, true);
  const html = renderRow(block, result("read", "export const a = 1;"));

  // A single-section fold shows the code itself; when a label is rendered it comes
  // from the message catalog (`chat.activity.parameters`), never the raw key.
  assert.match(html, /data-slot="code-block"/);
  assert.doesNotMatch(html, />parameters</);
  assert.doesNotMatch(html, />result</);
  assert.doesNotMatch(html, /chat\.activity\./);
  clearExpandedToolCalls();
});

test("code bodies go through the Prism highlighter", () => {
  clearExpandedToolCalls();
  const block = call("read", { file_path: "a.ts" });
  setToolCallExpanded(block.toolCallId, true);
  const html = renderRow(block, result("read", "export const a = 1;"));

  assert.match(html, /data-slot="highlighted-code"/);
  clearExpandedToolCalls();
});

test("terminal output keeps its own line breaks", () => {
  clearExpandedToolCalls();
  const block = call("bash", { command: "npm test" });
  setToolCallExpanded(block.toolCallId, true);
  const html = renderRow(block, { ...result("bash", "line one\nline two"), isError: true });

  // 第 8 节第 8 条：终端输出不 reflow，其内容块未设置 wrap 属性。
  assert.equal((html.match(/data-wrap=""/g) ?? []).length, 0);
  assert.match(html, /line one/);
  clearExpandedToolCalls();
});

test("an applied patch that reported failures counts as a failed call", () => {
  const applied = { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "applied" }], details: { result: { failures: [{ path: "a.ts" }] } } };

  assert.equal(isFailedResult("apply_patch", applied), true);
  assert.equal(isFailedResult("read", applied), false);
  assert.equal(isFailedResult("read", { ...applied, isError: true }), true);
});

test("a sub-agent row lists the steps it recorded", () => {
  setToolCallExpanded("sub:test", true);
  const html = render(React.createElement(SubagentTrace, {
    foldKey: "sub:test",
    label: "explore",
    status: "done",
    report: "the cache is keyed on the commit SHA",
    steps: [
      { title: "Ran grep -rn cacheKey scripts", status: "done" },
      { title: "Read lib/cache.ts", status: "done" },
    ],
  }));

  assert.match(html, /Ran grep -rn cacheKey scripts/);
  assert.match(html, /Read lib\/cache\.ts/);
  clearExpandedToolCalls();
});
