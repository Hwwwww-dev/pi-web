import type { SessionInfo } from "@/lib/types";

/**
 * Overlay a catalogue row onto the session already on screen.
 *
 * Catalogue rows omit optional keys instead of setting them to undefined, so a
 * plain spread can never clear one that stopped being true: a hydrated row drops
 * `detailsPending`, a session that left a worktree drops `branch`/`isWorktree`,
 * and a fork whose parent went away drops `relation`. Reset those from the
 * refreshed row explicitly. Locally applied fields such as an auto-generated
 * title still survive until the next listing carries them.
 */
export function mergeCatalogRow(current: SessionInfo, refreshed: SessionInfo): SessionInfo {
  return {
    ...current,
    ...refreshed,
    detailsPending: refreshed.detailsPending,
    relation: refreshed.relation,
    branch: refreshed.branch,
    isWorktree: refreshed.isWorktree,
  };
}

/**
 * Overlay a polled catalogue row onto the row already on screen.
 *
 * The running-state poll carries summary-grade rows: a session whose file just
 * changed is listed from its header alone, so its count and first message are
 * empty until a full listing hydrates them. Taking such a row as-is blanks the
 * columns the sidebar already knows, on every tick, for as long as the session
 * stays busy. Keep the details from the row on screen and refresh the rest.
 */
export function mergePolledRow(current: SessionInfo | undefined, polled: SessionInfo): SessionInfo {
  if (!current) return polled;
  // Whichever way it goes, the marker is decided by the polled row: it omits the
  // key instead of clearing it, so a plain spread would keep a stale one.
  if (!polled.detailsPending) return { ...current, ...polled, detailsPending: undefined };
  return {
    ...current,
    ...polled,
    name: polled.name ?? current.name,
    firstMessage: polled.firstMessage || current.firstMessage,
    messageCount: current.messageCount,
    detailsPending: current.detailsPending,
  };
}
