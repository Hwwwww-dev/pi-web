import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { countToolCalls } = await jiti.import("./ChatMinimap.tsx");

test("counts tool calls per assistant reply, including replies that also answer", () => {
  // A reply can both answer and call tools, so counting text-less messages
  // would undercount this turn.
  assert.equal(countToolCalls({
    role: "assistant",
    content: [
      { type: "text", text: "Let me check that file." },
      { type: "toolCall", toolCallId: "1", toolName: "read", input: {} },
      { type: "toolCall", toolCallId: "2", toolName: "grep", input: {} },
    ],
  }), 2);

  assert.equal(countToolCalls({
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "3", toolName: "bash", input: {} }],
  }), 1);

  assert.equal(countToolCalls({
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
  }), 0);
});

test("counts no tool calls for non-assistant or string-content messages", () => {
  assert.equal(countToolCalls({ role: "user", content: "run the tests" }), 0);
  assert.equal(countToolCalls({ role: "assistant", content: "plain string" }), 0);
  assert.equal(countToolCalls({ role: "assistant" }), 0);
});

test("dashes render without hover so the trigger zone is discoverable", async () => {
  const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
  // Every slot is drawn unconditionally — hover only feeds its size and colour —
  // so the trigger zone stays discoverable with nothing hovered.
  assert.match(source, /\{positionedSlots\.map\(\(slot\) => \{/);
  assert.doesNotMatch(source, /\{minimapHovered && positionedSlots\.map/);
});
