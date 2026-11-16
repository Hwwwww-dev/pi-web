import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { countToolCalls, layoutSlots, assembleTurnNodes, MAX_VISIBLE_SLOTS } = await jiti.import("./ChatMinimap.tsx");

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

const fakeIndex = (count) =>
  Array.from({ length: count }, (_, i) => ({ entryId: `e${i}`, preview: `turn ${i + 1}`, timestamp: 1700000000000 + i }));

const fakeMeasuredTurn = (content) => ({
  userMessage: { role: "user", content },
  scrollTop: 120,
  toolCount: 1,
  usageTokens: 500,
  usageCost: 0.01,
});

test("the rail assembles head, window and tail from the whole-branch index", () => {
  // A window holding turns 5–6 of ten: head and tail come from the index as
  // unloaded turns, so the rail always shows the whole branch regardless of
  // what the chat has loaded.
  const nodes = assembleTurnNodes(fakeIndex(10), 4, [fakeMeasuredTurn("turn 5"), fakeMeasuredTurn("turn 6")]);
  assert.deepEqual(nodes.map((node) => node.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(nodes[0].targetTurn.scrollTop, null);
  assert.equal(nodes[0].targetTurn.userMessage.content, "turn 1");
  assert.equal(nodes[9].targetTurn.scrollTop, null);
  assert.equal(nodes[9].targetTurn.userMessage.content, "turn 10");
  assert.equal(nodes[4].targetTurn.scrollTop, 120);
  assert.equal(nodes[5].targetTurn.usageTokens, 500);
});

test("a missing or short index degrades to the measured window only", () => {
  const measured = [fakeMeasuredTurn("only"), fakeMeasuredTurn("windows")];
  const nodes = assembleTurnNodes([], 2, measured);
  assert.deepEqual(nodes.map((node) => node.index), [0, 1]);
  // An index shorter than the turns before the window caps the head and keeps
  // numbering continuous from the measured turns.
  const capped = assembleTurnNodes(fakeIndex(3), 5, measured);
  assert.deepEqual(capped.map((node) => node.index), [0, 1, 2, 3, 4]);
  assert.equal(capped[2].targetTurn.scrollTop, null);
  assert.equal(capped[3].targetTurn.scrollTop, 120);
});

const fakeNode = (index) => ({ topRatio: 0, targetTurn: { scrollTop: index * 100 }, index });

function fakeNodes(count) {
  return Array.from({ length: count }, (_, index) => fakeNode(index));
}

test("a tall rail folds long sessions into at most MAX_VISIBLE_SLOTS dashes", () => {
  // 2000px of rail height would fit ~280 slots at the 7px pitch; the cap keeps
  // a long session at a readable handful of dashes regardless of height. The
  // block stays compact (natural pitch, centered) instead of stretching apart.
  const layout = layoutSlots(fakeNodes(200), 2000);
  assert.equal(layout.slots.length, MAX_VISIBLE_SLOTS);
  assert.equal(layout.fillsHeight, false);
  assert.equal(layout.gap, 12);
  // Buckets partition every node exactly once, in order.
  const covered = layout.slots.flatMap((slot) => slot.indexes);
  assert.deepEqual(covered, fakeNodes(200).map((node) => node.index));
  // The rail's endpoints are the conversation's: the first dash is turn 1,
  // the last dash the final turn (interior dashes take bucket middles).
  assert.equal(layout.slots[0].target.index, 0);
  assert.equal(layout.slots[layout.slots.length - 1].target.index, 199);
  // Centered block: last dash sits symmetric to the first around the middle.
  const firstY = layout.slots[0].topRatio * 2000;
  const lastY = layout.slots[layout.slots.length - 1].topRatio * 2000;
  assert.ok(Math.abs(firstY + lastY - 2000) < 2);
});

test("short sessions keep one dash per turn under the cap", () => {
  const layout = layoutSlots(fakeNodes(5), 2000);
  assert.equal(layout.slots.length, 5);
  assert.equal(layout.fillsHeight, false);
  assert.deepEqual(layout.slots.map((slot) => slot.target.index), [0, 1, 2, 3, 4]);
});

test("a short pane still folds before the dashes touch", () => {
  // 84px rail: 60px usable fits only ~8 slots at the 7px pitch — below the cap,
  // the height limit must keep deciding, and the block fills the short rail.
  const layout = layoutSlots(fakeNodes(40), 84);
  assert.ok(layout.slots.length < MAX_VISIBLE_SLOTS);
  assert.equal(layout.fillsHeight, true);
  const covered = layout.slots.flatMap((slot) => slot.indexes);
  assert.deepEqual(covered, fakeNodes(40).map((node) => node.index));
});
