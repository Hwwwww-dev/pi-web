import type { AgentUsage, SessionEntry, SessionMessage } from "./types";

export interface SessionFileStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  /** Usage of the most recent model request in file order — the live cache/context reading. */
  lastUsage: AgentUsage | null;
}

function emptyStats(): SessionFileStats {
  return {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    lastUsage: null,
  };
}

function addUsage(stats: SessionFileStats, usage?: AgentUsage): void {
  if (!usage) return;
  stats.tokens.input += usage.input ?? 0;
  stats.tokens.output += usage.output ?? 0;
  stats.tokens.cacheRead += usage.cacheRead ?? 0;
  stats.tokens.cacheWrite += usage.cacheWrite ?? 0;
  stats.cost += usage.cost?.total ?? 0;
  // Entries arrive in file order, so the last one carrying usage is the most
  // recent model request.
  stats.lastUsage = usage;
}

function addMessage(stats: SessionFileStats, message: SessionMessage): void {
  // Like the SDK, every message entry counts toward the total, including the
  // transcript system messages that hold the prompt and tool loadout.
  stats.totalMessages += 1;
  if (message.role === "user") {
    stats.userMessages += 1;
  } else if (message.role === "toolResult") {
    stats.toolResults += 1;
    addUsage(stats, message.usage);
  } else if (message.role === "assistant") {
    stats.assistantMessages += 1;
    if (Array.isArray(message.content)) {
      stats.toolCalls += message.content.filter((c) => c.type === "toolCall").length;
    }
    addUsage(stats, message.usage);
  }
}

function finishStats(stats: SessionFileStats): SessionFileStats {
  stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite;
  return stats;
}

/**
 * Aggregate usage across ALL entries in a session file.
 *
 * Mirrors the SDK's `AgentSession.getSessionStats()`: besides assistant
 * (and tool-result) messages, this also counts usage recorded on compaction,
 * branch-summary and `usage` entries (prompt-cache warming, which is billed
 * but never enters model context). Compaction only appends a summary entry — the
 * summarized history stays in the file — so these totals grow monotonically
 * for the life of the session. Totals computed over the active context alone
 * (the compaction-aware message list) shrink whenever old history is
 * summarized away, which is what made the UI token/cost counters appear to be
 * reset after compaction.
 */
export function computeSessionStats(entries: SessionEntry[]): SessionFileStats {
  const stats = emptyStats();

  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "usage") {
      addUsage(stats, entry.usage);
      continue;
    }
    if (entry.type !== "message") continue;
    addMessage(stats, entry.message);
  }

  return finishStats(stats);
}
