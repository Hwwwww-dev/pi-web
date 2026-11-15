interface TimingEntry {
  type: string;
  id?: string;
  timestamp: string;
  message?: { role?: string };
}

interface TimingEntriesSource {
  getEntries(): readonly TimingEntry[];
}

/**
 * Estimate active wall-clock time from the append-only session log.
 *
 * Raw entries preserve compacted history and every executed branch exactly
 * once. Gaps ending at user messages are treated as human idle. User-initiated
 * bash entries are also boundaries because the log records only their finish
 * time, so counting the incoming gap could include arbitrary human idle.
 */
export function computeSessionTotalActiveMs(entries: readonly TimingEntry[]): number {
  const state: TimingFoldState = { totalActiveMs: 0, previousTimestamp: undefined };
  for (const entry of entries) foldTimingEntry(state, entry);
  return state.totalActiveMs;
}

function isTimingEntry(type: string): boolean {
  return type === "message"
    || type === "compaction"
    || type === "branch_summary"
    || type === "custom_message";
}

/** The running total and the last timing entry's timestamp it was built from. */
interface TimingFoldState {
  totalActiveMs: number;
  previousTimestamp: number | undefined;
}

function foldTimingEntry(state: TimingFoldState, entry: TimingEntry): void {
  if (!isTimingEntry(entry.type)) return;

  const timestamp = Date.parse(entry.timestamp);
  if (!Number.isFinite(timestamp)) return;

  const role = entry.type === "message" ? entry.message?.role : undefined;
  if (role === "user" || role === "bashExecution") {
    state.previousTimestamp = timestamp;
    return;
  }

  if (state.previousTimestamp !== undefined && timestamp > state.previousTimestamp) {
    state.totalActiveMs += timestamp - state.previousTimestamp;
  }
  state.previousTimestamp = timestamp;
}

const activeMsBySession = new WeakMap<TimingEntriesSource, TimingFoldState & { entryCount: number; lastEntryId: string | undefined }>();

/**
 * `computeSessionTotalActiveMs()` over a live session manager, folded
 * incrementally: only the entries gained since the last read are processed.
 *
 * The status reads that carry the value to the Session Info panel poll every
 * 600 ms while a prompt settles and every 15 s while a run is active, so
 * walking and parsing the whole entry list on each of them would block the
 * server's event loop on a long transcript (#1334). `POST /api/sessions/stats`
 * caches its summaries the same way. Entries are only appended and a rewritten
 * file keeps the session's manager, so the prefix (the count and the id at
 * that count) identifies a state: a rewrite that shortens or reorders the
 * list fails the prefix check and folds from scratch on the next read.
 */
export function computeLiveSessionTotalActiveMs(manager: TimingEntriesSource): number {
  const entries = manager.getEntries();
  let cached = activeMsBySession.get(manager);
  if (!cached
    || cached.entryCount > entries.length
    || entries[cached.entryCount - 1]?.id !== cached.lastEntryId) {
    cached = { entryCount: 0, lastEntryId: undefined, totalActiveMs: 0, previousTimestamp: undefined };
  }

  for (let index = cached.entryCount; index < entries.length; index += 1) {
    foldTimingEntry(cached, entries[index]);
    cached.entryCount = index + 1;
    cached.lastEntryId = entries[index].id;
  }
  activeMsBySession.set(manager, cached);
  return cached.totalActiveMs;
}
