/**
 * 离开页面的活跃会话记录（2026-11-20 用户需求）：标签页切走时记下「哪个活跃
 * 会话 + 离开时间」，切回时离开 ≥30s 且这段 JS 上下文没刷新过（内存标记还在）
 * 就像手动重新加载一样整窗骨架重载；页面若重新挂载（刷新/重开），挂载时把
 * 遗留记录删掉、走正常初始化。记录必须跨页面卸载存活，所以放 localStorage。
 */
export interface SessionAwayRecord {
  sessionId: string;
  leftAt: number;
}

const STORAGE_KEY = "pi-web:session-away";

/** 离开多久后回来触发整窗重载（2026-11-20 用户定的 30 秒）。 */
export const SESSION_AWAY_RELOAD_MS = 30_000;

export function recordSessionAway(sessionId: string, leftAt = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, leftAt } satisfies SessionAwayRecord));
  } catch {
    // 存不了（隐私模式等）就没有跨刷新的记录，重挂载清理自然无事可做。
  }
}

export function readSessionAway(): SessionAwayRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionAwayRecord>;
    if (typeof parsed.sessionId !== "string" || typeof parsed.leftAt !== "number") return null;
    return { sessionId: parsed.sessionId, leftAt: parsed.leftAt };
  } catch {
    return null;
  }
}

export function clearSessionAway(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同 record：删不掉也只是记录残留，读取端有形状校验兜底。
  }
}
