// Regression loops for the message-queue bugs: delivered messages resurrecting
// from stale state reads, queued rows losing their thumbnails, and empty-text
// ghost rows. Encodes the client-side event sequences against
// lib/queued-submissions.ts — the pure seam where the reconcile, snapshot-gate,
// and image-memory semantics live.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createQueuedImageMemory,
  createQueueSnapshotGate,
  createQueuedSubmission,
  queuedGraceDeadline,
  queuedImageRecallFromEntries,
  reconcileQueuedSubmissions,
  QUEUE_SUBMISSION_GRACE_MS,
} = await jiti.import("./queued-submissions.ts");

const IMAGE = { data: "AAAA", mimeType: "image/png" };
const EMPTY = { steering: [], followUp: [] };

test("loop A — a stale state read cannot resurrect a delivered message", () => {
  const gate = createQueueSnapshotGate();
  let records = [];

  // The user queues "跑一下测试" while the run streams; pi confirms, then
  // delivers it a while later. Each SSE queue_update observes a queue change
  // and applies.
  records = [...records, createQueuedSubmission("跑一下测试", "followUp", [], 1_000_000)];
  gate.observe();
  records = reconcileQueuedSubmissions(records, { steering: [], followUp: ["跑一下测试"] }, 1_000_050);
  assert.equal(records.length, 1);
  gate.observe();
  records = reconcileQueuedSubmissions(records, EMPTY, 1_010_000);
  assert.equal(records.length, 0, "delivered row must leave the queue");

  // The 15s reconcile poll's response was read BEFORE the delivery and lands
  // after the SSE removal applied: its token is stale, so the queue part of
  // the response is dropped and the delivered message stays gone.
  const staleToken = gate.capture();
  gate.observe();
  assert.equal(gate.isFresh(staleToken), false);

  // A read with no queue change in between still applies (initial sync,
  // another client's queue entry).
  const freshToken = gate.capture();
  assert.equal(gate.isFresh(freshToken), true);
});

test("loop B — a grace-expired record's thumbnails come back with the late snapshot", () => {
  const t0 = 2_000_000;
  const memory = createQueuedImageMemory();
  // The hook chains wrapper entries first, then the image memory (applyQueuedRecords).
  const recall = (text, behavior) => memory.recall(text, behavior);
  const remember = (record) => memory.remember(record);
  let records = [];

  // User queues text + image while streaming; the POST carries multi-MB
  // base64 and takes longer than the grace window to be confirmed.
  records = [...records, createQueuedSubmission("看这张图", "followUp", [IMAGE], t0)];
  records = reconcileQueuedSubmissions(records, { steering: [], followUp: [] }, t0 + 100, recall, remember);
  assert.ok(queuedGraceDeadline(records, { steering: [], followUp: [] }) !== null);
  records = reconcileQueuedSubmissions(records, { steering: [], followUp: [] }, t0 + QUEUE_SUBMISSION_GRACE_MS + 100, recall, remember);
  assert.equal(records.length, 0, "unconfirmed record leaves after the grace window");

  // pi's queue_update finally arrives listing the text; the row is rebuilt
  // with the remembered thumbnails.
  records = reconcileQueuedSubmissions(records, { steering: [], followUp: ["看这张图"] }, t0 + QUEUE_SUBMISSION_GRACE_MS + 200, recall, remember);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].images, [IMAGE]);
});

test("loop C — empty texts never render as rows, so an image-only queue cannot ghost", () => {
  // pi clears queued texts by matching the delivered message's text and skips
  // empty strings — a queued "" would otherwise be listed forever.
  let records = [createQueuedSubmission("", "followUp", [IMAGE], 3_000_000)];
  records = reconcileQueuedSubmissions(records, { steering: [], followUp: [""] }, 3_000_050);
  assert.equal(records.length, 0, "an empty-text record must not render");

  records = reconcileQueuedSubmissions(records, { steering: [], followUp: [""] }, 3_060_000);
  assert.equal(records.length, 0, "an empty text pi lists must not become a row");
});

test("loop D — rows rebuilt after a reload get their thumbnails from the wrapper's queue entries", () => {
  const t0 = 4_000_000;
  // After the reload the local records are gone; get_state still reports the
  // queued text and (through queuedEntries) its attachments.
  const recall = queuedImageRecallFromEntries([
    { text: "看这张图", behavior: "followUp", images: [IMAGE] },
  ]);
  const records = reconcileQueuedSubmissions([], { steering: [], followUp: ["看这张图"] }, t0, recall);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].images, [IMAGE]);

  // Each entry is consumed once: a second identical rebuild gets no images
  // from the same entries (matching pi's own text-based clearing).
  const second = reconcileQueuedSubmissions([], { steering: [], followUp: ["看这张图"] }, t0, recall);
  assert.deepEqual(second[0].images, []);
});

test("reconcile preserves record identity when nothing changed", () => {
  const records = [
    createQueuedSubmission("继续", "followUp", [], 5_000_000),
    createQueuedSubmission("跑测试", "steer", [IMAGE], 5_000_001),
  ];
  const again = reconcileQueuedSubmissions(records, { steering: ["跑测试"], followUp: ["继续"] }, 5_000_050);
  assert.equal(again, records, "an unchanged queue must reuse the previous array so the state update bails out");
});

test("image memory is capped and expires", () => {
  const memory = createQueuedImageMemory({ maxEntries: 2, ttlMs: 1_000, maxTotalBytes: 1_000_000 });
  memory.remember(createQueuedSubmission("a", "followUp", [{ data: "A".repeat(10), mimeType: "image/png" }], 1));
  memory.remember(createQueuedSubmission("b", "followUp", [{ data: "B".repeat(10), mimeType: "image/png" }], 2));
  memory.remember(createQueuedSubmission("c", "followUp", [{ data: "C".repeat(10), mimeType: "image/png" }], 3));
  assert.deepEqual(memory.recall("a", "followUp"), [], "the oldest entry is evicted beyond maxEntries");
  assert.equal(memory.recall("c", "followUp")[0].data, "C".repeat(10));
});
