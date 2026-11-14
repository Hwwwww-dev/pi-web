import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { selectHasStreamingContent } = await jiti.import("./useStreamingSelector.ts");

/** A streaming message holding only the given blocks. */
function streaming(content) {
  return { isStreaming: true, streamingMessage: { role: "assistant", content } };
}

test("no streaming message holds nothing to draw", () => {
  assert.equal(selectHasStreamingContent({ isStreaming: false, streamingMessage: null }), false);
  assert.equal(selectHasStreamingContent(streaming([])), false);
});

test("an empty text block is not content", () => {
  // `text_start` materialises this block before the first delta; `MessageView`
  // filters it (isEmptyTextBlock) and would otherwise collapse the slot the
  // phase line occupied, dropping the list by its own height.
  assert.equal(selectHasStreamingContent(streaming([{ type: "text", text: "" }])), false);
  assert.equal(selectHasStreamingContent(streaming([{ type: "text", text: "  \n " }])), false);
});

test("text with a visible character is content", () => {
  assert.equal(selectHasStreamingContent(streaming([{ type: "text", text: "H" }])), true);
  assert.equal(selectHasStreamingContent(streaming([{ type: "text", text: "\nH" }])), true);
});

test("an empty thinking block is content: the live thinking row renders it", () => {
  assert.equal(selectHasStreamingContent(streaming([{ type: "thinking", thinking: "" }])), true);
});

test("a tool call is content as soon as it starts", () => {
  assert.equal(selectHasStreamingContent(streaming([
    { type: "toolCall", toolCallId: "t1", toolName: "bash", input: {}, rawInput: "" },
  ])), true);
});

test("one visible block among empty ones is enough", () => {
  assert.equal(selectHasStreamingContent(streaming([
    { type: "text", text: "" },
    { type: "text", text: "answer" },
  ])), true);
});
