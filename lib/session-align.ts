import type { AgentMessage } from "./types";
import { recordSessionRead } from "./session-read-log";

/**
 * 送达确认与对齐（大号消息的补丁）。
 *
 * 慢隧道下发一条带多图的提示词，请求体是 MB 级 base64：写盘、SSE 回推、事后整窗重读
 * 每一步都在超时边缘。原来“这条消息到底送到没有”只能靠事后**整窗重读**判断，读一次
 * 就要把刚发出去的 MB 级正文再搬一圈，隧道一慢就判不出来，消息被判成“没送到”而消失。
 *
 * 这里两条轻量通路：
 *  - `probeSessionTail()`：只要末条 entryId（服务端只读文件尾部），与消息体量无关；
 *  - `fetchSessionSince()`：只要某个 entryId 之后的条目，用来补差，不再整窗重读。
 * 服务端锚点已被挤出窗口时返回 `reset`，调用方退回整窗读。
 */

export interface SessionTailProbe {
  lastEntryId: string | null;
}

/** 末条 entryId；网络/接口失败返回 null（调用方退回原来的整窗读）。 */
export async function probeSessionTail(sessionId: string): Promise<SessionTailProbe | null> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?ids=1`, { cache: "no-store" });
    if (!res.ok) return null;
    recordSessionRead({ at: Date.now(), kind: "probe", sessionId, detail: "?ids=1 末条 entryId" });
    const body = await res.json() as { lastEntryId?: unknown };
    return { lastEntryId: typeof body.lastEntryId === "string" ? body.lastEntryId : null };
  } catch {
    return null;
  }
}

export type SessionSinceResult =
  | { kind: "ok"; messages: AgentMessage[]; entryIds: string[]; leafId: string | null }
  | { kind: "reset" }
  | { kind: "unavailable" };

/**
 * 某条 entry 之后的条目。`deferMedia`/`deferThinking` 与整窗读一致，让补差的正文
 * 也走懒加载，别把大图和思考原文再搬一遍。
 */
export async function fetchSessionSince(sessionId: string, sinceEntryId: string): Promise<SessionSinceResult> {
  try {
    const params = new URLSearchParams({
      since: sinceEntryId,
      deferThinking: "1",
      deferMedia: "1",
    });
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?${params}`, { cache: "no-store" });
    if (!res.ok) return { kind: "unavailable" };
    const body = await res.json() as {
      sinceReset?: unknown;
      leafId?: unknown;
      context?: { messages?: AgentMessage[]; entryIds?: string[] };
    };
    if (body.sinceReset === true) return { kind: "reset" };
    return {
      kind: "ok",
      messages: body.context?.messages ?? [],
      entryIds: body.context?.entryIds ?? [],
      leafId: typeof body.leafId === "string" ? body.leafId : null,
    };
  } catch {
    return { kind: "unavailable" };
  }
}
