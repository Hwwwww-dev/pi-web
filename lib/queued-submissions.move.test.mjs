import { strict as assert } from "node:assert";
import test from "node:test";
import { moveQueuedEntry, splitClearedQueue } from "../lib/queued-submissions.ts";

const steer = (text) => ({ behavior: "steer", text, images: [] });
const follow = (text) => ({ behavior: "followUp", text, images: [] });

test("moveQueuedEntry swaps with the nearest same-behavior neighbor", () => {
  const items = [steer("a"), follow("f1"), steer("b"), steer("c"), follow("f2")];
  // "c" moves up past "b"; the followUp rows stay put.
  assert.deepEqual(moveQueuedEntry(items, "steer", "c", "up"), [steer("a"), follow("f1"), steer("c"), steer("b"), follow("f2")]);
  // "a" moves down past "b"; "c" is not jumped over.
  assert.deepEqual(moveQueuedEntry(items, "steer", "a", "down"), [steer("b"), follow("f1"), steer("a"), steer("c"), follow("f2")]);
});

test("moveQueuedEntry returns null at the edges and for unknown entries", () => {
  const items = [steer("a"), follow("f"), steer("b")];
  assert.equal(moveQueuedEntry(items, "steer", "a", "up"), null);
  assert.equal(moveQueuedEntry(items, "steer", "b", "down"), null);
  assert.equal(moveQueuedEntry(items, "followUp", "f", "up"), null);
  assert.equal(moveQueuedEntry(items, "steer", "missing", "up"), null);
  // The input list is never mutated.
  assert.deepEqual(items, [steer("a"), follow("f"), steer("b")]);
});

test("moveQueuedEntry keeps its return shape compatible with splitClearedQueue", () => {
  const cleared = { steering: ["x", "y"], followUp: ["z"] };
  // Records carry ids as createQueuedSubmission always does — without one,
  // `records.find(r => r.id === undefined)` would take the first row for the edit path.
  const records = [
    { id: "q1", behavior: "steer", text: "x", images: [] },
    { id: "q2", behavior: "steer", text: "y", images: [] },
    { id: "q3", behavior: "followUp", text: "z", images: [] },
  ];
  const remaining = splitClearedQueue(cleared, records);
  const moved = moveQueuedEntry(remaining, "steer", "y", "up");
  assert.deepEqual(moved, [steer("y"), steer("x"), follow("z")]);
});
