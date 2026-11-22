import { getAssistantErrorMessage, isAssistantTruncated, splitFinalAssistantBlocks } from "./message-display";
import { getToolCategory } from "./tool-categories";
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

/**
 * One request's usage — the request that issued a tool call.
 *
 * A tool result carries none of its own, so the number belongs to "the request
 * behind this step", not to "this tool".
 */
export interface StepUsage {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}

export type ActivityItem =
  | { kind: "thinking"; key: string; block: ThinkingContent; duration?: number; entryId?: string; blockIndex: number; searchTarget?: boolean; ts?: number }
  | { kind: "text"; key: string; block: TextContent; searchTarget?: boolean; ts?: number }
  | { kind: "tool"; key: string; block: ToolCallContent; result?: ToolResultMessage; duration?: number; stepUsage?: StepUsage; searchTarget?: boolean; ts?: number }
  | { kind: "custom"; key: string; message: CustomMessage; searchTarget?: boolean; ts?: number }
  ;

/** 活动按中途回复切段后的渲染件：折叠段与外部显示的回复文本，按时间序交替。 */
export type TurnPart =
  | { kind: "fold"; items: ActivityItem[] }
  | { kind: "reply"; key: string; block: TextContent; searchTarget?: boolean }
  | { kind: "checkpoint"; view: CheckpointView };

/**
 * 压缩在对话里留下的那条分界线（Checkpoint）。`before`/`after` 是压缩前后的
 * 上下文量，取自压缩工具自己的结果行（`▣ ACP | 128.9K → 9.4K tokens (...)`）；
 * `summary` 是这次压缩的摘要正文（工具参数里的 `content[].summary`），
 * 点开 Popover 才看。
 */
export interface CheckpointView {
  key: string;
  state: "running" | "done" | "error";
  /** 第一个区间的摘要（触发区判断能不能点开、复制用）。 */
  summary?: string;
  /** 这次压缩的全部摘要：一次压多个区间时，`content[]` 每项一份。 */
  summaries?: string[];
  /** 压缩工具返回的全文（用量行、各块范围、可压区间清单），Popover 原样展示。 */
  result?: string;
  before?: string;
  after?: string;
  /** 失败时的原因（结果文本首行）。 */
  detail?: string;
}

/** 压缩工具结果里的用量行：`128.9K → 9.4K tokens`。 */
const COMPACT_TOKEN_DELTA = /([\d.,]+\s?[KMB]?)\s*→\s*([\d.,]+\s?[KMB]?)\s*tokens/i;

/** 消息内容里的纯文本（字符串或 text 块数组，两种都见过）。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => Boolean(block) && typeof block === "object"
      && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n");
}

function compactSummariesOfInput(input: Record<string, unknown> | undefined): string[] {
  const blocks = input?.content;
  if (!Array.isArray(blocks)) return [];
  const summaries: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const summary = (block as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim()) summaries.push(summary);
  }
  return summaries;
}

/**
 * 把一条活动行读成压缩分界线；不是压缩就返回 null。两种来源：pi 自己写进
 * JSONL 的压缩消息（`custom` + `customType: "compaction"`），以及 compress
 * 工具的调用行（跑完带结果，跑着没结果，出错带 isError）。
 */
export function checkpointViewOf(item: ActivityItem): CheckpointView | null {
  if (item.kind === "custom") {
    const customType = (item.message as { customType?: unknown }).customType;
    if (customType !== "compaction") return null;
    const text = textOf(item.message.content);
    const tokensBefore = (item.message.details as { tokensBefore?: unknown } | undefined)?.tokensBefore;
    return {
      key: item.key,
      state: "done",
      summary: text.trim() || undefined,
      before: typeof tokensBefore === "number" && Number.isFinite(tokensBefore) ? tokensBefore.toLocaleString() : undefined,
    };
  }
  if (item.kind !== "tool" || item.block.toolName !== "compress") return null;
  const summaries = compactSummariesOfInput(item.block.input);
  const summary = summaries[0];
  if (!item.result) {
    return { key: item.key, state: "running", ...(summary ? { summary, summaries } : {}) };
  }
  if (item.result.isError) {
    const resultText = textOf(item.result.content).trim();
    const detail = resultText.split("\n")[0]?.trim();
    return {
      key: item.key,
      state: "error",
      ...(summary ? { summary, summaries } : {}),
      ...(resultText ? { result: resultText } : {}),
      detail: detail || undefined,
    };
  }
  const resultText = textOf(item.result.content);
  const delta = COMPACT_TOKEN_DELTA.exec(resultText);
  return {
    key: item.key,
    state: "done",
    ...(summary ? { summary, summaries } : {}),
    ...(resultText.trim() ? { result: resultText.trim() } : {}),
    before: delta ? delta[1].replace(/\s/g, "") : undefined,
    after: delta ? delta[2].replace(/\s/g, "") : undefined,
  };
}

/**
 * 活动行按回复切段：回合内由 pi 边运行边输出的文本不再收入折叠，而是作为
 * 普通文本段显示在外，两段回复之间的思考与工具各自构成一个行内大折叠。
 * 活跃期与完成态使用同一套切分，段序号才能与折叠键逐段对应。
 */
export function splitTurnParts(items: ActivityItem[]): TurnPart[] {
  const parts: TurnPart[] = [];
  let current: ActivityItem[] = [];
  const flush = () => {
    if (current.length > 0) parts.push({ kind: "fold", items: current });
    current = [];
  };
  for (const item of items) {
    if (item.kind === "text") {
      flush();
      parts.push({ kind: "reply", key: item.key, block: item.block, searchTarget: item.searchTarget });
      continue;
    }
    const checkpoint = checkpointViewOf(item);
    if (checkpoint) {
      flush();
      parts.push({ kind: "checkpoint", view: checkpoint });
      continue;
    }
    current.push(item);
  }
  flush();
  return parts;
}

/**
 * 一段活动的摘要原始数据：结算段与活跃回合的已完成段使用同一套口径，
 * 单次遍历同时得出四大类计数、失败数、首尾时间戳与条目自报时长之和。
 * i18n 拼接留在组件层，此处只输出数值。
 *
 * 口径：读取 = view/search/web，编辑 = edit/write/patch，运行 = 终端，子代理单独
 * 一类；plan/compact/other 不进摘要（太碎）。时长优先取首尾时间戳之差，取不到
 * 时用条目自身的 duration 兜底（thinking 记秒、tool 记毫秒）。
 */
export interface SegmentActivitySummary {
  counts: { read: number; edit: number; run: number; subagent: number };
  failed: number;
  firstTs?: number;
  lastTs?: number;
  durationMs: number;
}

export function summarizeSegmentActivity(items: ActivityItem[]): SegmentActivitySummary {
  const summary: SegmentActivitySummary = { counts: { read: 0, edit: 0, run: 0, subagent: 0 }, failed: 0, durationMs: 0 };
  for (const item of items) {
    if (item.ts !== undefined) {
      summary.firstTs ??= item.ts;
      summary.lastTs = item.ts;
    }
    if (item.kind === "thinking") {
      summary.durationMs += (item.duration ?? 0) * 1000;
      continue;
    }
    if (item.kind !== "tool") continue;
    summary.durationMs += item.duration ?? 0;
    if (item.result?.isError) summary.failed += 1;
    switch (getToolCategory(item.block.toolName)) {
      case "terminal": summary.counts.run += 1; break;
      case "edit": summary.counts.edit += 1; break;
      case "subagent": summary.counts.subagent += 1; break;
      case "view":
      case "search":
      case "web": summary.counts.read += 1; break;
      default: break;
    }
  }
  return summary;
}

export function formatUsage(usage: TurnUsage): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

/** 完整时间戳（本地时区 YYYY-MM-DD HH:mm:ss），回合行的悬浮说明用。 */
export function formatFullTimestamp(ts?: number | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Prompt tokens a provider charged for one request: non-cached input plus cache reads/writes. */
function promptTokensOf(usage: { input?: number; cacheRead?: number; cacheWrite?: number }): number {
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

function withAssistantBlocks(
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
  for (let idx = startIdx; idx < endIdx; idx++) {
    const message = messages[idx];
    if (!message) continue;
    const entryId = entryIds[idx];
    const hitsEntry = searchEntryId !== undefined && entryId === searchEntryId;
    if (message.role === "custom") {
      items.push({ kind: "custom", key: `custom-${entryId ?? idx}`, message: message as CustomMessage, searchTarget: hitsEntry, ts: (message as { timestamp?: number }).timestamp });
      continue;
    }
    if (message.role !== "assistant") continue;
    const assistantMessage = message as AssistantMessage;
    const content = assistantMessage.content ?? [];
    const limit = processBlockLimitByIdx?.get(idx) ?? content.length;
    // pi 1.1 records the response's own generation time (`durationMs`, from the
    // request's start); the timestamps only give the gap from the previous
    // message, i.e. how long the request waited before it was answered.
    const prevMessage = messages[idx - 1] as (AgentMessage & { timestamp?: number }) | undefined;
    let thinkingDuration: number | undefined;
    const recorded = assistantMessage.durationMs;
    if (recorded !== undefined) {
      const secs = recorded / 1000;
      if (secs >= 0.1) thinkingDuration = secs;
    } else if (assistantMessage.timestamp && prevMessage?.timestamp) {
      // 保留小数：先取整会将 0.4s 的思考时长抹为 0 而不显示（要求 0.1s 以上均需显示）。
      const secs = (assistantMessage.timestamp - prevMessage.timestamp) / 1000;
      if (secs >= 0.1) thinkingDuration = secs;
    }
    for (let blockIdx = 0; blockIdx < content.length && blockIdx < limit; blockIdx++) {
      const block = content[blockIdx];
      if (block.type === "thinking" && !block.deferred && block.thinking.trim() === "") continue;
      const searchTarget = hitsEntry && block === searchBlock;
      if (block.type === "thinking") {
        items.push({ kind: "thinking", key: `thinking-${entryId ?? idx}-${blockIdx}`, block: block as ThinkingContent, duration: thinkingDuration, entryId, blockIndex: blockIdx, searchTarget, ts: assistantMessage.timestamp });
        continue;
      }
      if (block.type === "toolCall") {
        const toolCall = block as ToolCallContent;
        const result = toolResults.get(toolCall.toolCallId);
        let duration: number | undefined;
        if (result) {
          // pi 1.1 records the execution itself (durationMs); older results fall
          // back to the timestamps' difference.
          const recorded = (result as ToolResultMessage & { durationMs?: number }).durationMs;
          if (recorded !== undefined) {
            duration = recorded;
          } else if (result.timestamp && assistantMessage.timestamp) {
            const secs = (result.timestamp - assistantMessage.timestamp) / 1000;
            if (secs >= 0.1) duration = secs * 1000;
          }
        }
        items.push({
          kind: "tool",
          key: `tool-${toolCall.toolCallId ?? `${entryId ?? idx}-${blockIdx}`}`,
          block: toolCall,
          result,
          duration,
          // Parallel calls in one assistant message show the same numbers: that
          // request is the step's cost, and it is what was asked for.
          stepUsage: assistantMessage.usage
            ? {
              input: assistantMessage.usage.input ?? 0,
              output: assistantMessage.usage.output ?? 0,
              cacheRead: assistantMessage.usage.cacheRead ?? 0,
              cost: assistantMessage.usage.cost?.total ?? 0,
            }
            : undefined,
          searchTarget,
          ts: assistantMessage.timestamp,
        });
        continue;
      }
      if (block.type === "text") {
        if (searchTarget || (block as TextContent).text.trim().length > 0) {
          items.push({ kind: "text", key: `text-${entryId ?? idx}-${blockIdx}`, block: block as TextContent, searchTarget, ts: assistantMessage.timestamp });
        }
      }
    }
  }
  return items;
}

/**
 * Sums the usage of every assistant message in a turn for the meta line.
 * Cache read/write are not summable — each request re-reads the whole cached
 * prompt — so they report the turn's last request (the live cache hit), like
 * the top bar's cache segment.
 */
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
      usage.cacheRead = messageUsage.cacheRead ?? 0;
      usage.cacheWrite = messageUsage.cacheWrite ?? 0;
      usage.cost.total += messageUsage.cost?.total ?? 0;
    }
  }
  return { usage, lastAssistant };
}

/**
 * 被截断的回合头（窗口从回合中间开始）是否已经走到这一轮的终点：下一个锚点出现，
 * 或窗口止于叶子且没有在跑。只有到这时候整轮求和才有意义：运行中那一轮的用量行等
 * 整轮结束后才出现。
 */
export function headSegmentEndsTurn({ headEnd, messageCount, running }: {
  headEnd: number;
  messageCount: number;
  running: boolean;
}): boolean {
  return headEnd < messageCount || !running;
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
  // flight (the active tools store) only matter for the live tail, which is
  // never cached. A page boundary can split a call from its result — then the
  // row renders without it, exactly like the uncached path did.
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
