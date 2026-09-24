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
 * Fold a pi queue snapshot into the local records: a record keeps its
 * thumbnails while pi still lists its text, a delivered record leaves, and a
 * text pi lists without a record (another client, or this tab after a reload)
 * becomes a text-only row.
 */
export function reconcileQueuedSubmissions(
  records: QueuedSubmission[],
  queue: QueuedMessages,
  now: number = Date.now(),
): QueuedSubmission[] {
  const pending: Record<QueuedBehavior, string[]> = {
    steer: [...queue.steering],
    followUp: [...queue.followUp],
  };
  const next: QueuedSubmission[] = [];
  for (const record of records) {
    const texts = pending[record.behavior];
    const index = texts.indexOf(record.text);
    if (index >= 0) {
      texts.splice(index, 1);
      next.push(record);
    } else if (now - record.createdAt < QUEUE_SUBMISSION_GRACE_MS) {
      next.push(record);
    }
  }
  for (const behavior of QUEUED_BEHAVIORS) {
    for (const text of pending[behavior]) {
      next.push(createQueuedSubmission(text, behavior, [], now));
    }
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
  takenId: string,
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
