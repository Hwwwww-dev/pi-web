import { getAssistantErrorMessage, isAssistantTruncated, splitFinalAssistantBlocks } from "./message-display";
import { extractTurnWrittenFiles, type WrittenFile } from "./turn-written-files";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, CustomMessage, TextContent, ThinkingContent, ToolCallContent, ToolResultMessage } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Turn view-model: pure derivations shared by ChatWindow's finished-turn
// rendering. Kept out of the component so a streaming render can reuse the
// previous pass's object identities (MessageView / TurnActivityBody memo).
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}

export type ActivityItem =
  | { kind: "thinking"; key: string; block: ThinkingContent; duration?: number; entryId?: string; blockIndex: number; searchTarget?: boolean }
  | { kind: "text"; key: string; block: TextContent; searchTarget?: boolean }
  | { kind: "tool"; key: string; block: ToolCallContent; result?: ToolResultMessage; duration?: number; usage?: TurnUsage; ctxTokens?: number; searchTarget?: boolean }
  | { kind: "custom"; key: string; message: CustomMessage; searchTarget?: boolean };

export function formatUsage(usage: TurnUsage): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

export function usageOf(messageUsage: {
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number };
} | null | undefined): TurnUsage | null {
  if (!messageUsage) return null;
  return {
    input: messageUsage.input ?? 0,
    output: messageUsage.output ?? 0,
    cacheRead: messageUsage.cacheRead ?? 0,
    cacheWrite: messageUsage.cacheWrite ?? 0,
    cost: { total: messageUsage.cost?.total ?? 0 },
  };
}

/** Prompt tokens a provider charged for one request: non-cached input plus cache reads/writes. */
export function promptTokensOf(usage: { input?: number; cacheRead?: number; cacheWrite?: number }): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/** Compact token counts, matching the top-bar stats format. */
export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export interface UsageContextPart {
  /** Prompt tokens of the next model request — the context occupancy after this point. */
  tokens?: number;
  /** Live reading (current conversation tail); used when no next request exists yet. */
  percent?: number | null;
  contextWindow?: number;
}

export function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

/**
 * Flattens a turn's process messages (assistant blocks + custom messages) into
 * ordered activity items for TurnActivityBody. Block indices are the original
 * `message.content` positions so deferred thinking can be re-fetched by index.
 */
export function buildTurnActivityItems({ messages, startIdx, endIdx, entryIds, toolResults, searchEntryId, searchBlock, processBlockLimitByIdx }: {
  messages: AgentMessage[];
  startIdx: number;
  endIdx: number;
  entryIds: (string | undefined)[];
  toolResults: Map<string, ToolResultMessage>;
  searchEntryId?: string;
  searchBlock?: AssistantContentBlock;
  /** Message idx → exclusive block count (drops the final answer's own blocks). */
  processBlockLimitByIdx?: Map<number, number>;
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  // nextPromptTokens[i] = prompt tokens of the nearest assistant request after
  // index i — the context occupancy at that point of the conversation.
  const nextPromptTokens: (number | undefined)[] = new Array(messages.length);
  let accPromptTokens: number | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    nextPromptTokens[i] = accPromptTokens;
    const messageUsage = (messages[i] as AssistantMessage | undefined)?.usage;
    if (messages[i]?.role === "assistant" && messageUsage) accPromptTokens = promptTokensOf(messageUsage);
  }
  for (let idx = startIdx; idx < endIdx; idx++) {
    const message = messages[idx];
    if (!message) continue;
    const entryId = entryIds[idx];
    const hitsEntry = searchEntryId !== undefined && entryId === searchEntryId;
    if (message.role === "custom") {
      items.push({ kind: "custom", key: `custom-${entryId ?? idx}`, message: message as CustomMessage, searchTarget: hitsEntry });
      continue;
    }
    if (message.role !== "assistant") continue;
    const assistantMessage = message as AssistantMessage;
    const content = assistantMessage.content ?? [];
    const limit = processBlockLimitByIdx?.get(idx) ?? content.length;
    // Same file-timestamp estimate AssistantMessageView used: time from the
    // previous message to this one approximates the thinking block's duration.
    const prevMessage = messages[idx - 1] as (AgentMessage & { timestamp?: number }) | undefined;
    let thinkingDuration: number | undefined;
    if (assistantMessage.timestamp && prevMessage?.timestamp) {
      const secs = Math.round((assistantMessage.timestamp - prevMessage.timestamp) / 1000);
      if (secs > 0) thinkingDuration = secs;
    }
    for (let blockIdx = 0; blockIdx < content.length && blockIdx < limit; blockIdx++) {
      const block = content[blockIdx];
      if (block.type === "thinking" && !block.deferred && block.thinking.trim() === "") continue;
      const searchTarget = hitsEntry && block === searchBlock;
      if (block.type === "thinking") {
        items.push({ kind: "thinking", key: `thinking-${entryId ?? idx}-${blockIdx}`, block: block as ThinkingContent, duration: thinkingDuration, entryId, blockIndex: blockIdx, searchTarget });
        continue;
      }
      if (block.type === "toolCall") {
        const toolCall = block as ToolCallContent;
        const result = toolResults.get(toolCall.toolCallId);
        let duration: number | undefined;
        if (result?.timestamp && assistantMessage.timestamp) {
          const secs = Math.round((result.timestamp - assistantMessage.timestamp) / 1000);
          if (secs > 0) duration = secs;
        }
        items.push({
          kind: "tool",
          key: `tool-${toolCall.toolCallId ?? `${entryId ?? idx}-${blockIdx}`}`,
          block: toolCall,
          result,
          duration,
          usage: usageOf(assistantMessage.usage) ?? undefined,
          ctxTokens: nextPromptTokens[idx],
          searchTarget,
        });
        continue;
      }
      if (block.type === "text") {
        items.push({ kind: "text", key: `text-${entryId ?? idx}-${blockIdx}`, block: block as TextContent, searchTarget });
      }
    }
  }
  return items;
}

/** Sums the usage of every assistant message in a turn for the meta line. */
export function summarizeTurnUsage({ messages, startIdx, endIdx }: {
  messages: AgentMessage[];
  startIdx: number;
  endIdx: number;
}): { usage: TurnUsage | null; lastAssistant: AssistantMessage | null } {
  let usage: TurnUsage | null = null;
  let lastAssistant: AssistantMessage | null = null;
  for (let idx = startIdx; idx < endIdx; idx++) {
    const message = messages[idx];
    if (message?.role !== "assistant") continue;
    const assistantMessage = message as AssistantMessage;
    lastAssistant = assistantMessage;
    const messageUsage = assistantMessage.usage;
    if (messageUsage) {
      usage ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } };
      usage.input += messageUsage.input ?? 0;
      usage.output += messageUsage.output ?? 0;
      usage.cacheRead += messageUsage.cacheRead ?? 0;
      usage.cacheWrite += messageUsage.cacheWrite ?? 0;
      usage.cost.total += messageUsage.cost?.total ?? 0;
    }
  }
  return { usage, lastAssistant };
}

export interface FinishedTurnView {
  finalAssistantIdx: number;
  finalAnswerMessage: AssistantMessage | null;
  writtenFiles: WrittenFile[];
  activityItems: ActivityItem[];
  processBlockLimitByIdx: Map<number, number> | undefined;
  usage: TurnUsage | null;
  lastAssistant: AssistantMessage | null;
  /** Prompt tokens of the next model request — context occupancy after this turn. */
  nextPromptTokens?: number;
}

// A finished turn's messages are append-only, so the view only changes when the
// turn's entry range or the search target changes. Caching by that fingerprint
// keeps `finalAnswerMessage` / `writtenFiles` / `activityItems` identities
// stable across list recomputes, which is what lets the memoized message views
// skip re-rendering while a session streams or older pages load.
const finishedTurnViewCache = new Map<string, FinishedTurnView>();
const FINISHED_TURN_VIEW_CACHE_MAX = 1024;

/** First assistant request after `fromIdx`: its prompt size and entry id. */
function scanNextPrompt(messages: AgentMessage[], entryIds: (string | undefined)[], fromIdx: number): { tokens?: number; entryId?: string } {
  for (let idx = fromIdx; idx < messages.length; idx++) {
    const message = messages[idx];
    if (message?.role !== "assistant") continue;
    const usage = (message as AssistantMessage).usage;
    if (usage) return { tokens: promptTokensOf(usage), entryId: entryIds[idx] };
  }
  return {};
}

export function getFinishedTurnView({ messages, userIdx, endIdx, finalAssistantIdx, entryIds, cwd, searchEntryId, searchBlockKey, searchBlock }: {
  messages: AgentMessage[];
  userIdx: number;
  endIdx: number;
  finalAssistantIdx: number;
  entryIds: (string | undefined)[];
  cwd?: string;
  searchEntryId?: string;
  searchBlockKey?: number | string;
  searchBlock?: AssistantContentBlock;
}): FinishedTurnView {
  const fingerprintBase = `${entryIds[userIdx] ?? `#${userIdx}`}|${endIdx - userIdx}|${entryIds[endIdx - 1] ?? `#${endIdx - 1}`}|${searchEntryId ?? ""}|${searchBlockKey ?? ""}|${cwd ?? ""}`;
  // The turn's context occupancy depends on the next request, which only exists
  // once a later turn has been added — recompute when that message appears.
  const nextPromptProbe = scanNextPrompt(messages, entryIds, endIdx);
  const fingerprint = `${fingerprintBase}|${nextPromptProbe.entryId ?? ""}`;
  const cached = finishedTurnViewCache.get(fingerprint);
  if (cached) return cached;

  const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
  const finalSplit = splitFinalAssistantBlocks(finalAssistant);
  const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant) || isAssistantTruncated(finalAssistant)
    ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks, { omitUsage: true })
    : null;

  // The final assistant's answer blocks render as the reply; only its process
  // prefix feeds the activity rows.
  const finalProcessEnd = finalAssistant.content.indexOf(finalSplit.answerBlocks[0]);
  const processBlockLimitByIdx = finalProcessEnd < 0 ? undefined : new Map([[finalAssistantIdx, finalProcessEnd]]);

  // The turn's own toolResult messages pair its tool calls; results still in
  // flight (activeToolResults) only matter for the live tail, which is never
  // cached. A page boundary can split a call from its result — then the row
  // renders without it, exactly like the uncached path did.
  const toolResults = new Map<string, ToolResultMessage>();
  for (let idx = userIdx; idx < endIdx; idx++) {
    const message = messages[idx];
    if (message?.role === "toolResult") {
      toolResults.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
    }
  }

  const activityItems = buildTurnActivityItems({
    messages,
    startIdx: userIdx + 1,
    endIdx: finalAssistantIdx + 1,
    entryIds,
    toolResults,
    searchEntryId,
    searchBlock,
    processBlockLimitByIdx,
  });

  // Each tool call is stored as its own assistant entry, so the final answer
  // alone carries no record of what the turn wrote. Gather the turn's assistant
  // blocks and derive the file list from the write/edit calls among them.
  const turnContent: AssistantContentBlock[] = [];
  for (let i = userIdx + 1; i <= finalAssistantIdx; i++) {
    const message = messages[i];
    if (message?.role === "assistant") {
      for (const block of (message as AssistantMessage).content ?? []) turnContent.push(block);
    }
  }
  const writtenFiles = extractTurnWrittenFiles(turnContent, toolResults, cwd);

  const { usage, lastAssistant } = summarizeTurnUsage({ messages, startIdx: userIdx + 1, endIdx: finalAssistantIdx + 1 });

  const view: FinishedTurnView = {
    finalAssistantIdx,
    finalAnswerMessage,
    writtenFiles,
    activityItems,
    processBlockLimitByIdx,
    usage,
    lastAssistant,
    nextPromptTokens: nextPromptProbe.tokens,
  };
  if (finishedTurnViewCache.size >= FINISHED_TURN_VIEW_CACHE_MAX) finishedTurnViewCache.clear();
  finishedTurnViewCache.set(fingerprint, view);
  return view;
}
