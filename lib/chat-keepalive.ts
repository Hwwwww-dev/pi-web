export interface ChatKeepAliveConfig {
  /** Max simultaneously kept-alive chat sessions. */
  maxSessions: number;
  /** Minutes an inactive keep-alive slot survives before eviction. */
  idleTimeoutMinutes: number;
}

export const DEFAULT_KEEP_ALIVE_CONFIG: ChatKeepAliveConfig = {
  maxSessions: 5,
  idleTimeoutMinutes: 10,
};

export const KEEP_ALIVE_CONFIG_LIMITS = {
  maxSessions: { min: 1, max: 10 },
  idleTimeoutMinutes: { min: 1, max: 120 },
} as const;

const STORAGE_KEY = "pi-web:chat-keepalive";

import type { SessionInfo } from "@/lib/types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function loadKeepAliveConfig(): ChatKeepAliveConfig {
  if (typeof window === "undefined") return DEFAULT_KEEP_ALIVE_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_KEEP_ALIVE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ChatKeepAliveConfig>;
    const { min: maxMin, max: maxMax } = KEEP_ALIVE_CONFIG_LIMITS.maxSessions;
    const { min: idleMin, max: idleMax } = KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes;
    return {
      maxSessions: typeof parsed.maxSessions === "number" ? clamp(parsed.maxSessions, maxMin, maxMax) : DEFAULT_KEEP_ALIVE_CONFIG.maxSessions,
      idleTimeoutMinutes: typeof parsed.idleTimeoutMinutes === "number" ? clamp(parsed.idleTimeoutMinutes, idleMin, idleMax) : DEFAULT_KEEP_ALIVE_CONFIG.idleTimeoutMinutes,
    };
  } catch {
    return DEFAULT_KEEP_ALIVE_CONFIG;
  }
}

export function saveKeepAliveConfig(config: ChatKeepAliveConfig): ChatKeepAliveConfig {
  const normalized: ChatKeepAliveConfig = {
    maxSessions: clamp(config.maxSessions, KEEP_ALIVE_CONFIG_LIMITS.maxSessions.min, KEEP_ALIVE_CONFIG_LIMITS.maxSessions.max),
    idleTimeoutMinutes: clamp(config.idleTimeoutMinutes, KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.min, KEEP_ALIVE_CONFIG_LIMITS.idleTimeoutMinutes.max),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage unavailable (private mode/quota): the config stays session-only.
  }
  return normalized;
}

export interface KeepAliveSlot {
  /** Session snapshot captured at slot creation; refreshed on every select. */
  session: SessionInfo;
  /** Last time this slot was the visible session (or was newly selected). */
  lastActiveAt: number;
  /** Bumped to force the slot's ChatWindow to remount (cwd move, trust change). */
  epoch: number;
}

/**
 * Insert or touch the slot for `session`, refresh its snapshot, and evict
 * least-recently-active slots beyond `maxSessions`. The just-selected session
 * is never evicted; set `remount` to force its next mount to reload.
 */
export function upsertKeepAliveSlot(slots: KeepAliveSlot[], session: SessionInfo, now: number, maxSessions: number, remount = false): KeepAliveSlot[] {
  let next: KeepAliveSlot[];
  if (slots.some((slot) => slot.session.id === session.id)) {
    next = slots.map((slot) => {
      if (slot.session.id !== session.id) return slot;
      return { ...slot, session, lastActiveAt: now, epoch: remount ? slot.epoch + 1 : slot.epoch };
    });
  } else {
    next = [...slots, { session, lastActiveAt: now, epoch: 0 }];
  }
  while (next.length > maxSessions) {
    const candidates = next.filter((slot) => slot.session.id !== session.id);
    if (candidates.length === 0) break;
    const oldest = candidates.reduce((a, b) => (a.lastActiveAt <= b.lastActiveAt ? a : b));
    next = next.filter((slot) => slot.session.id !== oldest.session.id);
  }
  return next;
}

const DOCK_TOP_STORAGE_KEY = "pi-web:keepalive-dock:top-pct";

export interface PersistedKeepAliveSlot {
  id: string;
  lastActiveAt: number;
  epoch: number;
}

const SLOTS_STORAGE_KEY = "pi-web:keepalive-slots";

/** Slot identities only — the session snapshot is rebuilt from the catalogue. */
export function loadKeepAliveSlotRecords(): PersistedKeepAliveSlot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SLOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PersistedKeepAliveSlot => {
      const record = item as PersistedKeepAliveSlot;
      return typeof record?.id === "string"
        && typeof record?.lastActiveAt === "number"
        && typeof record?.epoch === "number";
    });
  } catch {
    return [];
  }
}

export function saveKeepAliveSlots(slots: KeepAliveSlot[]): void {
  try {
    window.localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(
      slots.map((slot) => ({ id: slot.session.id, lastActiveAt: slot.lastActiveAt, epoch: slot.epoch })),
    ));
  } catch {
    // Persistence is best-effort; privacy mode and storage quotas must not break the dock.
  }
}

/** Vertical dock position as a percentage of the chat area height. */
export function loadKeepAliveDockTopPct(): number {
  if (typeof window === "undefined") return 28;
  try {
    const raw = window.localStorage.getItem(DOCK_TOP_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 28;
    return Math.min(95, Math.max(5, parsed));
  } catch {
    return 28;
  }
}

export function saveKeepAliveDockTopPct(pct: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOCK_TOP_STORAGE_KEY, String(Math.min(95, Math.max(5, pct))));
  } catch {
    // Persistence is best-effort; privacy mode and storage quotas must not break the dock.
  }
}
