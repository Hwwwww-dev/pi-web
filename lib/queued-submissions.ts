import type { ChatDraftImage } from "./draft-store";

/** Queue snapshot pi reports through `queue_update` and `get_state`. */
export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

export type QueuedBehavior = "steer" | "followUp";

/**
 * One pending message as the composer shows it. pi's queue carries texts only,
 * so the thumbnails and the identity a row needs in order to act on a single
 * entry live here, matched to pi's texts by value.
 */
export interface QueuedSubmission {
  id: string;
  text: string;
  behavior: QueuedBehavior;
  images: ChatDraftImage[];
  createdAt: number;
}

/**
 * A queued entry as the wrapper's `get_state` reports it: pi's text plus the
 * attachments still held in the agent's queue content, so rows rebuilt after a
 * reload can show thumbnails again.
 */
export interface QueuedSnapshotEntry {
  text: string;
  behavior: QueuedBehavior;
  images: ChatDraftImage[];
}

/**
 * A queued message is recorded optimistically; pi echoes it back in the next
 * queue snapshot. Until that snapshot arrives the record has to survive on its
 * own, so an unmatched record is only dropped once it is older than this.
 */
export const QUEUE_SUBMISSION_GRACE_MS = 1_500;

const QUEUED_BEHAVIORS: QueuedBehavior[] = ["steer", "followUp"];

let submissionCounter = 0;

function nextSubmissionId(): string {
  submissionCounter += 1;
  return `queued-${Date.now().toString(36)}-${submissionCounter}`;
}

function textsFor(queue: QueuedMessages, behavior: QueuedBehavior): string[] {
  return behavior === "steer" ? queue.steering : queue.followUp;
}

export function emptyQueuedMessages(): QueuedMessages {
  return { steering: [], followUp: [] };
}

/** Attachments offered back when a row has to be rebuilt without its record. */
export type QueuedImageRecall = (text: string, behavior: QueuedBehavior) => ChatDraftImage[] | undefined;

/**
 * HTTP queue reads (get_state responses) are point-in-time and travel a
 * different channel than SSE, so an older reading can land after a fresher
 * `queue_update` has been applied. The gate hands out a token when a request
 * is issued and the response may only apply while no queue change — an SSE
 * snapshot, another applied snapshot, or a local rebuild — has been observed
 * in between. Both stale directions are cut: a stale reading can neither
 * resurrect a delivered entry nor erase a freshly queued one.
 */
export interface QueueSnapshotGate {
  capture(): number;
  observe(): void;
  isFresh(token: number): boolean;
}

export function createQueueSnapshotGate(): QueueSnapshotGate {
  let seq = 0;
  return {
    capture: () => seq,
    observe: () => {
      seq += 1;
    },
    isFresh: (token) => token === seq,
  };
}

/**
 * Remembers the attachments of records that left the queue — delivered, or
 * dropped by the grace window — so a row rebuilt later from a text-only
 * snapshot can show them again. pi matches queued texts by value, so the
 * memory is keyed the same way and capped by count, age, and total bytes.
 */
export interface QueuedImageMemoryOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
}

export interface QueuedImageMemory {
  remember(record: QueuedSubmission): void;
  recall(text: string, behavior: QueuedBehavior): ChatDraftImage[];
}

export function createQueuedImageMemory(options: QueuedImageMemoryOptions = {}): QueuedImageMemory {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const maxEntries = options.maxEntries ?? 16;
  const maxTotalBytes = options.maxTotalBytes ?? 24 * 1024 * 1024;
  let entries: Array<{ text: string; behavior: QueuedBehavior; images: ChatDraftImage[]; bytes: number; at: number }> = [];
  return {
    remember(record) {
      if (!record.text || record.images.length === 0) return;
      const bytes = record.images.reduce((sum, image) => sum + image.data.length, 0);
      entries = entries.filter((entry) => !(entry.text === record.text && entry.behavior === record.behavior));
      entries.push({ text: record.text, behavior: record.behavior, images: record.images, bytes, at: Date.now() });
      let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      // Trim from the oldest but always keep the entry just remembered.
      while (entries.length > 1 && (entries.length > maxEntries || total > maxTotalBytes)) {
        const oldest = entries.shift()!;
        total -= oldest.bytes;
      }
    },
    recall(text, behavior) {
      const now = Date.now();
      entries = entries.filter((entry) => now - entry.at < ttlMs);
      const hit = entries.find((entry) => entry.text === text && entry.behavior === behavior);
      return hit ? hit.images.map((image) => ({ data: image.data, mimeType: image.mimeType })) : [];
    },
  };
}

/**
 * Recall built from the wrapper's `queuedEntries`: the server still holds the
 * queued messages with their attachments, so rows rebuilt after a reload or
 * queued from another tab get their thumbnails back. Each entry is consumed
 * once, matching pi's own text-based queue clearing.
 */
export function queuedImageRecallFromEntries(
  entries: readonly QueuedSnapshotEntry[] | undefined,
): QueuedImageRecall | undefined {
  if (!entries || entries.length === 0) return undefined;
  const remaining = entries.filter((entry) => entry.text && entry.images.length > 0).map((entry) => ({
    text: entry.text,
    behavior: entry.behavior,
    images: entry.images,
  }));
  if (remaining.length === 0) return undefined;
  return (text, behavior) => {
    const index = remaining.findIndex((entry) => entry.behavior === behavior && entry.text === text);
    if (index < 0) return undefined;
    const [hit] = remaining.splice(index, 1);
    return hit.images.map((image) => ({ data: image.data, mimeType: image.mimeType }));
  };
}

/**
 * When the first record pi no longer lists leaves the grace window, or null when
 * every record is still queued. pi's snapshots stop arriving once the queue is
 * empty, so the caller needs the clock as well as the events.
 */
export function queuedGraceDeadline(
  records: QueuedSubmission[],
  queue: QueuedMessages,
  graceMs: number = QUEUE_SUBMISSION_GRACE_MS,
): number | null {
  let deadline: number | null = null;
  for (const record of records) {
    if (!record.text) continue;
    if (textsFor(queue, record.behavior).includes(record.text)) continue;
    const expiresAt = record.createdAt + graceMs;
    deadline = deadline === null ? expiresAt : Math.min(deadline, expiresAt);
  }
  return deadline;
}

export function createQueuedSubmission(
  text: string,
  behavior: QueuedBehavior,
  images: ChatDraftImage[] = [],
  now: number = Date.now(),
): QueuedSubmission {
  return {
    id: nextSubmissionId(),
    text,
    behavior,
    // Only the payload belongs to a record: an attachment's preview URL is
    // revoked as soon as the composer clears.
    images: images.map((image) => ({ data: image.data, mimeType: image.mimeType })),
    createdAt: now,
  };
}

/**
 * Fold a queue snapshot into the local records: a record keeps its
 * thumbnails while pi still lists its text, a delivered record leaves (its
 * attachments pass through `onExpire` for the image memory), and a text pi
 * lists without a record (another client, this tab after a reload, or a
 * record the grace window dropped) becomes a row again, with attachments
 * recovered through `recallImages` when they are known.
 *
 * Empty texts never become rows: pi clears queued texts by matching the
 * delivered message's text, which skips empty strings, so an empty-text row
 * could never leave. An images-only queued message therefore shows no row
 * once pi has confirmed it — the delivered message still carries the images.
 *
 * When every record kept its place and nothing new is pending, the previous
 * array is returned as-is so a state update can bail out of the re-render.
 */
export function reconcileQueuedSubmissions(
  records: QueuedSubmission[],
  queue: QueuedMessages,
  now: number = Date.now(),
  recallImages?: QueuedImageRecall,
  onExpire?: (record: QueuedSubmission) => void,
): QueuedSubmission[] {
  const pending: Record<QueuedBehavior, string[]> = {
    steer: [...queue.steering],
    followUp: [...queue.followUp],
  };
  const next: QueuedSubmission[] = [];
  for (const record of records) {
    if (!record.text) continue;
    const texts = pending[record.behavior];
    const index = texts.indexOf(record.text);
    if (index >= 0) {
      texts.splice(index, 1);
      next.push(record);
    } else if (now - record.createdAt < QUEUE_SUBMISSION_GRACE_MS) {
      next.push(record);
    } else {
      onExpire?.(record);
    }
  }
  for (const behavior of QUEUED_BEHAVIORS) {
    for (const text of pending[behavior]) {
      if (!text) continue;
      next.push(createQueuedSubmission(text, behavior, recallImages?.(text, behavior) ?? [], now));
    }
  }
  if (next.length === records.length && next.every((record, index) => record === records[index])) {
    return records;
  }
  return next;
}

export interface RequeuedSubmission {
  text: string;
  behavior: QueuedBehavior;
  images: ChatDraftImage[];
}

/**
 * `clear_queue` only clears everything, so taking one entry out has to put the
 * others back. pi's returned lists are authoritative; the thumbnails come from
 * the matching local records.
 */
export function splitClearedQueue(
  cleared: QueuedMessages,
  records: QueuedSubmission[],
  takenId?: string,
): RequeuedSubmission[] {
  const taken = records.find((record) => record.id === takenId);
  let takenConsumed = false;
  const available = [...records];
  const remaining: RequeuedSubmission[] = [];
  for (const behavior of QUEUED_BEHAVIORS) {
    for (const text of textsFor(cleared, behavior)) {
      if (!takenConsumed && taken?.behavior === behavior && taken.text === text) {
        takenConsumed = true;
        continue;
      }
      const index = available.findIndex((record) => record.behavior === behavior && record.text === text);
      const images = index >= 0 ? available.splice(index, 1)[0].images : [];
      remaining.push({ text, behavior, images });
    }
  }
  return remaining;
}
