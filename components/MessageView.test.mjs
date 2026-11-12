import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  AssistantMessageHeader,
  CompactionSummaryDetails,
  MessageView,
  getModelDisplayName,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
} = await jiti.import("./MessageView.tsx");
const { PatchDiffFiles } = await jiti.import("./PatchDiffFiles.tsx");
const { ReasoningTrace } = await jiti.import("./transcript/ReasoningTrace.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { splitFinalAssistantBlocks } = await jiti.import("@/lib/message-display");
const { clearExpandedToolCalls, setToolCallExpanded } = await jiti.import("@/lib/tool-call-expansion");
const { parseUnifiedPatch } = await jiti.import("@/lib/patch");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

test("updates a reused message when its written files change", () => {
  const props = { message: { role: "assistant", content: [] } };
  assert.equal(MessageView.compare(props, props), true);
  assert.equal(MessageView.compare(props, { ...props, writtenFiles: [{ path: "/tmp/result.txt" }] }), false);
});

test("a message's actions are icon-only and keep their titles", () => {
  const html = renderMessage({ role: "user", content: "Hi", timestamp: 1 }, { entryId: "entry", onFork: () => {}, onEditContent: () => {} });
  assert.ok(!html.includes("message-action-label"));
  for (const title of ["Copy message", "Edit from here — branches within this session", "New session — creates an independent copy from here"]) {
    assert.ok(html.includes(`title="${title}"`), title);
  }
});

test("streaming headers preserve counts and speed without showing empty metrics", () => {
  const renderHeader = (props) => renderToStaticMarkup(React.createElement(
    I18nProvider, null, React.createElement(AssistantMessageHeader, { modelName: "Test Model", ...props }),
  ));
  for (const props of [{}, { estimatedTokens: 0, tps: 20 }]) {
    const html = renderHeader(props);
    assert.match(html, />Test Model<\/span>/);
    assert.doesNotMatch(html, /t\/s|Estimated token count while streaming/);
  }
  const tokensOnly = renderHeader({ estimatedTokens: 100 });
  assert.match(tokensOnly, />100<\/span>/);
  assert.doesNotMatch(tokensOnly, /t\/s/);
  const streaming = renderHeader({ estimatedTokens: 1234567, tps: 12345.6 });
  assert.match(streaming, />1234567<\/span>/);
  assert.match(streaming, /12345\.6 t\/s/);

  const message = { role: "assistant", provider: "test", model: "model", content: [{ type: "text", text: "Response" }] };
  const complete = renderMessage(message);
  assert.doesNotMatch(complete, /Estimated token count while streaming/);
  assert.match(renderMessage(message, { isStreaming: true }), /Estimated token count while streaming/);
});

test("matches response model aliases and otherwise includes the provider", () => {
  const names = {
    "gateway:claude-sonnet-5": "Sonnet 5",
    "custom-api:GLM-5.3": "GLM 5.3",
  };

  assert.equal(getModelDisplayName("gateway", "anthropic/claude-sonnet-5", names), "Sonnet 5");
  assert.equal(getModelDisplayName("CUSTOM-API", "glm-5.3", names), "GLM 5.3");
  assert.equal(getModelDisplayName("gateway", "unknown-model", names), "gateway/unknown-model");
});

test("keeps a thought to its name and duration, and reveals the full text with the saved default", () => {
  const previousWindow = globalThis.window;
  try {
    for (const expanded of [false, true]) {
      globalThis.window = { localStorage: { getItem: () => String(expanded) } };
      const html = renderToStaticMarkup(React.createElement(
        I18nProvider,
        null,
        React.createElement(ReasoningTrace, {
          block: { type: "thinking", thinking: "**Independent reasoning**\n\nDetailed second line." },
          blockIndex: 2,
          duration: 3,
        }),
      ));
      assert.match(html, new RegExp(`aria-expanded="${expanded}"`));
      // The trace prints the same "3.0s" the tool rows do.
      assert.match(html, /3\.0s/);
      if (expanded) {
        assert.ok(html.includes("Detailed second line."));
      } else {
        assert.doesNotMatch(html, /Detailed second line/);
      }
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("long thinking renders in pages instead of one DOM blob (#1196)", () => {
  // Thinking bodies load through ReasoningTrace's deferred pagination
  // (loadThinkingContent): a historical block's body arrives page by page, so an
  // expanded 2_000-line block never lands in the DOM at once.
  const source = ts.createSourceFile("ActivityRows.tsx", readFileSync(new URL("./ActivityRows.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  (function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === "ReasoningTrace") {
      const props = node.attributes.properties.map((attribute) => (ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : null));
      calls.push(props);
    }
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(calls.length >= 1, "ReasoningTrace renders the thinking blocks");
  for (const props of calls) {
    assert.ok(props.includes("sessionId") && props.includes("entryId"), "each row loads its body through the deferred pages");
  }
  assert.match(readFileSync(new URL("./transcript/ReasoningTrace.tsx", import.meta.url), "utf8"), /loadThinkingContent/);
});

test("a collapsed thought is one line: its name, never its text (official reasoning row)", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "Historical first line", deferred: true }],
  });
  assert.doesNotMatch(html, /Historical first line/);
  assert.match(html, /aria-expanded="false"/);
});

test("keys an assistant message's blocks by their place, not the entry id (#1184)", () => {
  // A message of the running turn gets its entry id when the file is read again.
  // A block keyed by it remounted then: open thinking closed, a tool output's
  // scroll went back to the top. ThinkingBlock drops what it loaded for another id.
  const source = ts.createSourceFile("MessageView.tsx", readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys = [];
  (function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === "BlockView") {
      const key = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "key");
      keys.push(key?.initializer?.expression?.getText(source));
    }
    ts.forEachChild(node, visit);
  })(source);
  assert.deepEqual(keys, ["originalIndex"]);
});

test("marks only the matched text block after splitting thinking and the final answer", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "Thinking about the result" },
      { type: "text", text: "Process text" },
      { type: "toolCall", toolCallId: "read-1", toolName: "read", input: {} },
      { type: "text", text: "First answer" },
      { type: "text", text: "Matched pi-cwd-spark answer" },
    ],
  };
  const { processBlocks, answerBlocks } = splitFinalAssistantBlocks(message);
  for (const index of [2, 4, 5]) {
    const searchBlock = message.content[index];
    for (const content of [processBlocks, answerBlocks]) {
      const html = renderMessage({ ...message, content }, { searchBlock });
      assert.equal((html.match(/data-search-target="true"/g) ?? []).length, content.includes(searchBlock) ? 1 : 0);
      if (content.includes(searchBlock)) {
        assert.match(html, new RegExp(`data-search-target="true">(?:(?!data-message-text)[\\s\\S])*${searchBlock.text}`));
      }
    }
  }
});

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});




test("a nested argument becomes rows, one per leaf: a row cannot hold a subtree", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-mcp-nested",
    toolName: "mcp__issues__search",
    input: { query: "open bugs", filter: { labels: ["bug"], assignee: "me" }, limit: 10 },
  };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
    const text = textOf(html);
    assert.ok(!html.includes('flex min-w-0 flex-col gap-0.5 font-mono wrap-anywhere'));
    // 叶子各自一行，路径写成 `filter.labels[0]`：表格的一行装不下子树。
    assert.ok(text.includes("filter.labels[0]"));
    assert.ok(text.includes("filter.assignee"));
    assert.ok(!text.includes('"filter"'));
  } finally {
    clearExpandedToolCalls();
  }
});

test("an edit call shows no table: its arguments are a list of patches", () => {
  const input = {
    path: "src/app/page.tsx",
    edits: [{ oldText: "const a = 1", newText: "const a = 2" }],
  };
  const block = { type: "toolCall", toolCallId: "call-edit-nested", toolName: "edit", input };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
    assert.ok(!html.includes('flex min-w-0 flex-col gap-0.5 font-mono wrap-anywhere'));
  } finally {
    clearExpandedToolCalls();
  }
});





const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("a reply's usage line reads like pi's TUI footer, then the turn's time", () => {
  const usage = { input: 1_234, output: 567, cacheRead: 85_312, cacheWrite: 12, cost: { total: 0.00362 } };
  const html = renderMessage(
    { role: "assistant", provider: "anthropic", model: "claude-test", content: [{ type: "text", text: "Done." }], stopReason: "stop", usage },
    { turnDurationMs: 10_000 },
  );
  // The arrows and the clock are drawn as lucide SVG; their characters and
  // words stay as font-size 0 text, so a copied selection reads like the footer.
  assert.equal(html.match(/lucide-(arrow-up|arrow-down|clock) /g)?.length, 3);
  const text = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<span class="sr-only">([^<]*)<\/span>/g, "$1");
  // Each count is its own span; the spaces between them stay in the text.
  assert.match(text, /<span>↑1\.2k<\/span> <span>↓567<\/span> <span>R85k<\/span> <span>W12<\/span> <span>\$0\.0036<\/span> <span>·<\/span> <span>took 10s<\/span>/);
  // Zero counts are left out, as in the footer.
  const bare = renderMessage({
    role: "assistant", provider: "anthropic", model: "claude-test", content: [{ type: "text", text: "Done." }], stopReason: "stop",
    usage: { input: 12_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
  });
  assert.match(bare.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<span class="sr-only">([^<]*)<\/span>/g, "$1"), /<span>↑12M<\/span><\/div>/);
});

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders a truncation notice for stopReason length", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "thinking", thinking: "Long reasoning chain" }],
    stopReason: "length",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /output limit was reached before an answer/i);
  assert.doesNotMatch(html, /follow-up/i);
});

test("keeps the follow-up hint when a truncated response already has text", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "text", text: "Partial answer" }],
    stopReason: "length",
  });

  assert.match(html, /Partial answer/);
  assert.match(html, /follow-up/i);
  assert.doesNotMatch(html, /Compact context/);
});

test("offers compaction on an unanswered truncation and keeps its error with the reply", () => {
  let compacted = 0;
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [],
    stopReason: "length",
  }, {
    onCompact: () => { compacted += 1; },
    compactError: "Summarization failed: generation hit the token cap",
  });

  assert.match(html, /Compact context/);
  assert.match(html, /generation hit the token cap/);
  assert.equal(compacted, 0);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("marks persisted assistant messages with their source entry", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Select this response" }],
  }, { entryId: "assistant-entry" });

  assert.match(html, /data-message-role="assistant"/);
  assert.match(html, /data-entry-id="assistant-entry"/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("shows every line of pasted plain text in a user message (#680)", () => {
  const lines = [
    "第1题（看门狗）",
    "嵌入式系统中，看门狗（WatchDog）的基本工作原理是（ ）",
    "A. 监控系统温度，过热时自动降频",
    "B. 计数器自动计数，程序定期将其重置；若程序跑飞计数器溢出，则系统复位重启",
  ];
  const expected = `<p>${lines.join("<br/>")}</p>`;

  for (const lineEnding of ["\n", "\r\n", "\r"]) {
    const html = renderMessage({ role: "user", content: lines.join(lineEnding) });
    assert.ok(html.includes(expected), JSON.stringify(lineEnding));
    assert.doesNotMatch(html, /\r/);
  }

  const listHtml = renderMessage({
    role: "user",
    content: [{ type: "text", text: "1. 看门狗的原理是（ ）\nA. 监控温度\nB. 计数器" }],
  });
  assert.match(listHtml, /<li>看门狗的原理是（ ）<br\/>A\. 监控温度<br\/>B\. 计数器<\/li>/);
});

test("keeps assistant soft line breaks as Markdown paragraphs", () => {
  const html = renderMessage({ role: "assistant", content: [{ type: "text", text: "one\ntwo" }] });

  assert.match(html, /<p>one\ntwo<\/p>/);
  assert.doesNotMatch(html, /<br/);
});

test("renders lone carriage returns in compact command arguments as line breaks", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION.replace("src/main.ts", "src/main.ts\rsrc/app.ts"),
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts\nsrc\/app\.ts/);
  assert.doesNotMatch(html, /\r/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("marks apply_patch returned failures as errors even when isError is unset", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-patch-1",
    toolName: "apply_patch",
    input: {
      input: "*** Begin Patch\n*** Update File: src/a.ts\n-old\n+new\n*** End Patch",
    },
  };
  const failed = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "apply_patch failed.\nRecovery: MUST read src/a.ts before retrying." }],
    details: {
      result: { appliedFiles: [], failures: [{ filePath: "src/a.ts", message: "context mismatch" }] },
    },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [block],
  }, { toolResults: new Map([[block.toolCallId, failed]]) });

  assert.match(html, /data-status="error"/);
  assert.match(html, /data-activity-tool="apply_patch"/);
  assert.doesNotMatch(html, /data-status="error"[\s\S]*text-success/);
});

test("a custom message starts folded and opens from its header alone", () => {
  const custom = (props) => renderMessage({
    role: "custom",
    customType: "extension",
    display: true,
    timestamp: Date.now(),
    ...props,
  });
  // The header is the row's first button and the only one holding the title.
  const header = (html) => html.slice(0, html.indexOf("</button>"));

  // 第 4.1 节: opening a session shows every custom event folded away.
  const folded = custom({ content: [{ type: "text", text: "a message with no details" }] });
  assert.match(header(folded), /aria-expanded="false"/);
  assert.match(header(folded), />extension</);
  assert.doesNotMatch(folded, /markdown-custom-message/);
  // Details and copy are fold content too: neither is a second collapse toggle.
  assert.doesNotMatch(folded, /Show details|Hide details/);
  // A message with no text (images only) folds the same way.
  assert.match(header(custom({ content: [] })), /aria-expanded="false"/);
});

test("custom-message images and details live inside the fold", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    details: { files: ["a.ts"] },
    timestamp: Date.now(),
  });

  // Nothing of the body leaks into the folded row.
  assert.doesNotMatch(html, /<img/);
  assert.match(activityRowsSource, /<TraceCollapsibleContent>[\s\S]*?<ImagePreview/);
  assert.match(activityRowsSource, /<TraceCollapsibleContent>[\s\S]*?Show details|t\("i18n\.showDetails"\)/);
});


test("uses the unanswered truncation notice for an empty length reply", () => {
  // A nearly full context can clamp the output so far that nothing, not even
  // thinking, comes back; the notice must not blame thinking alone.
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [],
    stopReason: "length",
  });

  assert.match(html, /output limit was reached before an answer/i);
  assert.match(html, /nearly full context/i);
  assert.doesNotMatch(html, /follow-up/i);
});

function textOf(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
}






test("collapses the compaction summary to its title and token count, as pi's TUI does (#1026)", () => {
  const summary = "## Goal\n\nShip the parser fix.\n\n<read-files>\nlib/read.ts\n</read-files>\n\n<modified-files>\nlib/changed.ts\n</modified-files>";
  const message = {
    role: "custom",
    customType: "compaction",
    content: summary,
    display: true,
    details: { tokensBefore: 123456, firstKeptEntryId: "kept0001" },
  };
  const html = renderMessage(message);

  assert.match(html, /<button type="button" aria-expanded="false" data-state="closed"[^>]*title="Expand"/);
  assert.match(html, /Conversation compacted/);
  assert.ok(html.includes(`Compacted from ${(123456).toLocaleString()} tokens`));
  // The collapsed header also shows the dev file-context counts next to the tokens.
  assert.doesNotMatch(html, /Ship the parser fix|following summary|lib\/read\.ts|lib\/changed\.ts/);
  assert.doesNotMatch(renderMessage({ ...message, details: undefined }), /Compacted from/);

  // What the toggle reveals.
  const details = renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(CompactionSummaryDetails, { summary }),
  ));
  assert.match(details, /following summary/);
  assert.match(details, /Ship the parser fix/);
  assert.match(details, /File context: 1 read, 1 modified/);
  assert.match(details, /lib\/read\.ts/);
  assert.match(details, /lib\/changed\.ts/);
});

// ── A tool card's patch: two columns where there is room, one where there is not ──

const EDIT_PATCH = `--- a/src/demo.ts
+++ b/src/demo.ts
@@ -10,3 +10,3 @@
 const keep = true;
-const value = "old";
+const value = "new";
done();
`;

const TWO_COLUMN_GRID = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

function renderPatchFiles(files, layout) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PatchDiffFiles, { files, layout })),
  );
}

function countIn(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// pi-hashline-edit-pro's insert/replace address lines by anchor and name no file (#1460).



test("the same patch in one column: no line twice, the removed line above what replaces it", () => {
  const stacked = renderPatchFiles(parseUnifiedPatch(EDIT_PATCH), "stacked");

  assert.ok(!stacked.includes("grid-cols-[minmax"), "nothing stands beside anything");
  assert.equal(countIn(stacked, "const keep = true;"), 1);
  assert.equal(countIn(stacked, "const value = &quot;old&quot;;"), 1);
  assert.equal(countIn(stacked, "const value = &quot;new&quot;;"), 1);
  assert.ok(stacked.indexOf("&quot;old&quot;;") < stacked.indexOf("&quot;new&quot;;"));

  // The two columns pay for themselves by printing every context line twice.
  const split = renderPatchFiles(parseUnifiedPatch(EDIT_PATCH), "split");
  assert.ok(split.includes(TWO_COLUMN_GRID));
  assert.equal(countIn(split, "const keep = true;"), 2);
});

test("one column names a file section by the file's own path, not by Before and After", () => {
  const files = parseUnifiedPatch(`--- a/one.ts
+++ b/one.ts
@@ -1 +1 @@
-a
+b
--- a/two.ts
+++ b/two.ts
@@ -1 +1 @@
-c
+d
`);
  const html = renderPatchFiles(files, "stacked");

  assert.ok(html.includes("b/one.ts"), "the first file names its section");
  assert.ok(html.includes("b/two.ts"), "the second file names its section");
  assert.ok(!html.includes(">Before<") && !html.includes(">After<"), "two labels over one column read as two columns");
});


test("one column numbers a removed line by the old file and every other line by the new one", () => {
  const stacked = renderPatchFiles(parseUnifiedPatch(`--- a/src/demo.ts
+++ b/src/demo.ts
@@ -10,3 +10,4 @@
 const keep = true;
-const value = "old";
+const value = "new";
+const extra = 1;
 done();
@@ -30,1 +31,1 @@
-late
+LATE
`), "stacked");

  const gutter = [...stacked.matchAll(/w-\[\d+ch\]">(\d*)</g)].map((match) => match[1]);
  // done() is old line 12 but new line 13: the new file's number, as in the file viewer's gutter.
  assert.deepEqual(gutter, ["10", "11", "11", "12", "13", "30", "31"]);
  // The lines between the hunks stay marked, as in the two-column view.
  assert.equal(countIn(stacked, "⋯ 17 unchanged lines"), 1);
});

test("one column names a deleted file's section by its old path", () => {
  const html = renderPatchFiles(parseUnifiedPatch(`--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
--- a/kept.ts
+++ b/kept.ts
@@ -1 +1 @@
-a
+b
`), "stacked");

  assert.ok(html.includes(">a/gone.ts<"));
  assert.ok(!html.includes("/dev/null"));
});

// The tool card's internals moved to the官方 pattern layer: `lib/tool-view.ts`
// decides what a call shows, `components/transcript/*` renders it. Its own view
// model is covered by lib/tool-view.test.mjs; these keep the wiring in place.
const activityRowsSource = await readFileSync(new URL("./ActivityRows.tsx", import.meta.url), "utf8");
const toolTraceSource = await readFileSync(new URL("./transcript/ToolTrace.tsx", import.meta.url), "utf8");
const traceRowSource = await readFileSync(new URL("./transcript/TraceRow.tsx", import.meta.url), "utf8");

test("each tool view kind reaches its pattern, and no card markup is left", () => {
  assert.match(activityRowsSource, /<TerminalTrace[^>]*activityTool=\{block\.toolName\}/);
  assert.match(activityRowsSource, /<SubagentTrace[\s\S]*?foldKey=\{view\.foldKey\}/);
  assert.match(activityRowsSource, /<ToolTrace[\s\S]*?activityTool=\{block\.toolName\}/);
  // A search's sources, a to-do split, a failure's stack and a call's media each
  // have their own pattern: the view model computes them, the row renders them.
  assert.match(activityRowsSource, /<SourcesTrace sources=\{view\.sources\}/);
  assert.match(activityRowsSource, /<PlanTrace steps=\{steps\}/);
  assert.match(activityRowsSource, /<StackTraceTrace[\s\S]*?text=\{resultText \?\? view\.error\}/);
  assert.match(activityRowsSource, /<MediaTrace images=\{view\.images\}/);
  // The old per-category card (argument table, paired result, two-column patch)
  // is gone; a call renders through a pattern or not at all.
  for (const name of ["ToolFieldRows", "PairedResult", "SplitPatchView", "ToolRowPreview", "RowStatusIcon"]) {
    assert.doesNotMatch(activityRowsSource, new RegExp(`function ${name}\\b`), name);
  }
});

test("a row keeps its tool name for the selectors that count rows", () => {
  assert.match(traceRowSource, /data-activity-tool=\{activityTool\}/);
});

test("a running call with parsed input says what it is doing instead of showing rows", () => {
  assert.match(toolTraceSource, /streamingInput/);
  assert.match(toolTraceSource, /chat\.generatingToolInput/);
});

test("a TUI result keeps its ANSI colours instead of printing escape codes", () => {
  assert.match(toolTraceSource, /isTuiText\s*\(/);
  assert.match(toolTraceSource, /<AnsiText/);
});
