"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { toast } from "sonner";
import { stripAnsi } from "@/lib/ansi";
import type {
  AgentMessage,
  BlockingExtensionUiRequest,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  HeadTurnSummary,
  SessionInfo,
  SessionTreeNode,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";
import { isBlockingExtensionUiRequest } from "@/lib/browser-notifications";
import { clearSessionAway, readSessionAway, recordSessionAway } from "@/lib/session-away";
import { normalizeToolCalls } from "@/lib/normalize";
import { AgentCommandError, agentStatusUrl, EXTENSION_REPORTED_CODE, isPromptRejectedError, sendAgentCommand } from "@/lib/agent-client";
import { createSideChat, SIDE_REFUSAL_MESSAGES } from "@/lib/side-chat-client";
import { missingCwdFromBody } from "@/lib/missing-cwd";
import { fetchSessionSince, probeSessionTail } from "@/lib/session-align";
import {
  deleteSessionViewSnapshot,
  getSessionViewSnapshot,
  setSessionViewSnapshot,
  snapshotCoversLoadedEntries,
} from "@/lib/session-view-cache";
import { clearDraft, getDraft, parkedNewSessionDraftKey, rekeyDraft, restoreDraftSubmission, setDraft, type ChatDraft, type ChatDraftImage } from "@/lib/draft-store";
import { getPreferredToolPreset, setPreferredToolPreset } from "@/lib/tool-preset-preference";
import { CONFIGURED_TOOL_PRESET, getPresetFromToolNames, getToolNamesForPreset, type ToolEntry, type ToolPreset } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionFileStats } from "@/lib/session-stats";
import { userMessageKey } from "@/lib/prompt-recovery";
import {
  createQueuedImageMemory,
  createQueueSnapshotGate,
  createQueuedSubmission,
  emptyQueuedMessages,
  queuedGraceDeadline,
  hasUnconfirmedQueuedRecord,
  queuedImageRecall,
  reconcileQueuedSubmissions,
  splitClearedQueue,
  moveQueuedEntry,
  type QueuedBehavior,
  type QueuedMessages,
  type QueuedSnapshotEntry,
  type QueuedSubmission,
} from "@/lib/queued-submissions";
import { carryMessageKeys, mergeLoadedTail, messageRenderKeys } from "@/lib/message-keys";
import {
  AgentEventConnection,
  canReleaseHiddenEventStream,
  SESSION_LEASE_TIMEOUT_MS,
  sessionLeaseShowsActivity,
  type SessionLeaseReply,
} from "@/lib/agent-event-connection";
import { HIDDEN_PAGE_GRACE_MS } from "@/hooks/usePageHidden";
import type { AttachedImage } from "@/components/ChatInput";
import type { DebugClientLease, DebugClientSession, DebugEventConnectionSnapshot, DebugStreamCloseReason } from "@/lib/debug-types";
import { pageId, peekPageId, trackEventSource } from "@/lib/page-debug";
import type { TranslationParams } from "@/lib/i18n/types";
import { AGENT_EVENT_HEARTBEAT_MS, isNestedToolExecutionEvent, isSystemMessageEvent } from "@/lib/agent-event-wire";
import { createAgentPhaseStore, runStatePhase } from "@/lib/chat-phase-label";
import { createActiveToolsStore } from "@/lib/active-tools";
import { getToolExecutionProgress } from "@/lib/tool-execution-progress";
import { CODEMODE_TOOL_NAME, getCodemodeProgress } from "@/lib/codemode-view";
import { updateExtensionWidgets } from "@/lib/extension-widgets";
import { createShownNotices, extensionErrorMessage } from "@/lib/startup-issues";
import { bareMcpOpensSettings } from "@/lib/mcp-command";
import { copyText } from "@/lib/clipboard";
import type { SettingsSection } from "@/lib/settings-navigation";
import { withTranscriptNotices, type TranscriptNotice } from "@/lib/transcript-notices";
import {
  enqueueExtensionUiRequest,
  removeExtensionUiRequest,
  retainExtensionUiRequests,
  upsertExtensionUiRequest,
} from "@/lib/extension-ui-queue";
import {
  advancedValue,
  awayReloadMs,
  olderPageTurns,
  pageTurns,
} from "@/lib/advanced-values";
import {
  createStreamingStore,
  type ClientAssistantMessageEvent,
} from "@/lib/streaming-message";

export interface SessionData {
  sessionId: string;
  filePath: string;
  totalActiveMs: number;
  tree: SessionTreeNode[];
  leafId: string | null;
  toolNames?: string[];
  /** Opaque freshness token for the session view cache (summary tree reads). */
  snapshotRevision?: string | null;
  /** "summary" when `tree` carries the body-free navigation format. */
  treeFormat?: "summary";
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    oldestEntryId: string | null;
    hasMore: boolean;
    turnsBefore: number;
    newestEntryId?: string | null;
    hasNewer?: boolean;
    /** The turn the window's first entry sits inside (a page that begins mid-turn). */
    headTurn?: HeadTurnSummary;
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
  /** Cumulative usage over ALL session-file entries (incl. compacted history). */
  stats?: SessionFileStats;
  /** True when GET ?force=1 dropped a stale live wrapper and rebuilt from disk. */
  wrapperRebuilt?: boolean;
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

interface LastAssistantTextResponse {
  text?: string;
}

type AgentStateResponse = {
  model?: { provider: string; id: string };
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  mcpServers?: { total: number; ready: number; needsAuth: number } | null;
  /** Active time over the live wrapper's entries (the snapshot carries the same field). */
  totalActiveMs?: number;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
  queuedEntries?: QueuedSnapshotEntry[];
};

export type { QueuedMessages, QueuedSubmission };

/** The messages without that one (by identity, its last occurrence); the same array when it is absent. */
function withoutMessage(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
  const index = messages.lastIndexOf(message);
  return index === -1 ? messages : [...messages.slice(0, index), ...messages.slice(index + 1)];
}

function countUserMessages(messages: readonly AgentMessage[], key: string): number {
  return messages.reduce((count, message) => (
    message.role === "user" && userMessageKey(message) === key ? count + 1 : count
  ), 0);
}

function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
export type NoticeType = "info" | "success" | "warning" | "error";

// 弹窗通知统一由 sonner 承担：addNotice 直接发 toast，同一 id 替换而不堆叠；
// error 常驻至手动关闭，其余 5s 自动消失，悬停暂停为 sonner 内置行为。
const NOTICE_VISIBLE_MS = 5000;

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" | "openSettings" | "compact" | "openSideChat" };

/**
 * A `!` command on its way into the transcript: running, or finished during a run, whose
 * result pi holds until the run ends (`recordBashResult`) and writes before `agent_settled`.
 * The first session read after the run's end has it, and the card goes then.
 */
export interface PendingBash {
  command: string;
  excludeFromContext: boolean;
  /** When it started, the card's identity (its expanded state is per card). */
  startedAt: number;
  /** What the command printed so far, the tail of the wrapper's `bash_output` snapshots; the result replaces it. */
  liveOutput?: string;
  result?: { output: string; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string };
}

/** How a run ended, for the completion sound and notifications. */
export interface AgentEndInfo {
  /** The run was stopped (Esc, Stop, another client's abort), not finished: nothing to announce. */
  aborted: boolean;
  /** Which session's run ended; lets the app notify a background (kept-alive) session, not just the selected one. */
  sessionId?: string | null;
  /**
   * Subagents of this session are still at work and will report back with a run of their own:
   * the task is not done yet, so nothing to announce either (#1434).
   */
  subagentsActive?: boolean;
  /** 这轮以错误收尾（模型/网关报错、回复失败）：通知的标题是“任务失败”，不是“任务完成”。 */
  failed?: boolean;
}

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  /** A run ended; `aborted` when it was stopped rather than finished (pi's `agent_settled.aborted`). */
  onAgentEnd?: (end: AgentEndInfo) => void;
  /** An extension's `ctx.shutdown()` ended this session's runtime, as pi quits. Its file may remain. */
  onSessionEnded?: (sessionId: string) => void;
  /** A top-level tool call finished; the files it touched may have changed. */
  onToolEnd?: (toolName: string) => void;
  /** A blocking request arrived; `ownerSessionId` is the session whose stream raised it (background slots included). */
  onAttentionNeeded?: (request: BlockingExtensionUiRequest, ownerSessionId?: string | null) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  /** `/side`: a side chat was forked from this session; open its tab. The
   *  prompt argument, if any, seeds the new chat's composer. */
  onSideSession?: (session: SessionInfo, prompt: string | null) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void, locked: boolean) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemToolsChange?: (tools: ToolEntry[] | null) => void;
  onMcpServersChange?: (summary: { total: number; ready: number; needsAuth: number } | null) => void;
  /** Registers an action that lazily starts the session and loads its prompt and tools. */
  onSystemInfoLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  /** Keep-alive background slot: skips AppShell-wide state reporting (branch tree, system info panel, stats) so background instances cannot overwrite the visible session's state. */
  background?: boolean;
  /** Dormant keep-alive slot: hidden so long its message list was unloaded to free DOM; reactivation reloads the session once. */
  dormant?: boolean;
  /** Registers the debug panel's reader of this page's stream and lease: it reads refs only, never a request. */
  onDebugSnapshotReaderChange?: (reader: (() => DebugClientSession) | null) => void;
  /** Registers the manual reload action (topbar menu): re-mounts the current session's 3-turn window. */
  onReloadSessionChange?: (fn: (() => void) | null) => void;
  onSessionStatsPanelOpen?: () => void;
  /** Opens Settings on a section; a bare `/mcp` the built-in MCP extension owns opens Settings › MCP. */
  onOpenSettings?: (section: SettingsSection) => void;
  setToolPreset?: (preset: ToolPreset) => void;
  /** A fresh composer's model and reasoning picks to start with: the composer it replaces had them. */
  initialNewSessionChoices?: NewSessionChoices | null;
  /** A fresh composer reports its own model and reasoning picks, on mount and as they change. */
  onNewSessionChoicesChange?: (choices: NewSessionChoices) => void;
  /** The page's translator, for the notices the hook writes itself. */
  t: (key: string, params?: TranslationParams) => string;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ConcreteThinkingLevel = Exclude<ThinkingLevelOption, "auto">;

/**
 * What a fresh composer was told to use instead of the automatic choice. The
 * bar above it moves the composer to another folder by remounting it; these
 * go along with the draft. (The tool preset needs no carrying: a pick is the
 * browser's preference, which every fresh composer starts from.)
 */
export interface NewSessionChoices {
  model: { provider: string; modelId: string } | null;
  thinkingLevel: ConcreteThinkingLevel | null;
}

function asConcreteThinkingLevel(value?: string | null): ConcreteThinkingLevel | null {
  if (!value || value === "auto") return null;
  return value as ConcreteThinkingLevel;
}

// Session id -> user entry being edited. ChatWindow remounts per session, so a
// pending edit lives here as long as that session's in-memory draft does.
const pendingHistoryEdits = new Map<string, string>();

const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const EVENT_STREAM_IDLE_GRACE_MS = 30_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
/** While queue rows are visible the state poll tightens to this: a paused or closed SSE stream leaves rows stale until the next read. */
const QUEUE_FAST_RECONCILE_MS = 3_000;
const BASH_STATE_RECONCILE_MS = 1_000;
/** Stop hands its queue back to be sent again; the stopped run has to unwind first, or a prompt rides it. */
const STOP_RESEND_SETTLE_TIMEOUT_MS = 5_000;
const STOP_RESEND_POLL_MS = 50;
const EVENT_STREAM_READY_TIMEOUT_MS = 60_000;
const EVENT_STREAM_RECONNECT_DELAY_MS = 1_000;
const SESSION_LEASE_RENEW_INTERVAL_MS = 30_000;
// A ready stream silent for two and a half heartbeats is dead (AgentEventConnection reconnects).
/** 流被判定为“已死”的静默时长：心跳间隔的 2.5 倍（Settings › 高级参数）。 */
function eventStreamStaleMs(): number {
  return (advancedValue<number>("sseHeartbeatMs") || AGENT_EVENT_HEARTBEAT_MS) * 2.5;
}
type SessionLeaseOutcome = SessionLeaseReply | "unanswered" | null;
function sessionLeaseUrl(sid: string): string {
  return `/api/agent/${encodeURIComponent(sid)}/lease`;
}
// Retry temporary model-list failures without requiring a page refresh.
const MODELS_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
// A session's startup issues come with every stream it opens (lib/rpc-manager.ts): this page
// shows each once, through reconnects and returns to the session.
const isFirstNoticeShowing = createShownNotices();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  setText: (text: string) => void;
  pasteText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  prependQueuedMessage: (text: string, images: Array<{ data: string; mimeType: string }>) => void;
  addImages: (files: File[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: Array<{ data: string; mimeType: string }>, targetDraftKey?: string) => void;
}

type SelectedModel = { provider: string; modelId: string };
/**
 * A normal send whose prompt request failed without the server's refusal (#1432):
 * what to give back should the server turn out never to have got it.
 */
type UnconfirmedSend = {
  runId: number;
  sid: string;
  message: string;
  images?: AttachedImage[];
  draftKey: string | undefined;
  /** A fresh composer's: the cwd's parked draft, which the next fresh composer there takes back. */
  parkedDraftKey: string | null;
  /** The view's last saved entry when the prompt was sent: the prompt can only show up after it. */
  lastEntryIdAtSend: string | null;
  /** User messages with the same text the view already had after that entry (sent before, not saved yet when read). */
  sameTextAfterSend: number;
  /** The optimistic bubble, dropped with its text's return once a read shows the prompt is not there. */
  bubble: AgentMessage;
  /** userMessageKey() of the optimistic bubble: the user message the prompt becomes. */
  key: string;
  /** A slash command: an extension command or template need not become that user message. */
  command: boolean;
};
/** `clear_queue` and `abort`: queued texts, plus the images of prompts parked behind a compaction. */
type RecalledPrompts = {
  steering?: string[];
  followUp?: string[];
  images?: Array<{ data: string; mimeType: string }>;
  /** Stop hands back every queued prompt in send order, to be sent again once the run has unwound. */
  queued?: StopQueueEntry[];
};
/** One queued prompt Stop hands back, with the behavior it was queued under. */
type StopQueueEntry = {
  text: string;
  behavior: "steer" | "followUp";
  images?: Array<{ data: string; mimeType: string }>;
};
type ModelEntry = { id: string; name: string; provider: string; providerName: string };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  defaultThinkingLevel?: string | null;
  savedDefaultThinkingLevel?: string | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  thinkingLevelPins?: Record<string, string>;
  modelError?: string;
  modelScopeWarnings?: string[];
  isScoped?: boolean;
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

/**
 * 过滤一页中已在列表内的条目。重复下发的页以及与上一页重叠的页均会将同一消息插入两次，
 * 并影响阅读位置与已加载条数。
 */
function dedupePage(ids: readonly string[], messages: readonly AgentMessage[], existing: readonly string[]) {
  const seen = new Set(existing);
  const entryIds: string[] = [];
  const kept: AgentMessage[] = [];
  ids.forEach((id, index) => {
    const message = messages[index];
    if (message === undefined) return;
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    entryIds.push(id);
    kept.push(message);
  });
  return { entryIds, messages: kept };
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, newSessionDraftKey, onAgentEnd, onSessionEnded, onToolEnd, onAttentionNeeded, onSessionCreated, onSessionForked, onSideSession,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onMcpServersChange, onSystemInfoLoaderChange, onSessionStatsPanelOpen, background = false, dormant = false,
    onOpenSettings, onDebugSnapshotReaderChange, onReloadSessionChange,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;
  const initialChoices = isNew ? opts.initialNewSessionChoices ?? null : null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  // In-flight tool results and the run phase live outside React: a
  // tool_execution_update lands several times a second, and only the running
  // card (per toolCallId) and the status line subscribe to them. React state
  // here would re-render the whole chat per event.
  const [activeToolsStore] = useState(createActiveToolsStore);
  const [agentPhaseStore] = useState(createAgentPhaseStore);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  // Entry ids that took over a run's message keys when the file was read again (lib/message-keys.ts).
  const [messageKeyAliases, setMessageKeyAliases] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [hasEarlierMessages, setHasEarlierMessages] = useState(false);
  const [earlierTurnCount, setEarlierTurnCount] = useState(0);
  // Tail of the loaded page: null-or-equal to the leaf when the page reaches it.
  const [newestCursor, setNewestCursor] = useState<string | null>(null);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  // 窗口从回合中间开始时的整轮汇总；客户端只用于给被截断的回合头补一条用量行。
  const [headTurn, setHeadTurn] = useState<HeadTurnSummary | null>(null);
  // Outside React state: a streamed chunk must not re-render the whole chat (see StreamingStore).
  const [streamingStore] = useState(createStreamingStore);
  const dispatch = streamingStore.dispatch;
  const [agentRunning, setAgentRunning] = useState(false);
  const [bashRunning, setBashRunning] = useState(false);
  const [pendingBash, setPendingBash] = useState<PendingBash | null>(null);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  // The session's or composer's folder, once a route said it no longer exists (#1422).
  // Kept apart by source: a model list read from a removed worktree's main repo
  // succeeds, and must not clear what a refused prompt reported.
  const [modelsMissingCwd, setModelsMissingCwd] = useState<string | null>(null);
  const [promptMissingCwd, setPromptMissingCwd] = useState<string | null>(null);
  const missingCwd = promptMissingCwd ?? modelsMissingCwd;
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const [isModelScopeActive, setIsModelScopeActive] = useState(false);
  // Every available model, fetched only when the selector switches to "all" or the
  // shown model is outside the scope; null until then and after each loadModels.
  const [allModelList, setAllModelList] = useState<ModelEntry[] | null>(null);
  const allModelsLoadRef = useRef<object | null>(null);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(() => initialChoices?.model ?? null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [toolPreset, setToolPreset] = useState<ToolPreset>(CONFIGURED_TOOL_PRESET);
  const [newSessionThinkingLevel, setNewSessionThinkingLevel] = useState<ConcreteThinkingLevel | null>(() => initialChoices?.thinkingLevel ?? null);
  const [newSessionDefaultThinkingLevel, setNewSessionDefaultThinkingLevel] = useState<ConcreteThinkingLevel | null>(null);
  const [savedDefaultThinkingLevel, setSavedDefaultThinkingLevel] = useState<ConcreteThinkingLevel | null>(null);
  const [currentThinkingOverride, setCurrentThinkingOverride] = useState<ConcreteThinkingLevel | null>(null);
  const [liveThinkingLevel, setLiveThinkingLevel] = useState<ConcreteThinkingLevel | null>(null);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  // Active time read from the live state, with the session it belongs to: the
  // panel's snapshot is older than the transcript on screen, and this is what
  // keeps the value current while a run appends entries (#1334).
  const [liveTotalActiveMs, setLiveTotalActiveMs] = useState<{ sessionId: string; value: number } | null>(null);
  const contextUsageRequestIdRef = useRef(0);
  // Highest request id whose reply was applied. A reply applies only when it
  // is newer, so a failed newer read never discards an older good one.
  const contextUsageAppliedIdRef = useRef(0);
  // Kept in a ref: syncLiveModel is deliberately empty-deps, and the callback is gated
  // per tab in AppShell, so its identity may flip without a session reload.
  const onMcpServersChangeRef = useRef(onMcpServersChange);
  onMcpServersChangeRef.current = onMcpServersChange;
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [liveModel, setLiveModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [autoCompactionEnabled, setAutoCompactionEnabled] = useState(true);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [extensionDialogs, setExtensionDialogs] = useState<ExtensionUiDialogRequest[]>([]);
  const [extensionCustomUis, setExtensionCustomUis] = useState<ExtensionUiCustomRequest[]>([]);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedSubmissions, setQueuedSubmissions] = useState<QueuedSubmission[]>([]);
  const queuedSubmissionsRef = useRef<QueuedSubmission[]>([]);
  // Lets the SSE handlers (declared above the callback) refresh the
  // authoritative stats snapshot once a run ends.
  const refreshStatsRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    queuedSubmissionsRef.current = queuedSubmissions;
  }, [queuedSubmissions]);
  // pi reports the queue as texts. Rows are folded from those snapshots so the
  // local records keep their thumbnails while pi still lists their text.
  const lastQueueSnapshotRef = useRef<QueuedMessages>(emptyQueuedMessages());
  // HTTP queue reads travel a different channel than SSE, so this gate decides
  // whether a point-in-time reading may still apply (see createQueueSnapshotGate).
  const queueSnapshotGateRef = useRef(createQueueSnapshotGate());
  // The same staleness rule as the queue, for extension statuses and widgets:
  // an HTTP state read travels a different channel than the `setStatus` /
  // `setWidget` SSE events and can land after them, wiping a chip that was
  // just set. Every SSE change observes; a read only applies when nothing was
  // observed since it was issued.
  const extensionUiGateRef = useRef(createQueueSnapshotGate());
  // Attachments of records that left the queue, offered back when a row has to
  // be rebuilt from a text-only snapshot.
  const queuedImageMemoryRef = useRef(createQueuedImageMemory());
  const applyQueuedRecords = useCallback((snapshot: QueuedMessages, entries?: readonly QueuedSnapshotEntry[]) => {
    lastQueueSnapshotRef.current = snapshot;
    const memory = queuedImageMemoryRef.current;
    setQueuedSubmissions((records) => reconcileQueuedSubmissions(
      records,
      snapshot,
      Date.now(),
      queuedImageRecall(entries, memory),
      (record) => memory.remember(record),
    ));
  }, []);
  // SSE queue snapshots are the authoritative feed: they observe a queue
  // change and always apply.
  const applyQueueSnapshot = useCallback((snapshot: QueuedMessages, entries?: readonly QueuedSnapshotEntry[]) => {
    queueSnapshotGateRef.current.observe();
    applyQueuedRecords(snapshot, entries);
  }, [applyQueuedRecords]);
  // get_state responses are point-in-time reads; they apply only while no
  // queue change has been observed since the read was issued — an older
  // reading can neither resurrect a delivered entry nor erase a queued one.
  const applyRecordedQueueSnapshot = useCallback((snapshot: QueuedMessages, token: number, entries?: readonly QueuedSnapshotEntry[]) => {
    const gate = queueSnapshotGateRef.current;
    if (!gate.isFresh(token)) return;
    // 本地还有没被服务器回显的排队条目时，这一轮快照整体跳过：点对点读到的
    // 快照里没有它，应用下去会把刚发出的条目删掉，等回显再加回来（消息一闪一没）。
    // SSE 的 queue_update 不受此限，仍是即时通道。
    if (hasUnconfirmedQueuedRecord(queuedSubmissionsRef.current, snapshot)) return;
    gate.observe();
    applyQueuedRecords(snapshot, entries);
  }, [applyQueuedRecords]);

  // Reconciliation also runs on the clock: pi's snapshots stop arriving once the
  // queue is empty, so a row whose message was already delivered would keep
  // showing as queued until the page is reloaded.
  useEffect(() => {
    const deadline = queuedGraceDeadline(queuedSubmissions, lastQueueSnapshotRef.current);
    if (deadline === null) return;
    const timer = setTimeout(() => {
      setQueuedSubmissions((records) => reconcileQueuedSubmissions(
        records,
        lastQueueSnapshotRef.current,
        Date.now(),
        (text, behavior) => queuedImageMemoryRef.current.recall(text, behavior),
        (record) => queuedImageMemoryRef.current.remember(record),
      ));
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [queuedSubmissions]);

  const eventConnectionRef = useRef<AgentEventConnection | null>(null);
  const eventStreamGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamGraceGenerationRef = useRef(0);
  const eventStreamGraceActiveRef = useRef(false);
  // True while a hidden page has let go of the selected session's idle stream
  // (HTTP/1.1 allows a browser six connections per origin, shared by its tabs).
  const eventStreamReleasedRef = useRef(false);
  // Moves on each time a released stream is opened again, so the release
  // effect arms its grace anew for a page still hidden.
  const [eventStreamReattachCount, setEventStreamReattachCount] = useState(0);
  // The lease request in flight: the renewal tick and the release check share it.
  const leaseRequestRef = useRef<{ sid: string; promise: Promise<SessionLeaseOutcome> } | null>(null);
  const reattachEventStreamRef = useRef<(sid: string, reason: "visible" | "activity") => void>(() => {});
  // What the debug panel reads (readDebugSnapshot below): written beside the
  // timers and requests they describe, read by nothing that decides anything.
  const leaseDebugRef = useRef<Pick<DebugClientLease, "renewStartedAt" | "inFlightSince" | "requests" | "unanswered" | "errors" | "last">>({
    renewStartedAt: null, inFlightSince: null, requests: 0, unanswered: 0, errors: 0, last: null,
  });
  const releaseDebugRef = useRef<{ count: number; lastAt: number | null }>({ count: 0, lastAt: null });
  const reattachDebugRef = useRef<DebugClientSession["reattached"]>({ count: 0, lastAt: null, lastReason: null });
  const hiddenReleaseDueAtRef = useRef<number | null>(null);
  const eventStreamGraceDueAtRef = useRef<number | null>(null);
  const isCompactingRef = useRef(false);
  const extensionUiCountRef = useRef(0);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const endedSessionRef = useRef<string | null>(null);
  const sessionPropIdRef = useRef<string | null>(session?.id ?? null);
  // False while the session carries no tool selection of its own, so its loadout
  // follows settings.json defaultTools and the picker must say so rather than
  // labelling it with whichever preset the resolved tools happen to match.
  const sessionToolsPinnedRef = useRef(false);
  const browsingHistoryRef = useRef(false);
  const agentRunningRef = useRef(false);
  const sdkAgentActiveRef = useRef(false);
  const rpcPromptPendingRef = useRef(false);
  const notifiedPromptRunIdRef = useRef(-1);
  const bashRunningRef = useRef(false);
  /** The session read under way when a `!` result was held for the run's end (`PendingBash`). */
  const deferredBashReadSeqRef = useRef(0);
  const bashRecoveryIdRef = useRef(0);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const executeBashRef = useRef<(command: string, excludeFromContext: boolean) => Promise<void> | undefined>(undefined);
  const handleNavigateRef = useRef<((entryId: string) => Promise<boolean>) | undefined>(undefined);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  // The command list as last loaded, and the get_commands request under way, if
  // any. A bare /mcp reads them to tell whose /mcp it is (handleBuiltinSlashCommand).
  // The generation moves on with every request and every clear, and only a request
  // still current writes its answer: one that set_tools outdated (or a newer request)
  // would otherwise put back the list of a session that is no longer there.
  const slashCommandsRef = useRef<SlashCommandInfo[]>([]);
  const slashCommandsLoadRef = useRef<Promise<SlashCommandInfo[] | null> | null>(null);
  const slashCommandsGenerationRef = useRef(0);
  const newSessionPromotedRef = useRef(false);
  const newSessionModelOverrideRef = useRef<SelectedModel | null>(initialChoices?.model ?? null);
  const thinkingLevelOverrideRef = useRef<ConcreteThinkingLevel | null>(initialChoices?.thinkingLevel ?? null);
  const thinkingLevelPinsRef = useRef<Record<string, string>>({});
  const defaultThinkingLevelRef = useRef<ConcreteThinkingLevel | null>(null);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  // 本次 run 自己的 prompt 的 userMessageKey：独立于 optimistic 键存活到 run 结束。
  // prompt_done / reconcile 会先清 optimistic 键并整载（持久副本入列），之后才冲到
  // 的同一条 message_end（标签页冻结期间缓存的 SSE 事件重放）若只看 optimistic 键
  // 会再 append 一份——同一条提问出现两只气泡。此键匹配时永不 append。
  const promptOwnUserKeyRef = useRef<string | null>(null);
  // The run whose prompt the server is known to have got: one of its events
  // (agent_start, prompt_done, queue_update, its user message) arrived, maybe
  // before its request failed. Later ones clear the unconfirmed record itself.
  const landedPromptRunIdRef = useRef<number | null>(null);
  /** 正在对齐中：send / settle / resume / 心跳四源同时触发只跑一次。 */
  const reconcileInFlightRef = useRef(false);

  const unconfirmedSendRef = useRef<UnconfirmedSend | null>(null);
  // The context the newest session read found, and the order its request
  // started in: only a read started after the run settled can settle it.
  const sessionReadSeqRef = useRef(0);
  const lastReadContextRef = useRef<{ sid: string; seq: number; messages: AgentMessage[]; entryIds: string[] } | null>(null);
  const markPromptLanded = useCallback(() => {
    landedPromptRunIdRef.current = promptRunIdRef.current;
    if (unconfirmedSendRef.current?.runId === promptRunIdRef.current) unconfirmedSendRef.current = null;
  }, []);
  const modelSwitchPendingRef = useRef(false);
  const draftKeyAliasesRef = useRef(new Map<string, string>());
  const sessionHookMountedRef = useRef(true);
  // In-flight session reads, keyed by session id (or force:<id> for fresh reads).
  const loadFlightsRef = useRef(new Map<string, Promise<unknown>>());
  // Latest settled view state, readable from the unmount cleanup without
  // re-subscribing it. Assigned every render like sessionPropIdRef below.
  const dataRef = useRef<SessionData | null>(null);
  const messagesRef = useRef<AgentMessage[]>([]);
  const entryIdsRef = useRef<string[]>([]);
  /** 本会话首次读到的窗口条目数；整窗读沿用该宽度，不随翻页放大。 */
  const windowTailRef = useRef<{ sid: string | null; tail: number }>({ sid: null, tail: 0 });
  /** 正在请求中的更早一页游标，保证同一页只请求一次。 */
  const loadingBeforeRef = useRef<string | null>(null);
  const activeLeafIdRef = useRef<string | null>(null);
  const historyCursorRef = useRef<string | null>(null);
  const hasEarlierMessagesRef = useRef(false);
  const earlierTurnCountRef = useRef(0);
  const newestCursorRef = useRef<string | null>(null);
  const hasNewerMessagesRef = useRef(false);
  // 中段窗口期间送达的实时消息缓冲：message_end 守卫不再丢消息，缓冲到落位时机
  // （就地重置窗口标记的发送路径按到达顺序补齐；整页/续页重载自会带上，缓冲清空）。
  const pendingWindowMessagesRef = useRef<AgentMessage[]>([]);
  /** 正在请求中的后一页游标。 */
  const loadingAfterRef = useRef<string | null>(null);

  sessionPropIdRef.current = session?.id ?? null;
  dataRef.current = data;
  messagesRef.current = messages;
  entryIdsRef.current = entryIds;
  activeLeafIdRef.current = activeLeafId;
  historyCursorRef.current = historyCursor;
  hasEarlierMessagesRef.current = hasEarlierMessages;
  earlierTurnCountRef.current = earlierTurnCount;
  newestCursorRef.current = newestCursor;
  hasNewerMessagesRef.current = hasNewerMessages;
  isCompactingRef.current = isCompacting;
  extensionUiCountRef.current = extensionDialogs.length + extensionCustomUis.length;

  // Whether the page wants the stream of `sid` open: the connection asks it
  // before each (re)connect, the debug reader to show it.
  const wantsEventStream = useCallback((sid: string) => (
    sessionHookMountedRef.current
    && endedSessionRef.current !== sid
    && sessionIdRef.current === sid
    && (
      agentRunningRef.current
      || eventStreamGraceActiveRef.current
      || (sessionPropIdRef.current === sid && !eventStreamReleasedRef.current)
    )
  ), []);

  if (!eventConnectionRef.current) {
    eventConnectionRef.current = new AgentEventConnection({
      createSource: (sid) => trackEventSource(
        "agent",
        new EventSource(`/api/agent/${encodeURIComponent(sid)}/events?holder=${encodeURIComponent(pageId())}`),
        sid,
      ),
      onEvent: (event) => handleAgentEventRef.current?.(event as AgentEvent),
      shouldMaintain: wantsEventStream,
      readinessTimeoutMs: EVENT_STREAM_READY_TIMEOUT_MS,
      reconnectDelayMs: EVENT_STREAM_RECONNECT_DELAY_MS,
      staleAfterMs: eventStreamStaleMs(),
      onUnexpectedError: (error) => {
        console.error("Failed to maintain the agent event stream:", error);
      },
    });
  }

  const setToolPresetState = opts.setToolPreset ?? setToolPreset;
  const existingSessionId = session?.id;

  useLayoutEffect(() => {
    if (!existingSessionId && (!isNew || sessionIdRef.current)) return;
    setToolPresetState(getPreferredToolPreset());
  }, [existingSessionId, isNew, setToolPresetState]);

  const onNewSessionChoicesChange = opts.onNewSessionChoicesChange;
  useEffect(() => {
    if (isNew) onNewSessionChoicesChange?.({ model: newSessionModel, thinkingLevel: newSessionThinkingLevel });
  }, [isNew, newSessionModel, newSessionThinkingLevel, onNewSessionChoicesChange]);

  const currentModel = currentModelOverride ?? liveModel ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew
    ? (newSessionModel ?? newSessionDefaultModel)
    : currentModel ?? (data?.context.messages.length === 0 ? newSessionDefaultModel : null);
  const contextThinkingLevel = asConcreteThinkingLevel(
    data?.context.thinkingLevel && data.context.thinkingLevel !== "off"
      ? data.context.thinkingLevel
      : null,
  );
  const currentThinkingLevel = currentThinkingOverride ?? liveThinkingLevel ?? contextThinkingLevel;
  const displayThinkingLevel = isNew
    ? (newSessionThinkingLevel ?? newSessionDefaultThinkingLevel)
    : currentThinkingLevel ?? (data?.context.messages.length === 0 ? newSessionDefaultThinkingLevel : null);
  const composerDraftKey = session?.id ?? newSessionDraftKey ?? undefined;

  const syncLiveModel = useCallback((state?: AgentStateResponse) => {
    setLiveModel(state?.model
      ? { provider: state.model.provider, modelId: state.model.id }
      : null);
    if (state?.thinkingLevel !== undefined) {
      setLiveThinkingLevel(asConcreteThinkingLevel(state.thinkingLevel));
    }
    // Ride-along parse: every state read flows through here, so the toolbar's MCP
    // badge stays current without a second command (same pattern as contextUsage).
    onMcpServersChangeRef.current?.(state?.mcpServers ?? null);
  }, []);

  const resolveComposerDraftKey = useCallback((key: string | undefined) => {
    if (!key) return undefined;
    let resolved = key;
    const visited = new Set<string>();
    while (!visited.has(resolved)) {
      visited.add(resolved);
      const next = draftKeyAliasesRef.current.get(resolved);
      if (!next) break;
      resolved = next;
    }
    return resolved;
  }, []);

  const restoreSubmission = useCallback((
    text: string,
    images: ChatDraftImage[] | undefined,
    targetDraftKey: string | undefined,
  ) => {
    const destinationDraftKey = resolveComposerDraftKey(targetDraftKey);
    if (
      !sessionHookMountedRef.current
      && !newSessionPromotedRef.current
      && targetDraftKey === newSessionDraftKey
    ) return;
    const input = opts.chatInputRef?.current;
    if (input) {
      input.restoreSubmission(text, images, destinationDraftKey);
    } else if (destinationDraftKey) {
      restoreDraftSubmission(destinationDraftKey, text, images);
    }
  }, [newSessionDraftKey, opts.chatInputRef, resolveComposerDraftKey]);

  // Editing a past message only prefills the composer; the branch moves when it is sent,
  // so cancelling or reloading never hides the rest of the conversation.
  const [editEntryId, setEditEntryId] = useState(() => {
    const sid = session?.id;
    if (sid && !getDraft(sid)) pendingHistoryEdits.delete(sid);
    return (sid && pendingHistoryEdits.get(sid)) || null;
  });
  const setEdit = useCallback((entryId: string | null) => {
    if (!session?.id) return;
    if (entryId) pendingHistoryEdits.set(session.id, entryId);
    else pendingHistoryEdits.delete(session.id);
    setEditEntryId(entryId);
  }, [session?.id]);
  const handleEditContent = useCallback((message: UserMessage, entryId: string) => {
    if (!session?.id) return;
    opts.chatInputRef?.current?.replaceMessage(message);
    setEdit(entryId);
  }, [opts.chatInputRef, session?.id, setEdit]);
  const cancelEdit = useCallback(() => setEdit(null), [setEdit]);

  const displayContextUsage = useMemo(() => {
    const usage = sessionStatsOverride?.contextUsage ?? contextUsage;
    if (!usage || usage.percent === null) return usage;
    return { ...usage, percent: Math.max(0, Math.min(100, usage.percent)) };
  }, [sessionStatsOverride, contextUsage]);

  const sessionStats = useMemo(() => {
    // Active time is a monotone sum over the session's entries, so of the two
    // readings the larger one is the newer one: the live state leads while a run
    // appends entries behind the panel's snapshot, and the snapshot leads after
    // a compaction or a reload (#1334).
    const snapshotActiveMs = data?.totalActiveMs;
    const liveActiveMs = liveTotalActiveMs && liveTotalActiveMs.sessionId === data?.sessionId
      ? liveTotalActiveMs.value
      : undefined;
    const totalActiveMs = snapshotActiveMs === undefined && liveActiveMs === undefined
      ? undefined
      : Math.max(snapshotActiveMs ?? 0, liveActiveMs ?? 0);
    // One reading, one shape — the live SDK snapshot while a wrapper is alive,
    // the session file's own stats (already counted server-side from the same
    // entries) otherwise. Summing messages here as well is what let the top bar
    // and the stats panel disagree.
    if (sessionStatsOverride) {
      return {
        ...sessionStatsOverride,
        // The SDK snapshot carries no per-request reading; the file's own stats
        // track the most recent request's usage for the live cache segment.
        lastUsage: sessionStatsOverride.lastUsage ?? data?.stats?.lastUsage ?? null,
        sessionName: sessionStatsOverride.sessionName ?? session?.name,
        totalActiveMs,
        ...(displayContextUsage ? { contextUsage: displayContextUsage } : {}),
      } satisfies SessionStatsInfo;
    }
    const fileStats = data?.stats;
    if (!fileStats) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      ...fileStats,
      totalActiveMs,
      ...(displayContextUsage ? { contextUsage: displayContextUsage } : {}),
    } satisfies SessionStatsInfo;
  }, [sessionStatsOverride, displayContextUsage, liveTotalActiveMs, data?.sessionId, data?.filePath, data?.totalActiveMs, data?.stats, session?.id, session?.name]);

  useEffect(() => {
    entryIdsRef.current = entryIds;
  }, [entryIds]);

  const applyLiveUsage = useCallback((state: AgentStateResponse | undefined, sid: string, runId: number, requestId: number) => {
    if (!sessionHookMountedRef.current || sessionIdRef.current !== sid
      || promptRunIdRef.current !== runId || requestId <= contextUsageAppliedIdRef.current) return;
    contextUsageAppliedIdRef.current = requestId;
    if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
    if (typeof state?.totalActiveMs === "number") setLiveTotalActiveMs({ sessionId: sid, value: state.totalActiveMs });
  }, []);

  const refreshContextUsage = useCallback(async (sid: string) => {
    const runId = promptRunIdRef.current;
    const requestId = ++contextUsageRequestIdRef.current;
    try {
      const res = await fetch(agentStatusUrl(sid));
      if (!res.ok) return;
      const data = await res.json() as { state?: AgentStateResponse };
      applyLiveUsage(data.state, sid, runId, requestId);
    } catch {
      // A later message or the running-state poll retries the usage read.
    }
  }, [applyLiveUsage]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false, options?: { force?: boolean }) => {
    // Single-flight: concurrent reads for the same session (mount + SSE settle +
    // reconcile) share one request unless the caller forces a fresh read.
    const flightKey = options?.force ? `force:${sid}` : sid;
    const inflight = options?.force ? undefined : loadFlightsRef.current.get(flightKey);
    if (inflight) return await inflight;
  const flight = (async (): Promise<unknown> => {
    /**
     * 状态与消息互不依赖：一进函数就并行发出，等消息落地再按原顺序应用。
     * 原来串行等消息读完才问状态，每次切换会话多付一个往返。
     */
    const statePromise = includeState
      ? fetch(`/api/sessions/${encodeURIComponent(sid)}/state`)
      : null;
    // 提前读的路径可能在未 await 前就 return（会话被切走、读盘 404）：
    // 这里先挂一个空 catch，免成未处理拒绝。
    void statePromise?.catch(() => {});
    let messagesLoaded = false;
    const readSeq = ++sessionReadSeqRef.current;
    // pi writes a `!` result held during a run before the run settles: a read
    // started once the run is over has it, and the card that showed it goes.
    const afterRun = !agentRunningRef.current;
    try {
      // A full load re-renders the leaf path, ending any paged-back history view.
      browsingHistoryRef.current = false;
      if (showLoading) setLoading(true);
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", tree: "summary" });
      // 挂载（本会话尚无已载入条目）按整轮取首屏：3 轮一屏，与翻页同一量纲。
      // 已有基线后的兜底/刷新按条：窗口不得不小于已载入条数，否则每次刷新都把
      // 翻页载入的历史裁掉——读者往上翻，内容已经不在内存里了。
      // 不得比已载入的多：按条数的窗口一旦放大（以前有 50 条兜底），合并就会把
      // 窗口里比本地多出来的旧条目追加进列表，表现是每次刷新凭空长出一段旧历史。
      // 窗口大小按会话固定：首次读取后记下该窗口的条目数，之后的整窗读只要求同等宽度。
      // 以“已载入条数”作窗口大小会因上翻翻页而不断放大，服务端随之前移窗口起点，
      // mergeLoadedTail() 的前缀校验随之失败并退回整窗替换，表现为突然出现一段旧消息。
      const loadedCount = sessionIdRef.current === sid ? entryIdsRef.current.length : 0;
      const pinned = windowTailRef.current;
      if (loadedCount === 0) {
        params.set("turns", String(pageTurns()));
      } else {
        const tailSize = pinned.sid === sid && pinned.tail > 0 ? pinned.tail : loadedCount;
        params.set("tail", String(Math.min(1000, Math.max(1, tailSize))));
      }
      if (options?.force) params.set("force", "1");
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}?${params}`);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setEntryIds([]);
          setHistoryCursor(null);
          setHasEarlierMessages(false);
          setEarlierTurnCount(0);
          setNewestCursor(null);
          setHasNewerMessages(false);
          setHeadTurn(null);
          pendingWindowMessagesRef.current = [];
          setError(null);
        }
        deleteSessionViewSnapshot(sid);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      if (sessionIdRef.current !== sid) return null;
      if ((lastReadContextRef.current?.seq ?? 0) < readSeq) {
        lastReadContextRef.current = { sid, seq: readSeq, messages: d.context.messages, entryIds: d.context.entryIds ?? [] };
      }
      // Freshness check: when the disk snapshot is unchanged (same opaque
      // revision), keep any history the user already paged in instead of
      // collapsing back to the fresh 50-entry window. The state hooks then
      // only need the server's tree/leaf/stats — never a history reset.
      const cached = getSessionViewSnapshot(sid);
      // 尾部核对：本地窗口的末尾不是服务端确认的叶子（且窗口确实读到了叶子）
      // 就说明本地落后——断流期间落盘的条目没有流可以补，此时“保留更宽的已载窗口”
      // 等同把落后的尾部当作最新。宁可整载一次，把窗口移到叶子。
      // 宁可整载一遍把窗口挪到叶子。hasNewer 时 newestEntryId 不是叶子，不核。
      const serverTailId = d.context.newestEntryId ?? null;
      const tailStale = !d.context.hasNewer
        && serverTailId !== null
        && entryIdsRef.current.length > 0
        && !entryIdsRef.current.includes(serverTailId);
      const revisionUnchanged = !tailStale && Boolean(
        d.snapshotRevision
        && cached?.revision === d.snapshotRevision
        && cached.entryIds.length >= (d.context.entryIds ?? []).length,
      );
      // 两者必须取自同一份窗口：revision 未变时保留的是“更宽的已加载窗口”，
      // 若只放宽 messages 而 entryIds 仍取服务端窄窗口，两个数组长度将不等、
      // 索引错位，使 key 与 data-entry-id 串位，表现为消息错乱及部分条目“消失”。
      const persistedMessages = revisionUnchanged ? messagesRef.current : d.context.messages;
      const persistedEntryIds = revisionUnchanged ? entryIdsRef.current : (d.context.entryIds ?? []);
      // 记下该会话的基准窗口宽度（首次读取或换会话时）：后续整窗读按它请求，
      // 不再取当前已载入条数，以免翻页把窗口越推越早。
      if (windowTailRef.current.sid !== sid) {
        windowTailRef.current = { sid, tail: Math.max(1, persistedEntryIds.length) };
      }
      setData(revisionUnchanged
        ? {
            ...d,
            context: {
              ...d.context,
              messages: messagesRef.current,
              entryIds: entryIdsRef.current,
              oldestEntryId: historyCursorRef.current,
              hasMore: hasEarlierMessagesRef.current,
              turnsBefore: earlierTurnCountRef.current,
            },
          }
        : d);
      setActiveLeafId(d.leafId);
      if (revisionUnchanged) {
        // Refresh the cached snapshot with the newest leaf/tree/stats while
        // preserving the wider loaded window.
        setSessionViewSnapshot({
          sessionId: sid,
          revision: d.snapshotRevision!,
          messages: messagesRef.current,
          entryIds: entryIdsRef.current,
          leafId: d.leafId,
          oldestEntryId: historyCursorRef.current,
          hasMore: hasEarlierMessagesRef.current,
          turnsBefore: earlierTurnCountRef.current,
          summaryTree: d.tree,
          thinkingLevel: d.context.thinkingLevel,
          model: d.context.model,
          stats: d.stats,
          totalActiveMs: d.totalActiveMs,
          loadedEntryIds: entryIdsRef.current,
        });
      } else {
        const previous = { messages: messagesRef.current, entryIds: entryIdsRef.current };
        // 同会话且已加载前缀与窗口一致时走尾部合并：保留已加载行（含翻页历史
        // 与流式行），只接新尾部，key 经别名迁移保持不变，React 不重挂载——
        // 回合结束的整载不再引发全列表重绘。前缀不一致（分叉/截断/跨叶）才
        // 回退整载替换。
        const merged = sessionIdRef.current === sid && !browsingHistoryRef.current
          ? mergeLoadedTail(previous.entryIds, previous.messages, persistedEntryIds, persistedMessages)
          : null;
        const next = merged
          ? { messages: merged.messages, entryIds: merged.entryIds }
          : { messages: persistedMessages, entryIds: persistedEntryIds };
        setMessageKeyAliases((aliases) => carryMessageKeys({ ...previous, aliases }, next));
        setMessages(next.messages);
        setEntryIds(next.entryIds);
        if (merged) {
          // 合并成功：已载入的历史行（含窗口外翻页历史）还在列表里，翻页游标与
          // 「还有更早」标记保留——重置到窗口头会让下次向上翻页重复载入已在
          // 列表的行（旧消息重现）。只有整载替换才把游标重置到窗口头。
        } else {
          setHistoryCursor(d.context.oldestEntryId);
          setHasEarlierMessages(d.context.hasMore);
          setEarlierTurnCount(d.context.turnsBefore ?? 0);
        }
        // 整载落在叶子：不存在更新的一页。上一会话残留的中段窗口标记与实时
        // 缓冲必须一并清掉，否则新会话的实时消息会被误缓冲（跨会话污染），
        // 下次发送时把上个会话的消息顶进当前列表。
        setNewestCursor(null);
        setHasNewerMessages(false);
        setHeadTurn(d.context.headTurn ?? null);
        pendingWindowMessagesRef.current = [];
      }
      // Tool-preset state is independent of the view cache: it must be applied
      // on every read, cached window or not (#700).
      sessionToolsPinnedRef.current = d.toolNames !== undefined;
      setToolPresetState(d.toolNames !== undefined ? getPresetFromToolNames(d.toolNames) : CONFIGURED_TOOL_PRESET);
      setCurrentModelOverride((current) => modelSwitchPendingRef.current ? current : null);
      setCurrentThinkingOverride(null);
      setError(null);
      if (d.treeFormat === "summary" && d.snapshotRevision) {
        setSessionViewSnapshot({
          sessionId: sid,
          revision: d.snapshotRevision,
          messages: persistedMessages,
          entryIds: d.context.entryIds ?? [],
          leafId: d.leafId,
          oldestEntryId: d.context.oldestEntryId,
          hasMore: d.context.hasMore,
          turnsBefore: d.context.turnsBefore ?? 0,
          summaryTree: d.tree,
          thinkingLevel: d.context.thinkingLevel,
          model: d.context.model,
          stats: d.stats,
          totalActiveMs: d.totalActiveMs,
          loadedEntryIds: d.context.entryIds ?? [],
        });
      }
      if (d.wrapperRebuilt) {
        eventConnectionRef.current?.close("rebuilt");
        eventConnectionRef.current?.maintain(sid);
      }
      if (!includeState && d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setLiveThinkingLevel(asConcreteThinkingLevel(d.context.thinkingLevel));
      }

      messagesLoaded = true;
      if (afterRun && readSeq > deferredBashReadSeqRef.current) setPendingBash((pending) => (pending?.result ? null : pending));
      if (showLoading) setLoading(false);
      if (!includeState) return null;

      try {
        const queueToken = queueSnapshotGateRef.current.capture();
        const extensionUiToken = extensionUiGateRef.current.capture();
        const runId = promptRunIdRef.current;
        const usageRequestId = ++contextUsageRequestIdRef.current;
        const stateRes = await statePromise!;
        if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
        const agentState = await stateRes.json() as { running: boolean; state?: AgentStateResponse };
        if (sessionIdRef.current !== sid) return null;

        const liveState = agentState.state;
        syncLiveModel(liveState);        if (liveState) {
          applyLiveUsage(liveState, sid, runId, usageRequestId);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          // 读盘期间的 setStatus / setWidget 事件更新，不能被这份旧快照抹掉。
          if (extensionUiGateRef.current.isFresh(extensionUiToken)) {
            if (liveState.extensionStatuses !== undefined) setExtensionStatuses(liveState.extensionStatuses ?? []);
            if (liveState.extensionWidgets !== undefined) setExtensionWidgets(liveState.extensionWidgets ?? []);
          }
          if (liveState.queuedMessages !== undefined) {
            applyRecordedQueueSnapshot(normalizeQueuedMessages(liveState.queuedMessages), queueToken, liveState.queuedEntries);
          }
          if (liveState.autoCompactionEnabled !== undefined) setAutoCompactionEnabled(liveState.autoCompactionEnabled ?? true);
        } else if (!agentState.running) {
          applyRecordedQueueSnapshot(emptyQueuedMessages(), queueToken);
        }
        return agentState;
      } catch (e) {
        console.error("Failed to load agent state:", e);
        return null;
      }
    } catch (e) {
      setError(String(e));
      return "error";
    } finally {
      if (showLoading && !messagesLoaded) setLoading(false);
    }
    })();
    if (!options?.force) loadFlightsRef.current.set(flightKey, flight);
    flight.finally(() => {
      if (loadFlightsRef.current.get(flightKey) === flight) loadFlightsRef.current.delete(flightKey);
    });
    return await flight;
  }, [applyLiveUsage, applyRecordedQueueSnapshot, setToolPresetState, syncLiveModel]);

  const loadContext = useCallback(async (sid: string, leafId: string | null, before?: string | null, options?: { signal?: AbortSignal }) => {
    try {
      // 同一页正在请求中：滚动到顶部与预取可能并发触发，重复返回会导致该页被 prepend 两次。
      if (before) {
        if (loadingBeforeRef.current === before) return;
        loadingBeforeRef.current = before;
      }
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      if (leafId) params.set("leafId", leafId);
      // Page upward: ask the server for the turn preceding `before`, then
      // prepend it. Omitting `before` fetches the first screen's turns.
      if (before) params.set("before", before);
      params.set("turns", String(before ? olderPageTurns() : pageTurns()));
      const url = `/api/sessions/${encodeURIComponent(sid)}/context?${params}`;
      const res = await fetch(url, { signal: options?.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: SessionData["context"] };
      // A leaf-scoped load must still target the selected leaf: rapid A→B
      // switches would otherwise let A's late response overwrite B's tree.
      if (sessionIdRef.current !== sid || options?.signal?.aborted || !sessionHookMountedRef.current) return;
      if (leafId && activeLeafIdRef.current !== leafId) return;
      // 该页再次返回（游标未前进）：再次 prepend 会使同一批消息重复出现，
      // 已加载条数游标随之错位。
      if (before && d.context.oldestEntryId === before && d.context.messages.length > 0) return d.context;
      setHistoryCursor(d.context.oldestEntryId);
      setHasEarlierMessages(d.context.hasMore);
      setEarlierTurnCount(d.context.turnsBefore ?? 0);
      setHeadTurn(d.context.headTurn ?? null);
      setData((prev) => {
        if (!prev || prev.sessionId !== sid) return prev;
        if (!before) return { ...prev, context: d.context };
        const page = dedupePage(d.context.entryIds, d.context.messages, prev.context.entryIds);
        return {
          ...prev,
          context: {
            ...prev.context,
            messages: [...page.messages, ...prev.context.messages],
            entryIds: [...page.entryIds, ...prev.context.entryIds],
            oldestEntryId: d.context.oldestEntryId,
            hasMore: d.context.hasMore,
            turnsBefore: d.context.turnsBefore,
          },
        };
      });
      if (before) {
        // Older page: prepend so scroll position stays anchored.
        browsingHistoryRef.current = true;
        // 过滤已加载条目：重复下发或与上一页重叠的条目会使同一消息出现两次，
        // 并影响阅读位置与已加载条数。
        const page = dedupePage(d.context.entryIds, d.context.messages, entryIdsRef.current);
        setMessages((prev) => [...page.messages, ...prev]);
        setEntryIds((prev) => [...page.entryIds, ...prev]);
      } else {
        setMessages(d.context.messages);
        setEntryIds(d.context.entryIds ?? []);
        // A tail page reaches the leaf, so nothing newer can be paged in.
        setNewestCursor(d.context.newestEntryId ?? null);
        setHasNewerMessages(Boolean(d.context.hasNewer));
        if (!d.context.hasNewer) pendingWindowMessagesRef.current = [];
      }
      return d.context;
    } catch (e) {
      if (!options?.signal?.aborted) console.error("Failed to load context:", e);
    } finally {
      if (before) loadingBeforeRef.current = null;
    }
  }, []);

  /**
   * 请求一页历史窗口：`anchor` 以指定轮次为中心（小地图跳转），`newerThan` 从已加载末尾向下续接。
   * 两者均不直接修改视图，由调用方决定替换或续接。
   */
  const fetchWindow = useCallback(async (
    sid: string,
    leafId: string | null,
    window: { anchor?: string; newerThan?: string; turns: number; after?: number },
  ) => {
    const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", turns: String(window.turns) });
    if (leafId) params.set("leafId", leafId);
    if (window.anchor) params.set("anchor", window.anchor);
    if (window.newerThan) params.set("newerThan", window.newerThan);
    if (window.after) params.set("after", String(window.after));
    const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/context?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as { context: SessionData["context"] };
    if (sessionIdRef.current !== sid || !sessionHookMountedRef.current) return null;
    if (leafId && activeLeafIdRef.current !== leafId) return null;
    return d.context;
  }, []);

  /** 小地图跳转：单次请求获取目标轮附近的窗口，不逐页向上拉取。 */
  const jumpToEntry = useCallback(async (sid: string, leafId: string | null, anchorId: string) => {
    try {
      const context = await fetchWindow(sid, leafId, { anchor: anchorId, turns: pageTurns() });
      if (!context) return null;
      browsingHistoryRef.current = true;
      setMessages(context.messages);
      setEntryIds(context.entryIds ?? []);
      setHistoryCursor(context.oldestEntryId);
      setHasEarlierMessages(context.hasMore);
      setEarlierTurnCount(context.turnsBefore ?? 0);
      setHeadTurn(context.headTurn ?? null);
      setNewestCursor(context.newestEntryId ?? null);
      setHasNewerMessages(Boolean(context.hasNewer));
      if (!context.hasNewer) pendingWindowMessagesRef.current = [];
      setData((prev) => (prev && prev.sessionId === sid ? { ...prev, context } : prev));
      return context;
    } catch (e) {
      console.error("Failed to load history window:", e);
      return null;
    }
  }, [fetchWindow]);

  /** 向下续接一页：窗口未到达叶子时，滚动到底部才拉取。 */
  const loadNewerPage = useCallback(async (sid: string, leafId: string | null, newerThan: string) => {
    if (loadingAfterRef.current === newerThan) return null;
    loadingAfterRef.current = newerThan;
    try {
      const context = await fetchWindow(sid, leafId, { newerThan, turns: olderPageTurns() });
      if (!context) return null;
      const page = dedupePage(context.entryIds, context.messages, entryIdsRef.current);
      setMessages((prev) => [...prev, ...page.messages]);
      setEntryIds((prev) => [...prev, ...page.entryIds]);
      setNewestCursor(context.newestEntryId ?? null);
      setHasNewerMessages(Boolean(context.hasNewer));
      if (!context.hasNewer) pendingWindowMessagesRef.current = [];
      return context;
    } catch (e) {
      console.error("Failed to load newer history:", e);
      return null;
    } finally {
      loadingAfterRef.current = null;
    }
  }, [fetchWindow]);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (!tools || !sessionHookMountedRef.current || sessionIdRef.current !== sid) return null;
      const { getPresetFromTools } = await import("@/lib/tool-presets");
      setToolPresetState(sessionToolsPinnedRef.current ? getPresetFromTools(tools) : CONFIGURED_TOOL_PRESET);
      if (!background) onSystemToolsChange?.(tools);
      return tools;
    } catch (e) {
      console.error("Failed to load tools:", e);
      return null;
    }
  }, [background, onSystemToolsChange, setToolPresetState]);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    const provisionalDraftKey = newSessionDraftKey;
    if (!provisionalDraftKey) return;
    if (provisionalDraftKey !== sid) {
      draftKeyAliasesRef.current.set(provisionalDraftKey, sid);
      const input = opts.chatInputRef?.current;
      if (input) input.rekeyDraft(provisionalDraftKey, sid);
      else rekeyDraft(provisionalDraftKey, sid);
    }
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      name: undefined,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
      transient: true,
    }, provisionalDraftKey);
  }, [isNew, newSessionCwd, newSessionDraftKey, onSessionCreated, opts.chatInputRef]);

  // The model and reasoning level a fresh composer's session started with, unless the user
  // picked others since `selectedModel` / `selectedThinkingLevel` were read.
  const applyNewSessionStartState = useCallback((
    state: { model?: SelectedModel | null; thinkingLevel?: string },
    selectedModel: SelectedModel | null,
    selectedThinkingLevel: ConcreteThinkingLevel | null,
  ) => {
    if (state.model && newSessionModelOverrideRef.current === selectedModel) {
      setPendingModel(state.model);
      if (!selectedModel) setNewSessionDefaultModel(state.model);
    }
    if (state.thinkingLevel && thinkingLevelOverrideRef.current === selectedThinkingLevel) {
      setLiveThinkingLevel(asConcreteThinkingLevel(state.thinkingLevel));
      if (!selectedThinkingLevel) {
        setNewSessionDefaultThinkingLevel(asConcreteThinkingLevel(state.thinkingLevel));
      }
    }
  }, []);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      // Only send explicit user overrides. The server resolves the current
      // enabledModels scope atomically with AgentSession construction.
      const selectedModel = newSessionModelOverrideRef.current;
      const selectedThinkingLevel = thinkingLevelOverrideRef.current;
      if (selectedModel) setPendingModel(selectedModel);
      // Undefined means the user never overrode the loadout: omit the field entirely
      // so pi resolves settings.json defaultTools instead of being pinned to ours (#700).
      const toolNames = getToolNamesForPreset(toolPreset);
      sessionToolsPinnedRef.current = toolNames !== undefined;
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          ...(toolNames !== undefined ? { toolNames } : {}),
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(selectedThinkingLevel
            ? { thinkingLevel: selectedThinkingLevel }
            : {}),
        }),
      });
      if (!res.ok) {
        // The server's reason (a project folder that no longer exists, a model Chat only
        // cannot load) beats a bare status.
        const body = await res.json().catch(() => null) as { error?: unknown } | null;
        const message = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
        const cwdGone = missingCwdFromBody(body);
        throw cwdGone ? new AgentCommandError(message, res.status, undefined, undefined, cwdGone) : new Error(message);
      }
      const result = await res.json() as {
        sessionId: string;
        model?: SelectedModel | null;
        thinkingLevel?: ThinkingLevelOption;
      };
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      applyNewSessionStartState(result, selectedModel, selectedThinkingLevel);
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [applyNewSessionStartState, isNew, newSessionCwd, toolPreset]);

  // Opening the System or Tools panel may initialize an otherwise dormant
  // session. This is deliberately a non-prompt command: it creates no message
  // or model run, but lets users inspect the exact prompt before sending one.
  const loadSystemInfo = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) return;

    const [state] = await Promise.all([
      sendAgentCommand<AgentStateResponse>(sid, { type: "get_state" }),
      loadTools(sid),
    ]);
    if (!sessionHookMountedRef.current || sessionIdRef.current !== sid) return;
    syncLiveModel(state);
    setSystemPrompt(state.systemPrompt ?? "");
  }, [ensureNewSession, loadTools, syncLiveModel]);

  const replaceSlashCommands = useCallback((commands: SlashCommandInfo[]) => {
    slashCommandsRef.current = commands;
    setSlashCommands(commands);
  }, []);

  // The session's tools changed (set_tools may have rebuilt it as Chat only): forget the
  // list and the request under way, so the next reader asks the session as it is now.
  const clearSlashCommands = useCallback(() => {
    slashCommandsGenerationRef.current += 1;
    slashCommandsLoadRef.current = null;
    replaceSlashCommands([]);
  }, [replaceSlashCommands]);

  // An extension's session_start may wait on a dialog, which only the event stream shows (#1678),
  // and get_commands waits for session_start. A fresh composer has no stream (a prompt and a `!`
  // command open one themselves), so it holds one while the request is out, and lets go of it
  // after, as before, unless something in the page still needs it. A selected session keeps its own.
  const withSessionStartStream = useCallback(async <T,>(sid: string, request: () => Promise<T>): Promise<T> => {
    const fresh = sessionPropIdRef.current === null && sessionHookMountedRef.current;
    if (fresh) void eventConnectionRef.current?.ensureConnected(sid).catch(() => {});
    try {
      return await request();
    } finally {
      if (
        fresh
        && sessionPropIdRef.current === null
        && sessionIdRef.current === sid
        && extensionUiCountRef.current === 0
        && !agentRunningRef.current
        && !bashRunningRef.current
      ) {
        eventConnectionRef.current?.close("grace_end");
      }
    }
  }, []);

  // Null when get_commands failed, which an empty list (a Chat-only session's) must not be mistaken for.
  const requestSlashCommands = useCallback((): Promise<SlashCommandInfo[] | null> => {
    const generation = ++slashCommandsGenerationRef.current;
    const current = () => slashCommandsGenerationRef.current === generation;
    const load = (async () => {
      const sid = sessionIdRef.current ?? await ensureNewSession();
      if (!sid) {
        if (current()) replaceSlashCommands([]);
        return [] as SlashCommandInfo[];
      }
      setSlashCommandsLoading(true);
      try {
        const data = await withSessionStartStream(sid, () => sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" }));
        const commands = data?.commands ?? [];
        if (current()) replaceSlashCommands(commands);
        return commands;
      } catch (e) {
        console.error("Failed to load slash commands:", e);
        if (current()) replaceSlashCommands([]);
        return null;
      } finally {
        // A newer request under way keeps the palette's "Loading" until it answers.
        if (current() || !slashCommandsLoadRef.current) setSlashCommandsLoading(false);
      }
    })();
    slashCommandsLoadRef.current = load;
    const settle = () => {
      if (slashCommandsLoadRef.current === load) slashCommandsLoadRef.current = null;
    };
    load.then(settle, settle);
    return load;
  }, [ensureNewSession, replaceSlashCommands, withSessionStartStream]);

  const loadSlashCommands = useCallback(async () => (await requestSlashCommands()) ?? [], [requestSlashCommands]);

  // The list a bare /mcp is decided by: the request under way (the palette starts
  // one as "/mcp" is typed, often still unanswered at Enter), else the list already
  // loaded, else a new request. Null when it cannot be read: guessing would either
  // swallow another extension's /mcp or send one Settings should have taken.
  const slashCommandsForMcp = useCallback(async (): Promise<SlashCommandInfo[] | null> => {
    const pending = slashCommandsLoadRef.current;
    const known = slashCommandsRef.current;
    if (!pending && known.length > 0) return known;
    const loaded = await (pending ?? requestSlashCommands()).catch(() => null);
    return loaded ?? (known.length > 0 ? known : null);
  }, [requestSlashCommands]);

  const cancelEventStreamGrace = useCallback(() => {
    eventStreamGraceGenerationRef.current += 1;
    eventStreamGraceActiveRef.current = false;
    eventStreamGraceDueAtRef.current = null;
    if (eventStreamGraceTimerRef.current) {
      clearTimeout(eventStreamGraceTimerRef.current);
      eventStreamGraceTimerRef.current = null;
    }
  }, []);

  // `reason` only labels the close for the debug panel.
  const closeEvents = useCallback((reason?: DebugStreamCloseReason) => {
    eventConnectionRef.current?.close(reason);
  }, []);

  const ensureEventsConnected = useCallback((sid: string) => (
    eventConnectionRef.current!.ensureConnected(sid)
  ), []);

  const maintainEventsConnected = useCallback((sid: string) => {
    eventConnectionRef.current!.maintain(sid);
  }, []);

  // Keep the selected session's stream open even while its agent is idle. The
  // session itself stays alive on the page's lease renewals (below), which stop
  // if the browser disappears.
  useEffect(() => {
    const sid = session?.id;
    if (!sid) return;
    // React Strict Mode re-runs every effect after a simulated unmount, in
    // declaration order. The mount-only effect below flips this ref to false
    // in its cleanup and only restores it when it re-runs *after* this one,
    // so without re-asserting it here shouldMaintain() refuses the connection
    // and the selected session never opens its event stream.
    sessionHookMountedRef.current = true;
    eventStreamReleasedRef.current = false;
    maintainEventsConnected(sid);
    return () => {
      if (sessionIdRef.current === sid) eventConnectionRef.current?.close("deselected");
    };
  }, [maintainEventsConnected, session?.id]);

  // One lease request: it resets the session's idle countdown (renewIdleTimer())
  // and reports what is under way there (SessionLeaseReply). A reply that does
  // not come within SESSION_LEASE_TIMEOUT_MS, or no network, is "unanswered";
  // an error reply is null.
  const requestLease = useCallback((sid: string): Promise<SessionLeaseOutcome> => {
    const pending = leaseRequestRef.current;
    if (pending?.sid === sid) return pending.promise;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_LEASE_TIMEOUT_MS);
    const request: { sid: string; promise: Promise<SessionLeaseOutcome> } = { sid, promise: Promise.resolve(null) };
    request.promise = (async (): Promise<SessionLeaseOutcome> => {
      let httpStatus: number | null = null;
      let result: SessionLeaseOutcome = null;
      const startedAt = Date.now();
      leaseDebugRef.current.inFlightSince = startedAt;
      leaseDebugRef.current.requests += 1;
      try {
        const response = await fetch(sessionLeaseUrl(sid), { method: "POST", cache: "no-store", signal: controller.signal });
        httpStatus = response.status;
        result = response.ok ? await response.json() as SessionLeaseReply : null;
        return result;
      } catch (error) {
        // Timed out (queued behind open streams) or no network. A body that is no
        // JSON counts as an error reply.
        result = controller.signal.aborted || error instanceof TypeError ? "unanswered" : null;
        return result;
      } finally {
        clearTimeout(timeout);
        if (leaseRequestRef.current === request) leaseRequestRef.current = null;
        // The debug panel's record of it; whatever the reply holds, it cannot throw from here.
        try {
          const lease = leaseDebugRef.current;
          const at = Date.now();
          const outcome = result === "unanswered" ? "unanswered" : result === null ? "error" : "reply";
          if (outcome === "unanswered") lease.unanswered += 1;
          if (outcome === "error") lease.errors += 1;
          const reply = typeof result === "object" && result !== null ? result : null;
          lease.inFlightSince = null;
          lease.last = {
            at,
            durationMs: Math.max(0, at - startedAt),
            outcome,
            httpStatus,
            reply: reply && {
              running: reply.running === true,
              awaitingInput: reply.awaitingInput === true,
              subagentsActive: reply.subagentsActive === true,
            },
          };
        } catch {
          // The debug record must not break the lease request itself.
        }
      }
    })();
    leaseRequestRef.current = request;
    return request.promise;
  }, []);

  // A page hidden for HIDDEN_PAGE_GRACE_MS lets go of the selected session's
  // stream while nothing needs it (#1283): each one holds a browser connection,
  // and over HTTP/1.1 a few background tabs exhaust the six per origin, so every
  // other request (Settings, message sync) queues in the browser until a tab
  // closes. A run, a `!` command, a compaction or an open extension dialog in the
  // page keeps it without asking. Otherwise the grace ends with a lease request,
  // and the stream closes only if its reply shows nothing under way
  // (canReleaseHiddenEventStream(): a run another tab started, an extension
  // dialog, a subagent whose end starts a turn here); the check repeats each
  // grace while hidden. A run that settles while hidden starts the grace again,
  // which also covers extension follow-ups right after prompt_done.
  const eventStreamIdle = !agentRunning && !bashRunning && !isCompacting
    && extensionDialogs.length === 0 && extensionCustomUis.length === 0;
  useEffect(() => {
    const sid = session?.id;
    if (!sid || !eventStreamIdle) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const releasable = () => (
      !disposed
      && document.visibilityState === "hidden"
      && !eventStreamReleasedRef.current
      && sessionIdRef.current === sid
      && sessionPropIdRef.current === sid
      && !agentRunningRef.current
      && !bashRunningRef.current
    );
    const check = async () => {
      timer = null;
      hiddenReleaseDueAtRef.current = null;
      if (!releasable()) return;
      const reply = await requestLease(sid);
      if (!releasable()) return;
      if (!canReleaseHiddenEventStream(reply)) {
        arm();
        return;
      }
      eventStreamReleasedRef.current = true;
      releaseDebugRef.current = { count: releaseDebugRef.current.count + 1, lastAt: Date.now() };
      closeEvents("released");
    };
    const arm = () => {
      if (timer !== null) return;
      timer = setTimeout(() => void check(), HIDDEN_PAGE_GRACE_MS);
      hiddenReleaseDueAtRef.current = Date.now() + HIDDEN_PAGE_GRACE_MS;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        arm();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
        hiddenReleaseDueAtRef.current = null;
      }
    };
    if (document.visibilityState === "hidden") arm();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      hiddenReleaseDueAtRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [closeEvents, eventStreamIdle, eventStreamReattachCount, requestLease, session?.id]);

  // 回页不在这里补读：事件流被释放后，`reattachEventStreamRef` 的 "visible" 分支
  // 已经重连并做一次非 force 的 loadSession——它是尾部合并（mergeLoadedTail），
  // 真有新行才接上，没有就一字不动：无骨架，也不替换整窗。此处原先还多一次
  // force 读，等于每次回到页面都重读一遍窗口，哪怕期间没有新条目。

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    // sonner 的 description 是纯文本：先剥掉终端转义序列，不然 ANSI 会显示成乱码。
    const message = stripAnsi(notice.message).trim();
    if (!message) return;
    const type = notice.type ?? "info";
    toast[type](message, {
      id: notice.id ?? `notice:${Date.now()}-${Math.random().toString(36).slice(2)}`,
      duration: type === "error" ? Infinity : NOTICE_VISIBLE_MS,
    });
  }, []);
  const translateRef = useRef(opts.t);
  translateRef.current = opts.t;
  const translate = useCallback((key: string, params?: TranslationParams) => translateRef.current(key, params), []);
  // 每个待答请求属于哪个会话：回答前核对，避免同一页面里两个会话的弹框互相投递
  // （A 的答案落进 B 的 pendingUiResponses）。事件流按会话订阅，正常路径恒等；
  // 这条只是把“万一错位”从静默丢包变成可见的错误。服务端未命中 pending 也会
  // 回执 `applied:false`，客户端同样报错，而不是看起来“提交了但没反应”。
  const extensionRequestOwnerRef = useRef(new Map<string, string>());
  const extensionAnswerUndelivered = useCallback(() => {
    addNotice({ message: translate("chat.extensionAnswerUndelivered"), type: "error" });
  }, [addNotice, translate]);

  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => {
    const sid = sessionIdRef.current;
    const owner = extensionRequestOwnerRef.current.get(request.id);
    extensionRequestOwnerRef.current.delete(request.id);
    setExtensionDialogs((queue) => removeExtensionUiRequest(queue, request.id));
    if (!sid) return;
    if (owner && owner !== sid) {
      console.error("[pi-web] extension UI response belongs to another session:", { id: request.id, owner, sid });
      extensionAnswerUndelivered();
      return;
    }
    try {
      const result = await sendAgentCommand<{ applied?: boolean }>(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
      if (result?.applied === false) {
        console.error("[pi-web] extension UI response matched no pending request:", { id: request.id, sid });
        extensionAnswerUndelivered();
      }
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
      return;
    }
    // A fresh composer heard its model from /api/agent/new, which may have answered while a
    // session_start handler waited on this dialog (#1678); the handler may pick the model next.
    // get_state answers once session_start has finished (or waits on another dialog).
    if (sessionPropIdRef.current !== null) return;
    const selectedModel = newSessionModelOverrideRef.current;
    const selectedThinkingLevel = thinkingLevelOverrideRef.current;
    try {
      const state = await sendAgentCommand<AgentStateResponse>(sid, { type: "get_state" });
      if (!sessionHookMountedRef.current || sessionIdRef.current !== sid || sessionPropIdRef.current !== null) return;
      applyNewSessionStartState({
        model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
        thinkingLevel: state.thinkingLevel,
      }, selectedModel, selectedThinkingLevel);
      // Extensions may have changed the prompt the System panel shows as session_start went on.
      if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt);
    } catch {
      // The composer keeps the model it shows; the first run's state corrects it.
    }
  }, [applyNewSessionStartState, extensionAnswerUndelivered]);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const owner = extensionRequestOwnerRef.current.get(request.id);
    if (owner && owner !== sid) {
      console.error("[pi-web] extension custom UI input belongs to another session:", { id: request.id, owner, sid });
      extensionAnswerUndelivered();
      return;
    }
    try {
      const result = await sendAgentCommand<{ applied?: boolean }>(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
      if (result?.applied === false) {
        console.error("[pi-web] extension custom UI input matched no active panel:", { id: request.id, sid });
        extensionAnswerUndelivered();
      }
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, [extensionAnswerUndelivered]);
  // A steer or follow-up whose request failed without the server's refusal (the
  // network dropped, a proxy answered) may still have been accepted. Its text
  // goes back to the composer all the same (restoreSubmission merges it in front
  // of anything typed since) and is never sent again on its own; this notice
  // says the send is unconfirmed rather than failed.
  const addUnconfirmedSendNotice = useCallback(() => {
    addNotice({ type: "warning", message: translate("chat.sendUnconfirmed") });
  }, [addNotice, translate]);

  // A normal send keeps its bubble while unconfirmed (#1432). Once the server is
  // idle, a session read started after that settles it: the prompt arrived only
  // if the read shows it, one more user message with its text past the view's
  // last saved entry at the send than the view already had there. Otherwise
  // the text goes back, as not received when the read ends on that entry, else
  // as unconfirmed: a read that moved on (messages the view had not saved, or
  // more than its window), failed, or a command, whose prompt need not become
  // that user message. Any of the run's events clears the record first
  // (markPromptLanded()).
  // The text is back in the composer and the prompt is not in the transcript:
  // its bubble goes, from the view and from the session's cached view. A read of
  // a file the prompt never changed keeps the view's messages (the snapshot
  // revision is the same), so it would never drop the bubble itself.
  const dropUnconfirmedBubble = useCallback((pending: UnconfirmedSend) => {
    if (sessionHookMountedRef.current) setMessages((prev) => withoutMessage(prev, pending.bubble));
    const snapshot = getSessionViewSnapshot(pending.sid);
    if (snapshot?.messages.includes(pending.bubble)) {
      setSessionViewSnapshot({ ...snapshot, messages: withoutMessage(snapshot.messages, pending.bubble) });
    }
  }, []);
  const settleUnconfirmedSend = useCallback((sid: string, runId: number, readSeqBefore: number, probe?: "landed" | "absent") => {
    const pending = unconfirmedSendRef.current;
    if (!pending || pending.runId !== runId || pending.sid !== sid) return;
    // 轻量探测已经给了答案：文件末尾越过发送点 = 落到盘上了；没越过 = 确实没送到。
    // 这条路径不依赖整窗重读，大号消息（多图 base64）在慢隧道上也不会再被误判。
    if (probe === "landed") {
      unconfirmedSendRef.current = null;
      return;
    }
    if (probe === "absent") {
      unconfirmedSendRef.current = null;
      restoreSubmission(pending.message, pending.images, pending.draftKey);
      dropUnconfirmedBubble(pending);
      addNotice(pending.command
        ? { type: "warning", message: translate("chat.sendUnconfirmed") }
        : { type: "error", message: translate("chat.sendNotReceived") });
      return;
    }
    unconfirmedSendRef.current = null;
    const read = lastReadContextRef.current;
    const reread = read?.sid === sid && read.seq > readSeqBefore ? read : null;
    // 发送点是否落在这份读的窗口里。锚点找不到（indexOf === -1）说明它被挤出了
    // 窗口，此时读不到消息**不等于**消息未落盘：不得据此删除气泡（隧道中断或
    // 服务重启造成的半失败会走到这里）。
    const anchorIndex = !reread ? -1
      : pending.lastEntryIdAtSend === null ? 0
        : reread.entryIds.indexOf(pending.lastEntryIdAtSend) + 1;
    const located = reread !== null && anchorIndex >= 0;
    if (reread && located) {
      const sameText = countUserMessages(reread.messages.slice(anchorIndex), pending.key);
      // 送达：气泡就是这条消息，留着。
      if (sameText > pending.sameTextAfterSend) return;
    }
    restoreSubmission(pending.message, pending.images, pending.draftKey);
    if (!located) {
      // 说不清楚：保留气泡，只提示未确认。删气泡会让真的送到的消息从视图消失。
      addNotice({ type: "warning", message: translate("chat.sendUnconfirmed") });
      return;
    }
    // 确定没送到：气泡删掉，文字回输入框。
    dropUnconfirmedBubble(pending);
    addNotice(reread && !pending.command && anchorIndex === reread.entryIds.length
      ? { type: "error", message: translate("chat.sendNotReceived") }
      : { type: "warning", message: translate("chat.sendUnconfirmed") });
  }, [addNotice, dropUnconfirmedBubble, restoreSubmission, translate]);

  /**
   * 将 `since` 之后的条目并入消息列表，不重读整窗。
   *
   * 两种模式：
   * - `"user-only"`：运行期间使用。仅并入用户条目，并按 `userMessageKey` 去重；
   *   助手正文由 SSE 增量提供，整条并入会产生重复行。
   * - 省略：回合结束时使用。以锚点（最后一个带 entryId 的行）为界，把该行之后的
   *   本地行整段替换为落盘版本，顺序与 entryId 一并接管。落盘条目是权威来源；
   *   逐条配对不可行，流式阶段的工具参数是半成品，与落盘版本并不相等。
   *
   * 返回 false 表示无法取得可靠的增量（锚点已被挤出窗口，或接口不可用），
   * 调用方应退回整窗读取。
   */
  const appendSessionSince = useCallback(async (sid: string, since: string, mode?: "user-only"): Promise<boolean> => {
    const result = await fetchSessionSince(sid, since);
    if (sessionIdRef.current !== sid) return true;
    if (result.kind !== "ok") return false;
    if (result.leafId) setActiveLeafId(result.leafId);
    if (result.messages.length === 0) return true;
    const previous = { messages: messagesRef.current, entryIds: entryIdsRef.current };
    const known = new Set(previous.entryIds);
    // 无 entryId 的本地行（运行期间由流式事件推入）无法与落盘条目准确对应，
    // 只能按内容比对，因此该模式仅处理用户条目。
    if (mode === "user-only") {
      const extra = result.entryIds.flatMap((entryId, index) => {
        const message = result.messages[index];
        if (!message || known.has(entryId) || message.role !== "user") return [];
        if (previous.messages.some((m) => m.role === "user" && userMessageKey(m) === userMessageKey(message))) return [];
        return [{ id: entryId, message }];
      });
      if (extra.length === 0) return true;
      const next = {
        messages: [...previous.messages, ...extra.map((entry) => entry.message)],
        entryIds: [...previous.entryIds, ...extra.map((entry) => entry.id)],
      };
      setMessageKeyAliases((aliases) => carryMessageKeys({ ...previous, aliases }, next));
      setMessages(next.messages);
      setEntryIds(next.entryIds);
      return true;
    }
    // 回合结束：落盘版本为权威。以锚点为界，把该行之后的本地行整段替换，
    // 不逐条配对；此时不存在尚未落盘的行。
    const held = Math.min(previous.entryIds.length, previous.messages.length);
    const fresh = result.entryIds.flatMap((entryId, index) => {
      const message = result.messages[index];
      if (!message || known.has(entryId)) return [];
      return [{ id: entryId, message }];
    });
    if (fresh.length === 0) return true;
    const next = {
      messages: [...previous.messages.slice(0, held), ...fresh.map((entry) => entry.message)],
      entryIds: [...previous.entryIds, ...fresh.map((entry) => entry.id)],
    };
    setMessageKeyAliases((aliases) => carryMessageKeys({ ...previous, aliases }, next));
    setMessages(next.messages);
    setEntryIds(next.entryIds);
    return true;
  }, [setActiveLeafId, setMessages, setEntryIds, setMessageKeyAliases, messagesRef, entryIdsRef]);

  /**
   * 对齐：视图落后于会话文件时，补入缺失的条目，不替换整窗。
   *
   * 触发来源：`sent`（发送成功后的第一次校核）、`settle`（本轮结束）、
   * `resume`（流重连、切回前台、网络恢复）、`gap`（心跳兜底）。判断只看
   * entryId，不比对消息体。
   */
  const reconcileSession = useCallback(async (
    sid: string,
    reason: "sent" | "settle" | "resume" | "gap",
  ) => {
    if (sessionIdRef.current !== sid) return;
    if (reconcileInFlightRef.current) return;
    reconcileInFlightRef.current = true;
    try {
      const anchor = entryIdsRef.current[entryIdsRef.current.length - 1] ?? null;
      if (!anchor) {
        // 尚无锚点（新会话首条之前，挂载时的整窗读取仍在进行）：不重复读取。
        if (reason === "settle") await loadSession(sid);
        return;
      }
      const tail = await probeSessionTail(sid);
      if (!tail) {
        // 接口不可用：仅 `settle` 值得退回整窗读取，其余等下一次机会。
        if (reason === "settle") await loadSession(sid);
        return;
      }
      if (tail.lastEntryId === anchor) return;
      // 只并入锚点之后的条目，读取窗口不会变宽。运行期间（或发送后的校核）
      // 仅并入用户条目，其余角色由 SSE 提供；回合结束时并入全部角色。
      // 锚点被挤出窗口（`sinceReset`）时退回整窗读取。
      const userOnly = reason === "sent" || agentRunningRef.current;
      if (!(await appendSessionSince(sid, anchor, userOnly ? "user-only" : undefined))) await loadSession(sid);
    } finally {
      reconcileInFlightRef.current = false;
    }
  }, [appendSessionSince, loadSession]);

  const syncEntryIdsAfterRun = useCallback((sid: string) => {
    // entryId 仅在读盘后可得（SSE 只推送消息正文），而编辑与分叉以 entryId
    // 为开关：回合结束时若 entryId 数量少于消息数量，做一次对齐。
    if (entryIdsRef.current.length >= messagesRef.current.length) return;
    void reconcileSession(sid, "settle");
  }, [reconcileSession]);
  // The hook unmounts (a session switch) with a send still unconfirmed: nothing
  // here will settle it, so its text goes back unless one of the run's events
  // cleared the record. With the stream closed, a prompt that did arrive is
  // given back too, without a notice. A fresh composer's goes to its cwd's
  // parked draft: its session has no row and no draft of its own until a
  // prompt reaches it (getRpcSessionInfos()). The cached view loses the bubble:
  // coming back, a read of an unchanged file keeps that view, and a changed
  // one replaces it with the prompt if it did arrive.
  const releaseUnconfirmedSend = useCallback(() => {
    const pending = unconfirmedSendRef.current;
    unconfirmedSendRef.current = null;
    if (!pending) return;
    if (pending.parkedDraftKey) {
      const images = pending.images?.map(({ data, mimeType }) => ({ data, mimeType }));
      restoreDraftSubmission(pending.parkedDraftKey, pending.message, images);
    } else {
      restoreSubmission(pending.message, pending.images, pending.draftKey);
    }
    dropUnconfirmedBubble(pending);
  }, [dropUnconfirmedBubble, restoreSubmission]);
  const releaseUnconfirmedSendRef = useRef(releaseUnconfirmedSend);
  releaseUnconfirmedSendRef.current = releaseUnconfirmedSend;

  // 归属按「这个事件流属于哪个会话」记，而不是选中的会话：新会话草稿期
  // sessionIdRef 还没换成真实 id，事件却已经属于刚建好的那个会话。
  const requestOwnerSessionId = useCallback(
    () => eventConnectionRef.current?.snapshot().sessionId ?? sessionIdRef.current,
    [],
  );
  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    if (isBlockingExtensionUiRequest(request)) onAttentionNeeded?.(request, requestOwnerSessionId());

    switch (request.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor": {
        const owner = requestOwnerSessionId();
        if (owner) extensionRequestOwnerRef.current.set(request.id, owner);
        setExtensionDialogs((queue) => enqueueExtensionUiRequest(queue, request));
        break;
      }
      case "notify": {
        if (request.id && !isFirstNoticeShowing(request.id)) break;
        addNotice({
          id: request.id,
          message: stripAnsi(request.message),
          type: request.notifyType ?? "info",
        });
        break;
      }
      case "setStatus":
        extensionUiGateRef.current.observe();
        setExtensionStatuses((prev) => {
          const rest = prev.filter((item) => item.key !== request.statusKey);
          return request.statusText !== undefined
            ? [...rest, { key: request.statusKey, text: request.statusText }]
            : rest;
        });
        break;
      case "setWidget":
        extensionUiGateRef.current.observe();
        setExtensionWidgets((prev) => updateExtensionWidgets(
          prev,
          request.widgetKey,
          request.widgetLines,
          request.widgetPlacement,
        ));
        break;
      case "setTitle":
        if (request.title) document.title = stripAnsi(request.title);
        break;
      case "set_editor_text":
        // pi's editor setText(): the draft is replaced (an empty text clears it).
        opts.chatInputRef?.current?.setText(stripAnsi(request.text));
        break;
      case "custom":
        if (request.closed) extensionRequestOwnerRef.current.delete(request.id);
        else {
          const owner = requestOwnerSessionId();
          if (owner) extensionRequestOwnerRef.current.set(request.id, owner);
        }
        setExtensionCustomUis((queue) => request.closed
          ? removeExtensionUiRequest(queue, request.id)
          : upsertExtensionUiRequest(queue, request));
        break;
    }
  }, [addNotice, onAttentionNeeded, opts.chatInputRef, requestOwnerSessionId]);

  const settleUiStage = useCallback(() => {
    const wasRunning = agentRunningRef.current;
    agentRunningRef.current = false;
    setAgentRunning(false);
    agentPhaseStore.set(null);
    setRetryInfo(null);
    activeToolsStore.clear();
    dispatch({ type: "end" });
    return wasRunning;
  }, [activeToolsStore, agentPhaseStore, dispatch]);

  const notifyPromptStage = useCallback((runId: number, aborted = false, subagentsActive = false) => {
    if (notifiedPromptRunIdRef.current === runId) return false;
    notifiedPromptRunIdRef.current = runId;
    onAgentEnd?.({ aborted, sessionId: sessionIdRef.current, ...(subagentsActive ? { subagentsActive } : {}) });
    return true;
  }, [onAgentEnd]);

  const scheduleEventStreamClose = useCallback((sid: string) => {
    if (sessionPropIdRef.current === sid) {
      cancelEventStreamGrace();
      return;
    }
    cancelEventStreamGrace();
    eventStreamGraceActiveRef.current = true;
    const generation = eventStreamGraceGenerationRef.current;

    const checkServerIdle = async () => {
      if (
        generation !== eventStreamGraceGenerationRef.current
        || sessionIdRef.current !== sid
        || !eventStreamGraceActiveRef.current
      ) return;

      try {
        const res = await fetch(agentStatusUrl(sid));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
        if (
          generation !== eventStreamGraceGenerationRef.current
          || sessionIdRef.current !== sid
          || !eventStreamGraceActiveRef.current
        ) return;

        const state = data.state;
        syncLiveModel(state);
        const promptActive = Boolean(data.running && state && (state.isStreaming || state.isPromptRunning));
        if (promptActive) {
          eventStreamGraceActiveRef.current = false;
          eventStreamGraceTimerRef.current = null;
          eventStreamGraceDueAtRef.current = null;
          sdkAgentActiveRef.current = Boolean(state?.isStreaming);
          rpcPromptPendingRef.current = Boolean(state?.isPromptRunning);
          agentRunningRef.current = true;
          setAgentRunning(true);
          agentPhaseStore.set((prev) => runStatePhase(prev, Boolean(state?.isStreaming)));
          return;
        }

        if (data.running && state?.isCompacting) {
          setIsCompacting(true);
          eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
          eventStreamGraceDueAtRef.current = Date.now() + PROMPT_SETTLE_POLL_MS;
          return;
        }

        eventStreamGraceActiveRef.current = false;
        eventStreamGraceTimerRef.current = null;
        eventStreamGraceDueAtRef.current = null;
        closeEvents("grace_end");
      } catch {
        // Keep the stream alive while state cannot be verified.
        if (
          generation !== eventStreamGraceGenerationRef.current
          || sessionIdRef.current !== sid
          || !eventStreamGraceActiveRef.current
        ) return;
        eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
        eventStreamGraceDueAtRef.current = Date.now() + PROMPT_SETTLE_POLL_MS;
      }
    };

    eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), EVENT_STREAM_IDLE_GRACE_MS);
    eventStreamGraceDueAtRef.current = Date.now() + EVENT_STREAM_IDLE_GRACE_MS;
  }, [agentPhaseStore, cancelEventStreamGrace, closeEvents, syncLiveModel]);

  const finishPromptWithoutStream = useCallback(async (sid: string | null = sessionIdRef.current, runId = promptRunIdRef.current) => {
    // Bail out before loadSession too: a stale finish for a previous run
    // must not overwrite the messages of the run currently streaming.
    if (promptRunIdRef.current !== runId) return;
    const readSeqBefore = sessionReadSeqRef.current;
    // 送达确认先走轻量探测（只要末条 entryId）：大号消息下整窗重读会把确认拖成超时。
    const pendingSend = unconfirmedSendRef.current;
    let probe: "landed" | "absent" | undefined;
    if (sid && pendingSend && pendingSend.sid === sid) {
      const tail = await probeSessionTail(sid);
      if (tail) probe = tail.lastEntryId !== pendingSend.lastEntryIdAtSend ? "landed" : "absent";
    }
    try {
      if (sid && !(pendingSend && pendingSend.sid === sid && probe === "absent")) {
        // 对齐优先，不整窗替换：整窗读会用“落盘前”的快照把刚追加的乐观气泡抹掉。
        await reconcileSession(sid, "settle");
      }
    } finally {
      if (promptRunIdRef.current !== runId) return;
      // The server is idle: an unconfirmed send of this run either is in the
      // read just made or never arrived.
      if (sid) settleUnconfirmedSend(sid, runId, readSeqBefore, probe);
      const promptWasPending = rpcPromptPendingRef.current;
      const agentWasActive = sdkAgentActiveRef.current;
      rpcPromptPendingRef.current = false;
      sdkAgentActiveRef.current = false;
      optimisticUserMessageKeyRef.current = null;
      const wasRunning = settleUiStage();
      if (promptWasPending) {
        notifyPromptStage(runId);
      } else if (agentWasActive && wasRunning) {
        onAgentEnd?.({ aborted: false, sessionId: sessionIdRef.current });
      }
      if (sid) scheduleEventStreamClose(sid);
    }
  }, [notifyPromptStage, onAgentEnd, scheduleEventStreamClose, settleUiStage, settleUnconfirmedSend, reconcileSession]);

  const waitForPromptSettlement = useCallback(async (sid: string, runId?: number) => {
    await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
    const startedAt = Date.now();

    while (agentRunningRef.current && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      try {
        const res = await fetch(agentStatusUrl(sid));
        if (res.ok) {
          const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
          const state = data.state;
          syncLiveModel(state);
          if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
            await finishPromptWithoutStream(sid, runId);
            return;
          }
        }
      } catch {
        // SSE remains the primary completion path.
      }
      await delay(PROMPT_SETTLE_POLL_MS);
    }
  }, [finishPromptWithoutStream, syncLiveModel]);

  const waitForBashSettlement = useCallback(async (sid: string) => {
    const recoveryId = bashRecoveryIdRef.current + 1;
    bashRecoveryIdRef.current = recoveryId;

    while (
      bashRunningRef.current
      && bashRecoveryIdRef.current === recoveryId
      && sessionIdRef.current === sid
    ) {
      await delay(BASH_STATE_RECONCILE_MS);
      try {
        const res = await fetch(agentStatusUrl(sid));
        if (!res.ok) continue;
        const data = await res.json() as { state?: AgentStateResponse };
        syncLiveModel(data.state);
        if (data.state?.isBashRunning) continue;

        await loadSession(sid);
        if (bashRecoveryIdRef.current !== recoveryId || sessionIdRef.current !== sid) return;
        bashRunningRef.current = false;
        setBashRunning(false);
        setPendingBash(null);
        return;
      } catch {
        // Keep polling while the page is mounted; network recovery is transparent.
      }
    }
  }, [loadSession, syncLiveModel]);

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_end never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same settlement path used by non-streaming prompts.
  const reconcileAgentState = useCallback(async (sid: string) => {
    if (!agentRunningRef.current || sessionIdRef.current !== sid) return;
    const runId = promptRunIdRef.current;
    const queueToken = queueSnapshotGateRef.current.capture();
    const extensionUiToken = extensionUiGateRef.current.capture();
    const usageRequestId = ++contextUsageRequestIdRef.current;
    try {
      const res = await fetch(agentStatusUrl(sid));
      if (!res.ok) return;
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      // A slow response can straddle a run boundary (previous run finished
      // and the user already started the next one while this request was in
      // flight) — everything in it is stale, drop it.
      if (sessionIdRef.current !== sid || promptRunIdRef.current !== runId) return;
      const state = data.state;
      applyLiveUsage(state, sid, runId, usageRequestId);
      syncLiveModel(state);
      // Mirror compaction state unconditionally: a missed compaction_end
      // would otherwise leave the "Stop compaction" UI stuck. No state
      // (wrapper destroyed) means nothing is compacting.
      setIsCompacting(state?.isCompacting ?? false);
      setAutoCompactionEnabled(state?.autoCompactionEnabled ?? true);
      applyRecordedQueueSnapshot(normalizeQueuedMessages(state?.queuedMessages), queueToken, state?.queuedEntries);
      const busy = data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isCompacting);
      if (busy) {
        sdkAgentActiveRef.current = Boolean(state.isStreaming);
        rpcPromptPendingRef.current = Boolean(state.isPromptRunning);
        return;
      }
      if (!agentRunningRef.current) return;
      if (state) {
        if (extensionUiGateRef.current.isFresh(extensionUiToken)) {
          if (state.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
          if (state.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
        }
        // The poll leaves the prompt out: read the one the run ended with once, as agent_end does.
        fetch(`/api/agent/${encodeURIComponent(sid)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((d: { state?: AgentStateResponse } | null) => {
            if (!d || !sessionHookMountedRef.current || sessionIdRef.current !== sid) return;
            if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
          })
          .catch(() => {});
      }
      await finishPromptWithoutStream(sid, runId);
    } catch {
      // Network still down — the next poll / visibility / online tick retries.
    }
  }, [applyLiveUsage, applyRecordedQueueSnapshot, finishPromptWithoutStream, syncLiveModel]);

  // Recovery net for missed SSE events: while the agent is running, verify
  // against the server periodically and whenever the tab returns to the
  // foreground or the network comes back.
  useEffect(() => {
    if (!agentRunning) return;
    let lastReconcile = Date.now();
    const reconcile = () => {
      lastReconcile = Date.now();
      // Read the ref on every tick: for brand-new sessions the id is
      // assigned only after ensure_session returns.
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    // queue_update over SSE is the instant channel, but a paused or closed
    // stream leaves queue rows stale until the next state read — shorten that
    // window to 3s while rows are on screen (and the page is visible).
    const tick = () => {
      const due = queuedSubmissionsRef.current.length > 0 && document.visibilityState === "visible"
        ? QUEUE_FAST_RECONCILE_MS
        : AGENT_STATE_RECONCILE_MS;
      if (Date.now() - lastReconcile >= due) reconcile();
    };
    const interval = setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, reconcileAgentState]);

  // 切回前台 / 网络恢复：对齐一次。SSE 断开期间的事件不会自动回放，靠这里补。
  useEffect(() => {
    const sync = () => {
      const sid = sessionIdRef.current;
      if (sid) void reconcileSession(sid, "resume");
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", sync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", sync);
    };
  }, [reconcileSession]);


  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  // 离开 ≥30s 的活跃会话回来时整窗骨架重载：切走时记下会话与离开时间
  // （localStorage，跨刷新存活，仅活跃会话即跑着的回合或命令）；
  // 回来时若这段 JS 上下文没刷过（内存标记还在），按手动重新加载的样子
  // loadSession(…, true)；页面若重新挂载（刷新/重开），挂载时删掉遗留记录，
  // 走正常初始化，不做骨架重载。
  const awayWhileMountedRef = useRef<string | null>(null);
  useEffect(() => {
    if (readSessionAway()) clearSessionAway();
  }, []);
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const sid = sessionIdRef.current;
        if (sid && (agentRunningRef.current || bashRunningRef.current)) {
          recordSessionAway(sid);
          awayWhileMountedRef.current = sid;
        }
        return;
      }
      const away = awayWhileMountedRef.current;
      if (!away) return;
      awayWhileMountedRef.current = null;
      const record = readSessionAway();
      clearSessionAway();
      const sid = sessionIdRef.current;
      if (!record || record.sessionId !== away || !sid || sid !== away) return;
      if (Date.now() - record.leftAt < awayReloadMs()) return;
      // 和点击重新加载一样：整窗骨架。
      void loadSession(sid, true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadSession]);

  /**
   * 把缓存的会话视图铺到状态里（挂载与休眠唤醒共用）：只恢复已定形的历史字段，
   * 不带流式、队列与运行状态。返回是否命中缓存。
   */
  const restoreCachedView = useCallback((sid: string): boolean => {
    const cached = getSessionViewSnapshot(sid);
    if (!cached) return false;
    setData({
      sessionId: sid,
      filePath: "",
      totalActiveMs: cached.totalActiveMs ?? 0,
      tree: cached.summaryTree as SessionData["tree"],
      leafId: cached.leafId,
      context: {
        messages: cached.messages,
        entryIds: cached.entryIds,
        oldestEntryId: cached.oldestEntryId,
        hasMore: cached.hasMore,
        turnsBefore: cached.turnsBefore,
        thinkingLevel: cached.thinkingLevel,
        model: cached.model,
      },
      stats: cached.stats as SessionData["stats"],
    });
    setActiveLeafId(cached.leafId);
    setMessages(cached.messages);
    setEntryIds(cached.entryIds);
    setHistoryCursor(cached.oldestEntryId);
    setHasEarlierMessages(cached.hasMore);
    setEarlierTurnCount(cached.turnsBefore);
    setError(null);
    setLoading(false);
    return true;
  }, []);

  // Dormancy: a keep-alive slot hidden beyond DORMANT_AFTER_MS unloads its
  // message list (the DOM is the memory cost); reactivation reloads once.
  // Running slots never go dormant and the probe effect idles while dormant,
  // so nothing refills the list until the slot is shown again.
  const dormantUnloadRef = useRef(false);
  useEffect(() => {
    if (!dormant || agentRunningRef.current || session === null || messages.length === 0) return;
    setMessages([]);
    setEntryIds([]);
    // 唤醒后从叶子整载，窗口标记与实时缓冲不留残留（同整载路径）。
    setNewestCursor(null);
    setHasNewerMessages(false);
    pendingWindowMessagesRef.current = [];
    dormantUnloadRef.current = true;
  }, [dormant, session, messages.length]);
  useEffect(() => {
    if (dormant || !dormantUnloadRef.current || session === null) return;
    dormantUnloadRef.current = false;
    // 唤醒先铺缓存窗口再补读：休眠卸掉的只是 DOM，快照还在，没必要先白一下。
    restoreCachedView(session.id);
    void loadSession(session.id);
  }, [dormant, session, loadSession, restoreCachedView]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    if (endedSessionRef.current) return;
    switch (event.type) {
      case "session_ended": {
        const sid = sessionIdRef.current;
        if (!sid || event.sessionId !== sid) return;
        // The owner leaves the session (a fresh composer, or the tab closes) and this view
        // unmounts; until then nothing reconnects, which would start the runtime again.
        endedSessionRef.current = sid;
        cancelEventStreamGrace();
        eventConnectionRef.current?.close();
        deleteSessionViewSnapshot(sid);
        onSessionEnded?.(sid);
        return;
      }
      case "connected": {
        dispatch({ type: "end" });
        {
          // 流重连/首次连上：对齐一次。断开期间的事件不会回放，靠这里补。
          const resumeSid = sessionIdRef.current;
          if (resumeSid) void reconcileSession(resumeSid, "resume");
        }
        if (Array.isArray(event.pendingExtensionUiIds)) {
          // The server replays what it still holds right after this event.
          const pending = new Set(event.pendingExtensionUiIds as string[]);
          setExtensionDialogs((queue) => retainExtensionUiRequests(queue, pending));
          setExtensionCustomUis((queue) => retainExtensionUiRequests(queue, pending));
        }
        // isStreaming 只覆盖 token 流式；工具执行中 / compaction / bash 阶段它是
        // false，只看它会把运行中的面板重置回空闲（composer 变输入态、活动行
        // 消失、已完成回复画出用量条）。isRunActive 是服务端完整判定。
        const runActive = event.isStreaming === true || event.isRunActive === true;
        if (runActive) {
          cancelEventStreamGrace();
          sdkAgentActiveRef.current = true;
          agentRunningRef.current = true;
          setAgentRunning(true);
          // The server replays every tool call still running right after this
          // event, so start from none: a call that ended while the stream was
          // down must not stay listed.
          agentPhaseStore.set({ kind: "waiting_model" });
        }
        // Opening the stream is what resumes an idle-reaped session, so the
        // mount's state read may have found no runtime and no usage to show.
        if (sessionIdRef.current) void refreshContextUsage(sessionIdRef.current);
        // 重连（不是首次打开）说明断开期间落盘的条目没有流可以补：iOS 后台被杀
        // 连接、心跳超时、网络切换都会走到这里，而页面自己没发起释放。核对一次
        // 尾部——真有新条目就接上，没有就一字不动。首次打开不读：挂载路径已在读。
        if ((eventConnectionRef.current?.snapshot().opens ?? 0) > 1) {
          const sid = sessionIdRef.current;
          // 运行态由这个 connected 事件自己的 isRunActive 分支处理，这里只要
          // 把落盘的条目补上（loadSession 内部已有尾部核对与合并）。
          if (sid) void loadSession(sid, false, true);
        }
        break;
      }
      case "agent_start":
        markPromptLanded();
        cancelEventStreamGrace();
        sdkAgentActiveRef.current = true;
        agentRunningRef.current = true;
        setAgentRunning(true);
        agentPhaseStore.set({ kind: "waiting_model" });
        // A retry's wait is over once its run starts, as pi's TUI shows it: the
        // successful auto_retry_end comes only with the retry's first complete
        // reply, which can stream for minutes.
        setRetryInfo(null);
        dispatch({ type: "start" });
        break;
      case "agent_end":
        // One logical prompt can emit multiple agent_end events before retrying,
        // compacting, or continuing messages queued by extension handlers.
        // Keep the stream open until prompt_done/agent_settled and the idle grace.
        if (!agentRunningRef.current) break;
        agentPhaseStore.set(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          const sid = sessionIdRef.current;
          const runId = promptRunIdRef.current;
          const usageRequestId = ++contextUsageRequestIdRef.current;
          const queueToken = queueSnapshotGateRef.current.capture();
          const extensionUiToken = extensionUiGateRef.current.capture();
          fetch(`/api/agent/${encodeURIComponent(sid)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d: { state?: AgentStateResponse } | null) => {
              if (!d || !sessionHookMountedRef.current || sessionIdRef.current !== sid || promptRunIdRef.current !== runId) return;
              syncLiveModel(d.state);
              applyLiveUsage(d.state, sid, runId, usageRequestId);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
              // 回执期闸门：这次 GET 在读的瞬间可能已经比 SSE 上的 setStatus / setWidget 旧。
              if (extensionUiGateRef.current.isFresh(extensionUiToken)) {
                if (d.state?.extensionStatuses !== undefined) setExtensionStatuses(d.state.extensionStatuses ?? []);
                if (d.state?.extensionWidgets !== undefined) setExtensionWidgets(d.state.extensionWidgets ?? []);
              }
              // Aborted turns can leave messages queued in pi (delivered with the
              // next turn); dead wrapper (no state) means the queue is gone.
              applyRecordedQueueSnapshot(normalizeQueuedMessages(d.state?.queuedMessages), queueToken, d.state?.queuedEntries);
            })
            .catch(() => {});
        }
        break;
      case "agent_settled": {
        const agentWasActive = sdkAgentActiveRef.current;
        sdkAgentActiveRef.current = false;
        promptOwnUserKeyRef.current = null;
        if (!agentWasActive || rpcPromptPendingRef.current) break;

        const sid = sessionIdRef.current;
        const wasRunning = settleUiStage();
        setIsCompacting(false);
        if (sid) {
          // 落盘条目的同步：本回合的行是 SSE 追加的，没有 entryId，编辑 / 分叉
          // 按钮就不会出现（复制不依赖它）。id 缺失时补一次读，齐了之后不再读。
          syncEntryIdsAfterRun(sid);
          refreshStatsRef.current?.();
          scheduleEventStreamClose(sid);
        }
        if (wasRunning) {
          onAgentEnd?.({ aborted: event.aborted === true, sessionId: sessionIdRef.current, ...(event.subagentsActive === true ? { subagentsActive: true } : {}) });
        }
        break;
      }
      case "prompt_done":
        {
          markPromptLanded();
          const runId = promptRunIdRef.current;
          const promptWasPending = rpcPromptPendingRef.current;
          rpcPromptPendingRef.current = false;
          optimisticUserMessageKeyRef.current = null;
          const firstNotification = notifyPromptStage(runId, event.aborted === true, event.subagentsActive === true);
          if (!promptWasPending && !firstNotification) break;

          const sid = sessionIdRef.current;
          refreshStatsRef.current?.();
          // An extension-injected agent may already have started before the
          // command's prompt_done. Keep that active stage visible and let its
          // agent_settled event perform the next completion transition.
          if (!sdkAgentActiveRef.current) {
            settleUiStage();
            if (sid) {
              syncEntryIdsAfterRun(sid);
              scheduleEventStreamClose(sid);
            }
          }
        }
        break;
      case "prompt_error":
        addNotice({ type: "error", message: (event.errorMessage as string | undefined) ?? "Command failed" });
        break;
      case "extension_error":
        addNotice({
          type: "error",
          message: extensionErrorMessage(event.extensionPath, (event.error as string | undefined) ?? "Extension command failed"),
        });
        break;
      case "message_start":
      case "message_update": {
        // Ignore streaming events arriving after this run already finished
        // (e.g. SSE data buffered while the tab was frozen, flushed after
        // reconcile) — they would resurrect a ghost streaming bubble.
        if (!agentRunningRef.current) break;
        // Transcript system messages (prompt and tool loadout) are filtered
        // server-side; keep them out of the chat should one arrive.
        if (isSystemMessageEvent(event)) break;
        if (event.type === "message_start") {
          const msg = event.message as AgentMessage | undefined;
          if (msg?.role === "user") break;
          if (msg?.role === "assistant") {
            dispatch({ type: "snapshot", message: msg });
            if (msg.content.length > 0) agentPhaseStore.set(null);
          } else if (msg) {
            agentPhaseStore.set(null);
          }
        } else {
          const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
          if (delta) {
            dispatch({ type: "delta", event: delta });
            if (delta.type !== "toolcall_start" && delta.type !== "toolcall_delta") {
              agentPhaseStore.set(null);
            }
          }
        }
        // Streaming follow is the official `MessageScrollerProvider autoScroll`'s
        // job: its ResizeObserver on the content pins the tail while the reader
        // is in `following-bottom`, and a wheel/touch stops it. A second rAF
        // scroll here fought that one on the same frames.
        break;
      }
      case "message_end": {
        // 晚到的 message_end 不再读盘兜底（断流期落盘的条目由顶栏「重新加载」
        // 手动补），但本端 prompt 的归属键仍要在这里消费：这轮的 user 行已由
        // 乐观气泡占位，不能留着等到下一轮误吞。
        if (!agentRunningRef.current) {
          const early = event.message as AgentMessage | undefined;
          if (early?.role === "user" && promptOwnUserKeyRef.current !== null && promptOwnUserKeyRef.current === userMessageKey(normalizeToolCalls(early))) {
            promptOwnUserKeyRef.current = null;
          }
          break;
        }
        if (isSystemMessageEvent(event)) break;
        // 视图处于中段窗口时，本轮实时消息不在该窗口内，追加到窗口末尾会错位。
        // 不丢：缓冲后落位——从历史窗口就地发送（handleSend 重置窗口标记）时按
        // 到达顺序补齐；整页/续页历史重载自会从会话文件带上它们，缓冲随即清空。
        const completed = event.message as AgentMessage | undefined;
        if (hasNewerMessagesRef.current) {
          if (completed) {
            const bufferedNotices = Array.isArray(event.transcriptNotices) ? event.transcriptNotices as TranscriptNotice[] : undefined;
            pendingWindowMessagesRef.current.push(
              completed.role === "user"
                ? normalizeToolCalls(completed)
                : withTranscriptNotices(normalizeToolCalls(completed), bufferedNotices),
            );
          }
          break;
        }
        if (completed && completed.role === "user") {
          // Delivered steering/follow-up messages surface here as user
          // messages. The run's initial prompt also emits one, but handleSend
          // already appended it optimistically. Consume only the still-adjacent
          // optimistic bubble; later same-text queue deliveries must render.
          const delivered = normalizeToolCalls(completed);
          const deliveredKey = userMessageKey(delivered);
          const optimisticKey = optimisticUserMessageKeyRef.current;
          optimisticUserMessageKeyRef.current = null;
          const own = promptOwnUserKeyRef.current !== null && promptOwnUserKeyRef.current === deliveredKey;
          if (own) promptOwnUserKeyRef.current = null;
          // While the run's own bubble waits, a delivered user message is its prompt.
          if (optimisticKey) markPromptLanded();
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
              return optimisticKey === deliveredKey
                ? prev
                : [...prev.slice(0, -1), delivered];
            }
            // 自己 prompt 的迟到重放：列表里**真的**有这条才跳过。
            // 整窗读可能发生在落盘之前（立即发送：abort 的 settle 先跑），此时列表里
            // 并没有它，再跳过就是丢消息。
            if (own) {
              return prev.some((m) => m.role === "user" && userMessageKey(m) === deliveredKey)
                ? prev
                : [...prev, delivered];
            }
            return [...prev, delivered];
          });
        } else if (completed) {
          // pi's showCacheMissNotices (#1265): the wrapper sends them beside the message.
          const notices = Array.isArray(event.transcriptNotices) ? event.transcriptNotices as TranscriptNotice[] : undefined;
          setMessages((prev) => [...prev, withTranscriptNotices(normalizeToolCalls(completed), notices)]);
          if (completed.role === "assistant") {
            const sid = sessionIdRef.current;
            if (sid) void refreshContextUsage(sid);
          }
        }
        dispatch({ type: "end" });
        agentPhaseStore.set({ kind: "waiting_model" });
        break;
      }
      case "tool_execution_start": {
        // A call a tool made itself (a codemode script's) belongs to its
        // parent's card; listed here it would show as a top-level running tool,
        // and a call cut off by its script can end after the parent did.
        if (isNestedToolExecutionEvent(event)) break;
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        agentPhaseStore.set((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        if (isNestedToolExecutionEvent(event)) break;
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const partialResult = event.partialResult as Partial<ToolResultMessage> | undefined;
        const content = partialResult?.content;
        // Live output for shells; for codemode, the calls its script has made so far.
        if ((name === "bash" || name === "powershell" || name === CODEMODE_TOOL_NAME) && Array.isArray(content)) {
          activeToolsStore.set(id, {
            role: "toolResult",
            toolCallId: id,
            toolName: name,
            content,
            isError: partialResult?.isError,
            details: partialResult?.details,
          });
        }
        const progress = name === CODEMODE_TOOL_NAME
          ? getCodemodeProgress(event.partialResult)
          : getToolExecutionProgress(event.partialResult);
        agentPhaseStore.set((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          const existing = tools.find((tool) => tool.id === id);
          const updated = {
            id,
            name: name || existing?.name || "tool",
            progress: progress ?? existing?.progress,
          };
          return {
            kind: "running_tools",
            tools: [...tools.filter((tool) => tool.id !== id), updated],
          };
        });
        break;
      }
      case "tool_execution_end": {
        if (isNestedToolExecutionEvent(event)) break;
        const id = event.toolCallId as string;
        onToolEnd?.(event.toolName as string);
        activeToolsStore.remove(id);
        agentPhaseStore.set((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "queue_update":
        markPromptLanded();
        applyQueueSnapshot({
          steering: [...((event.steering as string[] | undefined) ?? [])],
          followUp: [...((event.followUp as string[] | undefined) ?? [])],
        });
        break;
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      // A compaction's or branch summary's summarizer call failed and waits to try
      // again, on the same retry budget as a turn: pi's TUI shows the error and the
      // countdown, here the retry banner does for the wait, as for a turn's retry.
      case "summarization_retry_scheduled":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "summarization_retry_attempt_start":
      case "summarization_retry_finished":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        setCompactResult(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        // pi sends summarization_retry_finished first; a stream down for that
        // retry missed it, and its banner would stay above an idle composer.
        setRetryInfo(null);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
          setCompactResult(null);
        } else if (!event.aborted) {
          setCompactResult(readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"));
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
      case "bash_output": {
        // The wrapper's snapshot of a running `!` command's output tail.
        const output = event.output;
        if (!bashRunningRef.current || typeof output !== "string") break;
        // A slow stream may still carry the previous command's last snapshot.
        setPendingBash((pending) => (
          pending && !pending.result && pending.command === event.command ? { ...pending, liveOutput: output } : pending
        ));
        break;
      }
      case "editor_paste":
        if (typeof event.text === "string") opts.chatInputRef?.current?.pasteText(stripAnsi(event.text));
        break;
      case "extension_ui_request":
        handleExtensionUiRequest(event as ExtensionUiRequest);
        break;
      case "extension_ui_closed": {
        extensionRequestOwnerRef.current.delete(event.id as string);
        setExtensionDialogs((queue) => removeExtensionUiRequest(queue, event.id as string));
        break;
      }
      case "heartbeat": {
        // 服务端每 30s 一条：顺手对一次尾 id。SSE 丢事件或连接半死时，
        // 这是不靠额外轮询的主动兜底。
        const beatSid = sessionIdRef.current;
        if (beatSid) void reconcileSession(beatSid, "gap");
        break;
      }
    }
  }, [activeToolsStore, addNotice, agentPhaseStore, applyLiveUsage, applyQueueSnapshot, applyRecordedQueueSnapshot, cancelEventStreamGrace, dispatch, handleExtensionUiRequest, loadSession, markPromptLanded, notifyPromptStage, onAgentEnd, onSessionEnded, onToolEnd, opts.chatInputRef, reconcileSession, refreshContextUsage, scheduleEventStreamClose, settleUiStage, syncEntryIdsAfterRun, syncLiveModel]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return;
    const isBashCommand = !images?.length && trimmedMessage.startsWith("!");
    // A `!` command may run beside a run, as in pi's TUI; one at a time.
    if (bashRunningRef.current || (agentRunningRef.current && !isBashCommand)) {
      // pi's TUI says why a second command waits.
      if (bashRunningRef.current && isBashCommand) addNotice({ type: "warning", message: translate("chat.bashAlreadyRunning") });
      restoreSubmission(message, images, composerDraftKey);
      return;
    }
    if (editEntryId) {
      // Navigate and prompt are two RPCs: a prompt rejected after navigating
      // keeps the new leaf until the server can apply both atomically.
      const entryId = editEntryId;
      setEdit(null);
      if (!(await handleNavigateRef.current?.(entryId))) {
        setEdit(entryId);
        restoreSubmission(message, images, composerDraftKey);
        return;
      }
    }
    const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");

    if (isBashCommand) {
      const isExcluded = trimmedMessage.startsWith("!!");
      const bashCmd = (isExcluded ? trimmedMessage.slice(2) : trimmedMessage.slice(1)).trim();
      if (!bashCmd) {
        restoreSubmission(message, images, composerDraftKey);
        return;
      }
      await executeBashRef.current?.(bashCmd, isExcluded);
      return;
    }

    const promptRunId = promptRunIdRef.current + 1;
    cancelEventStreamGrace();
    rpcPromptPendingRef.current = true;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    // What the view holds before the bubble: its last saved entry, and the same
    // text already sent since (the run messages the stream added), for #1432.
    const userKey = userMessageKey(userMsg);
    const savedViewIds = entryIdsRef.current;
    const lastEntryIdAtSend = savedViewIds.at(-1) ?? null;
    const sameTextAfterSend = countUserMessages(messagesRef.current.slice(savedViewIds.length), userKey);
    // 从历史窗口发出提问时先回到叶子，使新消息有正确落点；缓冲的中段窗口
    // 消息按到达顺序先于新提问补齐，乐观气泡随后追加（顺序不能颠倒）。
    if (hasNewerMessagesRef.current) {
      hasNewerMessagesRef.current = false;
      setHasNewerMessages(false);
      newestCursorRef.current = null;
      setNewestCursor(null);
      // 就地重置窗口标记没有整页重载来带上中段窗口期间送达的消息，此处按到达
      // 顺序补齐；相邻同文（可能已由续页加载）去重。
      const pendingWindowMessages = pendingWindowMessagesRef.current;
      pendingWindowMessagesRef.current = [];
      if (pendingWindowMessages.length > 0) {
        setMessages((prev) => {
          const next = [...prev];
          for (const pending of pendingWindowMessages) {
            const last = next[next.length - 1];
            if (pending.role === "user" && last?.role === "user"
              && userMessageKey(last) === userMessageKey(pending)) continue;
            next.push(pending);
          }
          return next;
        });
      }
    }
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = userKey;
    promptOwnUserKeyRef.current = userKey;
    promptRunIdRef.current = promptRunId;
    agentRunningRef.current = true;
    setAgentRunning(true);
    agentPhaseStore.set(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
    dispatch({ type: "start" });

    // A queued prompt (parked behind compaction, or queued into a run) is not a
    // sent message yet: the queue rows show it, and the transcript shows it when
    // the flush delivers it. Drop the optimistic bubble for it.
    const dropOptimisticUserMessage = () => {
      setMessages((prev) => {
        const index = prev.lastIndexOf(userMsg);
        return index === -1 ? prev : [...prev.slice(0, index), ...prev.slice(index + 1)];
      });
      optimisticUserMessageKeyRef.current = null;
    };
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    let sentSessionId: string | null = null;
    let promptRequestStarted = false;

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        const existingSid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
        const sid = existingSid ?? await ensureNewSession();

        if (!sid) throw new Error("Unable to create a session for the prompt");
        sentSessionId = sid;
        if (selectedModel) {
          setPendingModel(selectedModel);
          if (existingSid) {
            await sendAgentCommand(sid, { type: "set_model", provider: selectedModel.provider, modelId: selectedModel.modelId });
          }
        }
        // Switching sessions unmounts this composer and closes its stream. The
        // prompt still goes out, so the new session runs and gets its sidebar
        // row instead of losing the submitted text (#1146).
        if (sessionHookMountedRef.current) {
          await ensureEventsConnected(sid).catch((error) => {
            if (sessionHookMountedRef.current) throw error;
          });
        }
        promptRequestStarted = true;
        const queuedAck = await sendAgentCommand<{ queued?: boolean }>(sid, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
        if (queuedAck?.queued) dropOptimisticUserMessage();
        promoteNewSession(1, message);
      } else if (session) {
        sentSessionId = session.id;
        await ensureEventsConnected(session.id);
        promptRequestStarted = true;
        const queuedAck = await sendAgentCommand<{ queued?: boolean }>(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
        if (queuedAck?.queued) dropOptimisticUserMessage();
      } else {
        throw new Error("No active session for the prompt");
      }
      setPromptMissingCwd(null);
      // 发送后对一次账（1s 后单发，不轮询）：投递事件丢了也能把这条用户消息捞回来。
      if (sentSessionId) {
        const sentSid = sentSessionId;
        setTimeout(() => void reconcileSession(sentSid, "sent"), 1_000);
      }
      if (isSlashCommandPrompt && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      const definitivelyRejected = !promptRequestStarted || isPromptRejectedError(e);
      // A transport/proxy failure after dispatch is ambiguous: the server may
      // have accepted the prompt before the response was lost. Keep SSE alive
      // and the bubble until server state confirms the run is idle; the text
      // goes back only if the server never got it (settleUnconfirmedSend).
      // Nothing is sent again (#1432).
      if (!definitivelyRejected && sentSessionId) {
        if (landedPromptRunIdRef.current !== promptRunId) {
          unconfirmedSendRef.current = {
            runId: promptRunId,
            sid: sentSessionId,
            message,
            images,
            draftKey: composerDraftKey,
            parkedDraftKey: isNew && newSessionCwd ? parkedNewSessionDraftKey(newSessionCwd) : null,
            lastEntryIdAtSend,
            sameTextAfterSend,
            bubble: userMsg,
            key: userKey,
            command: isSlashCommandPrompt,
          };
          if (!sessionHookMountedRef.current) releaseUnconfirmedSend();
        }
        void waitForPromptSettlement(sentSessionId, promptRunId);
        return;
      }
      rpcPromptPendingRef.current = false;
      setMessages((prev) => withoutMessage(prev, userMsg));
      // A folder that no longer exists never reached the model: the composer's
      // banner names it (translated) instead of the server's English notice.
      if (e instanceof AgentCommandError && e.missingCwd) setPromptMissingCwd(e.missingCwd);
      else addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      restoreSubmission(message, images, composerDraftKey);
      optimisticUserMessageKeyRef.current = null;
      promptOwnUserKeyRef.current = null;
      // Rejection only describes this submission. Another tab or an event we
      // missed may still have a real run active for the same session, so keep
      // its SSE connection until server state says the wrapper is idle.
      if (sentSessionId) {
        void reconcileAgentState(sentSessionId);
        return;
      }
      agentRunningRef.current = false;
      closeEvents("send_failed");
      setAgentRunning(false);
      agentPhaseStore.set(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, session, ensureNewSession, ensureEventsConnected, promoteNewSession, waitForPromptSettlement, addNotice, agentPhaseStore, releaseUnconfirmedSend, cancelEventStreamGrace, closeEvents, composerDraftKey, dispatch, reconcileAgentState, restoreSubmission, editEntryId, setEdit, translate, reconcileSession]);

  const executeBash = useCallback(async (command: string, excludeFromContext: boolean) => {
    if (bashRunningRef.current) return;
    const inputText = `${excludeFromContext ? "!!" : "!"}${command}`;
    bashRunningRef.current = true;
    const startedAt = Date.now();
    setPendingBash({ command, excludeFromContext, startedAt });
    setBashRunning(true);
    let deferred: PendingBash | null = null;
    try {
      const sid = sessionIdRef.current ?? session?.id ?? await ensureNewSession();
      if (!sid) throw new Error("Unable to create a session for the shell command");
      // A `user_bash` handler's dialog (ctx.ui.confirm…) reaches the page only
      // through the stream, which a fresh composer has not opened yet. The
      // output streams through it too; without one it comes at the end.
      await ensureEventsConnected(sid).catch(() => {});
      const result = await sendAgentCommand<PendingBash["result"]>(sid, {
        type: "bash",
        command,
        excludeFromContext,
      });
      if (agentRunningRef.current && result) {
        // pi writes it once the run ends; the card shows the output until then.
        deferred = { command, excludeFromContext, startedAt, result };
        // Only a read started after this one may take the card away.
        deferredBashReadSeqRef.current = sessionReadSeqRef.current;
      } else {
        await loadSession(sid);
        promoteNewSession(1, inputText);
      }
    } catch (e) {
      console.error("Failed to execute shell command:", e);
      // A handler's error showed already, as the runner's extension_error.
      if (!(e instanceof AgentCommandError && e.code === EXTENSION_REPORTED_CODE)) {
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      restoreSubmission(inputText, undefined, composerDraftKey);
    } finally {
      bashRunningRef.current = false;
      setPendingBash(deferred);
      setBashRunning(false);
    }
  }, [addNotice, composerDraftKey, ensureEventsConnected, ensureNewSession, loadSession, promoteNewSession, restoreSubmission, session]);
  executeBashRef.current = executeBash;

  // A `!` result held for the run's end (`PendingBash.result`): pi wrote it before the run
  // settled, so a read started now has it and the card goes (`afterRun`). A fresh read:
  // prompt_done and finishPromptWithoutStream() read before they settle, and any read
  // would join the one agent_end started while the run went on.
  const heldBashResult = pendingBash?.result;
  useEffect(() => {
    if (agentRunning || !heldBashResult) return;
    const sid = sessionIdRef.current;
    if (sid) void loadSession(sid, false, false, { force: true });
  }, [agentRunning, heldBashResult, loadSession]);


  /** Recall's and Stop's queued texts, and the images of prompts parked behind a compaction, back in the composer. */
  const restoreRecalledPrompts = useCallback((recalled: RecalledPrompts | null | undefined) => {
    const text = [...(recalled?.steering ?? []), ...(recalled?.followUp ?? [])].join("\n\n");
    if (recalled?.images?.length) restoreSubmission(text, recalled.images, composerDraftKey);
    else if (text) opts.chatInputRef?.current?.prependText(text);
  }, [composerDraftKey, opts.chatInputRef, restoreSubmission]);

  /**
   * Stop hands the queue back: send it in arrival order once the stopped run has
   * unwound, so a message typed during that run still goes out. The first opens a
   * new run; the rest join it under the behavior they were queued with.
   */
  const resendStopQueue = useCallback(async (sid: string, entries: StopQueueEntry[]) => {
    const deadline = Date.now() + STOP_RESEND_SETTLE_TIMEOUT_MS;
    while (agentRunningRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, STOP_RESEND_POLL_MS));
    }
    for (const [index, entry] of entries.entries()) {
      if (sessionIdRef.current !== sid) return;
      const images = entry.images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
      try {
        await sendAgentCommand(sid, {
          type: "prompt",
          message: entry.text,
          ...(index > 0 ? { streamingBehavior: entry.behavior } : {}),
          ...(images?.length ? { images } : {}),
        });
      } catch (e) {
        console.error("Failed to resend a stopped run's queue:", e);
        const rest = entries.slice(index);
        restoreSubmission(rest.map((entry) => entry.text).join("\n\n"), entry.images, composerDraftKey);
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
  }, [addNotice, composerDraftKey, restoreSubmission]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Stop always ends the run; the bash channel is an extra, never a
    // substitute. A stale bash record (a missed settlement) used to swallow
    // the click entirely, so the agent kept running.
    const stopBash = bashRunningRef.current;
    try {
      // Prompts parked behind a compaction come back with pi's queue; Stop hands
      // all of them back to be sent again rather than put into the composer.
      const [recalled] = await Promise.all([
        sendAgentCommand<RecalledPrompts | null>(sid, { type: "abort" }),
        stopBash ? sendAgentCommand(sid, { type: "abort_bash" }).catch(() => null) : Promise.resolve(null),
      ]);
      if (stopBash) {
        bashRunningRef.current = false;
        setBashRunning(false);
        setPendingBash(null);
      }
      const queued = recalled?.queued ?? [];
      if (queued.length) {
        applyQueuedRecords(emptyQueuedMessages(), []);
        void resendStopQueue(sid, queued);
      } else restoreRecalledPrompts(recalled);
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, [applyQueuedRecords, resendStopQueue, restoreRecalledPrompts]);

  /** `draft` is what the new session's composer starts with: the forked message, as pi's /fork leaves it in the editor. */
  const handleFork = useCallback(async (entryId: string, draft?: ChatDraft) => {
    if (bashRunningRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        if (draft) setDraft(newSessionId, draft);
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setForkingEntryId(null);
    }
  }, [addNotice, onSessionForked]);

  const handleNavigate = useCallback(async (entryId: string): Promise<boolean> => {
    if (bashRunningRef.current) return false;
    const sid = sessionIdRef.current;
    if (!sid) return false;
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean }>(sid, {
        type: "navigate_tree",
        targetId: entryId,
      });
      if (result?.cancelled || sessionIdRef.current !== sid) return false;
      await loadSession(sid);
      return sessionIdRef.current === sid;
    } catch (e) {
      console.error("Failed to navigate:", e);
      return false;
    }
  }, [loadSession]);
  handleNavigateRef.current = handleNavigate;

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    // pi refuses navigate_tree mid-run: it moves the one leaf the running agent
    // appends to. Switching only the view would render the live run under
    // another branch, so the switch waits for the run like the server does.
    if (bashRunningRef.current || agentRunningRef.current || isCompacting) return;
    setActiveLeafId(leafId);
    // Sync the ref now, not at the next render: loadContext's guard discards
    // leaf-scoped responses for another leaf, and its fetch can resolve before
    // React commits this switch.
    activeLeafIdRef.current = leafId;
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {
        // The server leaf and the UI leaf have drifted; surface it instead of
        // silently continuing (the next prompt would append to a stale branch).
        addNotice?.({ type: "error", message: "Branch switch failed on the server; the view may be out of date." });
      });
    }
  }, [isCompacting, loadContext, addNotice]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      const selectedModel = { provider, modelId };
      newSessionModelOverrideRef.current = selectedModel;
      setNewSessionModel(selectedModel);
      setPendingModel(selectedModel);
      if (thinkingLevelOverrideRef.current === null) {
        const pinned = thinkingLevelPinsRef.current[`${provider}/${modelId}`];
        setNewSessionDefaultThinkingLevel(
          asConcreteThinkingLevel(pinned) ?? defaultThinkingLevelRef.current,
        );
      }
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid || modelSwitchPendingRef.current) return;
    const target = { provider, modelId };
    const previousOverride = currentModelOverride;
    modelSwitchPendingRef.current = true;
    setCurrentModelOverride(target);
    setModelSwitching(true);
    // A switch during a run applies from the run's next model request, as the
    // reasoning level does. Reading the file then would swap the run's messages
    // under the stream, so take the model and level from the live state; the
    // run's end reads the file.
    const midRun = agentRunningRef.current || bashRunningRef.current;
    const syncLiveState = async () => {
      const res = await fetch(agentStatusUrl(sid)).catch(() => null);
      const d = res?.ok ? await res.json().catch(() => null) as { state?: AgentStateResponse } | null : null;
      if (d?.state && sessionHookMountedRef.current && sessionIdRef.current === sid) syncLiveModel(d.state);
    };
    try {
      const selected = await sendAgentCommand<{ provider: string; id: string }>(sid, { type: "set_model", provider, modelId });
      setLiveModel({ provider: selected.provider, modelId: selected.id });
      modelSwitchPendingRef.current = false;
      if (midRun) {
        setCurrentModelOverride(null);
        await syncLiveState();
      } else {
        // Pi persists model_change synchronously. Reload the canonical session so
        // the model, thinking level, and active leaf all advance together.
        await loadSession(sid);
      }
    } catch (e) {
      console.error("Failed to set model:", e);
      modelSwitchPendingRef.current = false;
      setCurrentModelOverride(previousOverride);
      addNotice({
        type: "error",
        message: `Failed to switch model: ${e instanceof Error ? e.message : String(e)}`,
      });
      // A failed response can still follow a server-side write (for example, a
      // dropped connection), so let the server settle the displayed model.
      if (midRun) await syncLiveState();
      else await loadSession(sid, false, true);
    } finally {
      modelSwitchPendingRef.current = false;
      setModelSwitching(false);
    }
  }, [addNotice, currentModelOverride, isNew, loadSession, setNewSessionModel, syncLiveModel]);

  /**
   * Manual compaction (the Compact button and `/compact`). Never awaited by a
   * caller that holds the composer: the compact POST is blocking and lasts the
   * whole compaction, and `runBuiltinCommand` keeps the composer's fieldset
   * disabled until the command resolves. The compaction reports itself — the
   * Compacting status, Stop compaction, the result banner and its error.
   */
  /** Resolves false when the compaction failed. */
  const handleCompact = useCallback(async (customInstructions?: string): Promise<boolean> => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return true;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, {
        type: "compact",
        ...(customInstructions ? { customInstructions } : {}),
      });
      setCompactResult(readCompactResult(result, "manual"));
      if (await loadSession(sid, true)) promoteNewSession();
      return true;
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
      return false;
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession, promoteNewSession]);

  // The banner otherwise stays until the next compaction, e.g. "Nothing to compact".
  const dismissCompactError = useCallback(() => setCompactError(null), []);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    let d: ModelsResponse;
    let cwdGone: string | null = null;
    try {
      const res = await fetch(modelsUrl, signal ? { signal } : undefined);
      if (!res.ok) {
        let detail = "";
        try {
          const body: unknown = await res.json();
          if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
            detail = body.error;
          }
          cwdGone = missingCwdFromBody(body);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          // Non-JSON error responses fall back to the HTTP status.
        }
        throw new Error(detail || `Failed to load models (HTTP ${res.status})`);
      }
      d = await res.json() as ModelsResponse;
      signal?.throwIfAborted();
    } catch (e) {
      if (!signal?.aborted && !(e instanceof DOMException && e.name === "AbortError")) {
        // A moved or deleted project folder is not a model problem (#1422).
        setModelsMissingCwd(cwdGone);
        setModelError(cwdGone ? null : e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
    setModelsMissingCwd(null);
    setModelNames(d.models);
    setModelError(d.modelError ?? null);
    setModelScopeWarnings(d.modelScopeWarnings ?? []);
    setIsModelScopeActive(Boolean(d.isScoped));
    // The maps below replace the ones loadAllModels merged into: load that list again.
    setAllModelList(null);
    allModelsLoadRef.current = null;
    setModelThinkingLevels(d.thinkingLevels ?? {});
    setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
    const nextModelList = d.modelList ?? [];
    setModelList(nextModelList);
    const displayDefaultModel = d.defaultModel
      ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
      : undefined;
    setNewSessionDefaultModel(displayDefaultModel
      ? { provider: displayDefaultModel.provider, modelId: displayDefaultModel.id }
      : null);
    thinkingLevelPinsRef.current = d.thinkingLevelPins ?? {};
    defaultThinkingLevelRef.current = asConcreteThinkingLevel(d.defaultThinkingLevel);
    setSavedDefaultThinkingLevel(asConcreteThinkingLevel(d.savedDefaultThinkingLevel));
    if (isNew && !sessionIdRef.current) {
      // A picked model this folder does not offer (one carried over from the
      // composer this one replaced, or since scoped out) goes back to automatic.
      // An empty list offers nothing to compare with (a failed load answers
      // with one): the pick stays. An active scope does not wipe out an
      // intentionally selected unscoped model.
      const picked = newSessionModelOverrideRef.current;
      const kept = picked && (nextModelList.length === 0
        || Boolean(d.isScoped)
        || nextModelList.some((m) => m.provider === picked.provider && m.id === picked.modelId));
      if (picked && !kept) {
        newSessionModelOverrideRef.current = null;
        setNewSessionModel(null);
      }
      // The first listed model is not necessarily the runtime's automatic choice.
      // An `enabledModels` pattern may pin a thinking level (`anthropic/*:high`).
      // Like pi, apply it to the model a new session starts with.
      const startModel = kept ? picked : displayDefaultModel && { provider: displayDefaultModel.provider, modelId: displayDefaultModel.id };
      const pinned = startModel && d.thinkingLevelPins?.[`${startModel.provider}/${startModel.modelId}`];
      if (thinkingLevelOverrideRef.current === null) {
        setNewSessionDefaultThinkingLevel(
          asConcreteThinkingLevel(pinned) ?? defaultThinkingLevelRef.current,
        );
      }
    }
  }, [isNew, newSessionCwd, session?.cwd]);

  // pi's /model "all" scope: names and reasoning levels of models outside
  // `enabledModels` join the maps, so a picked unscoped model shows them too.
  const loadAllModels = useCallback(() => {
    if (allModelsLoadRef.current) return;
    const load = {};
    allModelsLoadRef.current = load;
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    fetch(`/api/models?scope=all${modelCwd ? `&cwd=${encodeURIComponent(modelCwd)}` : ""}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load models (HTTP ${res.status})`);
        const d = await res.json() as ModelsResponse;
        if (allModelsLoadRef.current !== load) return;
        setModelNames((prev) => ({ ...d.models, ...prev }));
        setModelThinkingLevels((prev) => ({ ...d.thinkingLevels, ...prev }));
        setModelThinkingLevelMaps((prev) => ({ ...d.thinkingLevelMaps, ...prev }));
        setAllModelList(d.modelList ?? []);
      })
      .catch((e) => {
        if (allModelsLoadRef.current !== load) return;
        allModelsLoadRef.current = null;
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      });
  }, [addNotice, newSessionCwd, session?.cwd]);

  useEffect(() => {
    if (!isModelScopeActive || !displayModel || allModelList) return;
    if (modelList.some((m) => m.provider === displayModel.provider && m.id === displayModel.modelId)) return;
    loadAllModels();
  }, [allModelList, displayModel, isModelScopeActive, loadAllModels, modelList]);

  // Picking a model or reasoning level is session-scoped, as in the TUI. The
  // selectors' star is the explicit Ctrl+S equivalent: it saves the global
  // default new sessions start with and also selects it for this chat.
  const saveDefaultPreferences = useCallback(async (
    edit: { provider: string; modelId: string } | { thinkingLevel: ConcreteThinkingLevel },
  ) => {
    const cwd = newSessionCwd ?? session?.cwd;
    const res = await fetch("/api/models/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(cwd ? { cwd } : {}), ...edit }),
    });
    if (res.ok) return;
    let detail = "";
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") detail = body.error;
    } catch {
      // Non-JSON error responses fall back to the HTTP status.
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }, [newSessionCwd, session?.cwd]);

  const reloadModelsQuietly = useCallback(() => {
    // The star already updated the marker; a failed refresh keeps the old list.
    loadModels().catch(() => {});
  }, [loadModels]);

  const handleSetDefaultModel = useCallback(async (provider: string, modelId: string) => {
    try {
      await saveDefaultPreferences({ provider, modelId });
    } catch (e) {
      addNotice({ type: "error", message: `Failed to save default model: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    addNotice({ type: "success", message: `Default model: ${provider}/${modelId}` });
    setNewSessionDefaultModel({ provider, modelId });
    if (displayModel?.provider !== provider || displayModel?.modelId !== modelId) {
      await handleModelChange(provider, modelId);
    }
    reloadModelsQuietly();
  }, [addNotice, displayModel, handleModelChange, reloadModelsQuietly, saveDefaultPreferences]);


  /**
   * Fork this session into a side chat and open its tab: `/side` and the selected-text
   * popover. `prompt` is its first message, `name` what to call it instead of that
   * message's first line. Answers the refusal to show, or null.
   */
  const startSideChat = useCallback(async (prompt: string | null, name?: string): Promise<string | null> => {
    // The route refuses these too; a tab has nowhere to open another tab from.
    const relationKind = opts.session?.relation?.kind;
    if (relationKind === "side" || relationKind === "subagent") return translate(SIDE_REFUSAL_MESSAGES[relationKind]);
    // Unlike the other built-ins, no ensureNewSession(): forking a session
    // that does not exist yet has nothing to inherit.
    const sourceId = sessionIdRef.current;
    if (!sourceId) return translate("sideChat.error.noSession");
    const result = await createSideChat(sourceId, translate, name);
    if ("error" in result) return result.error;
    onSideSession?.(result.session, prompt);
    return null;
  }, [onSideSession, opts.session?.relation?.kind, translate]);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    if (!text.startsWith("/")) return { handled: false };
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };

    const [, commandName, rawArgs = ""] = match;
    const args = rawArgs.trim();
    const sid = sessionIdRef.current ?? await ensureNewSession();
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (!result.action) {
        // A command that opens a panel says nothing: the panel is the answer.
        addNotice({ type: "success", message: result.message ?? "Command completed" });
      }
      return result;
    };

    try {
      switch (commandName) {
        case "compact": {
          if (!sid || isCompacting) return complete({ handled: true, error: "No active session to compact" });
          // Detached on purpose. This must resolve now: runBuiltinCommand holds
          // the composer's fieldset disabled until the command resolves, and the
          // compact POST blocks for the whole compaction, which read as an input
          // box that stopped taking text until the session was switched away and
          // back. The compaction reports itself (Compacting status, Stop
          // compaction, result banner, error), so no completion notice here.
          // A failed compaction gives its instructions back, as the awaited command
          // left them in the composer.
          void handleCompact(args || undefined).then((compacted) => {
            if (!compacted && args) opts.chatInputRef?.current?.prependText(`/compact ${args}`);
          });
          return complete({ handled: true, action: "compact" });
        }

        case "auto-compact": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          // Read the live wrapper (this POST starts it if idle) so the toggle
          // follows settings.json, not the React default of `true`.
          const liveState = await sendAgentCommand<AgentStateResponse>(sid, { type: "get_state" });
          const nextEnabled = !(liveState?.autoCompactionEnabled ?? true);
          await sendAgentCommand(sid, {
            type: "set_auto_compaction",
            enabled: nextEnabled,
          });
          setAutoCompactionEnabled(nextEnabled);
          return complete({
            handled: true,
            message: nextEnabled
              ? "Auto-compaction enabled"
              : "Auto-compaction disabled",
          });
        }

        case "reload": {
          if (!sid) return complete({ handled: true, error: "No active session to reload" });
          await sendAgentCommand(sid, { type: "reload" });
          await Promise.all([
            loadSession(sid, false, true),
            loadTools(sid),
            loadSlashCommands(),
            loadModels(),
          ]);
          return complete({ handled: true, message: "Reloaded session resources" });
        }

        case "name": {
          if (!sid) return complete({ handled: true, error: "No active session to name" });
          if (!args) return complete({ handled: true, error: "Usage: /name <name>" });
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          if (await loadSession(sid)) promoteNewSession();
          return complete({ handled: true, message: `Session renamed to ${args}` });
        }

        case "session": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          // The panel opens on the same reading the top bar renders.
          // refreshStatsRef drives the wrapper's get_session_stats write-back
          // (setSessionStatsOverride), so an extra explicit fetch would be a
          // second reader of the same numbers.
          refreshStatsRef.current?.();
          onSessionStatsPanelOpen?.();
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "mcp": {
          // Only a bare /mcp, and only when pi's built-in MCP extension owns it or
          // nothing does (lib/mcp-command.ts): another extension's /mcp is sent as
          // before, and so is every subcommand, since `/mcp login`, `logout` and
          // `reconnect` act on this session's own connections. Returning before
          // onSend leaves no "/mcp" bubble and no sidebar row for a new chat; a
          // streaming run is not touched.
          if (args || !onOpenSettings) return { handled: false };
          const commands = await slashCommandsForMcp();
          if (!commands || !bareMcpOpensSettings(commands)) return { handled: false };
          onOpenSettings("mcp");
          return complete({ handled: true, action: "openSettings" });
        }

        case "copy": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: "No assistant message to copy" });
          // copyText falls back to execCommand where navigator.clipboard is
          // missing: a page served over plain HTTP from a LAN address.
          await copyText(textToCopy);
          return complete({ handled: true, message: "Copied last assistant message" });
        }

        case "clone": {
          if (!sid) return complete({ handled: true, error: "No active session to clone" });
          if (agentRunningRef.current || bashRunningRef.current) {
            return complete({ handled: true, error: "Cannot clone while the session is running" });
          }
          const result = await sendAgentCommand<{ cancelled?: boolean; byExtension?: boolean; newSessionId?: string }>(sid, {
            type: "clone",
            leafId: activeLeafId,
          });
          // A `session_before_fork` handler said no: as pi's /clone, nothing more is said
          // (the handler tells why, if it wants to).
          if (result?.cancelled && result.byExtension) return { handled: true };
          if (result?.cancelled || !result?.newSessionId) {
            return complete({ handled: true, error: "Cannot clone an empty or unsaved session" });
          }
          const completed = complete({ handled: true, message: "Cloned current session branch" });
          onSessionForked?.(result.newSessionId);
          return completed;
        }

        case "side": {
          const error = await startSideChat(args || null);
          return complete(error ? { handled: true, error } : { handled: true, action: "openSideChat" });
        }

        default:
          return { handled: false };
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    }
  }, [activeLeafId, addNotice, ensureNewSession, handleCompact, isCompacting, loadModels, loadSession, loadSlashCommands, loadTools, promoteNewSession, onOpenSettings, onSessionForked, onSessionStatsPanelOpen, opts.chatInputRef, slashCommandsForMcp, startSideChat]);

  // Let AgentSession.prompt decide atomically whether to queue against the
  // current run or start a new turn if it settled while the request was in
  // flight. Direct steer/followUp calls can strand a message in an idle queue.
  const sendStreamingPrompt = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: ChatDraftImage[],
  ) => {
    const sid = sessionIdRef.current;
    const restore = () => restoreSubmission(message, images, composerDraftKey);
    // A pending history edit must branch when sent, never join the current run.
    if (editEntryId) {
      restore();
      return;
    }
    if (!sid) {
      restore();
      addNotice({ type: "error", message: "No active session for the queued message" });
      return;
    }
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "prompt",
        message,
        streamingBehavior: behavior,
        ...(piImages?.length ? { images: piImages } : {}),
      });
      // 引导/排队：同样对一次账，落盘后就补到列表里。
      setTimeout(() => void reconcileSession(sid, "sent"), 1_000);
    } catch (e) {
      console.error("Failed to submit streaming prompt:", e);
      restore();
      // A transport failure after dispatch is ambiguous: the server may have
      // accepted the queued prompt before the response was lost, so the notice
      // says the send is unconfirmed instead of failed (#1432).
      if (e instanceof AgentCommandError && e.missingCwd) {
        setPromptMissingCwd(e.missingCwd);
        return;
      }
      if (isPromptRejectedError(e)) addNotice({ type: "error", message: e.message });
      else addUnconfirmedSendNotice();
    }
  }, [addNotice, addUnconfirmedSendNotice, composerDraftKey, editEntryId, restoreSubmission, reconcileSession]);

  const handlePromptWithStreamingBehavior = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: ChatDraftImage[],
  ) => {
    // Since pi 1.6 the queue carries an images-only submission too (its text is
    // ""), and pi drops that entry when the delivered message's text matches —
    // so a row is recorded for one as well, or the send would leave no trace.
    setQueuedSubmissions((records) => message.trim() || images?.length
      ? [...records, createQueuedSubmission(message, behavior, images)]
      : records);
    await sendStreamingPrompt(message, behavior, images);
  }, [sendStreamingPrompt]);

  const handleSteer = useCallback(async (message: string, images?: ChatDraftImage[]) => {
    await handlePromptWithStreamingBehavior(message, "steer", images);
  }, [handlePromptWithStreamingBehavior]);

  const handleFollowUp = useCallback(async (message: string, images?: ChatDraftImage[]) => {
    await handlePromptWithStreamingBehavior(message, "followUp", images);
  }, [handlePromptWithStreamingBehavior]);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  // Fresh numbers for the top bar and the stats panel: the agent-state route's
  // snapshot, which carries the SDK's own stats for a live session. Reading it
  // here means one source for both readers, no second command, and no session
  // started just to look at counters.
  const refreshSessionStats = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const payload = await res.json() as { stats?: SessionStatsInfo | null };
      if (sessionIdRef.current !== sid || !payload.stats) return;
      setSessionStatsOverride(payload.stats);
      if (payload.stats.contextUsage) setContextUsage(payload.stats.contextUsage);
    } catch (e) {
      console.error("Failed to refresh session stats:", e);
    }
  }, []);
  refreshStatsRef.current = refreshSessionStats;

  // Both readers — the top bar and the stats panel — render this snapshot, so
  // the numbers move while the run does instead of waiting for the next turn or
  // for the panel to be opened. Turns that settle between polls are covered by
  // the prompt events, plus this tail, because the wrapper writes its last
  // usage entry just after the run ends.
  const statsWasRunningRef = useRef(false);
  useEffect(() => {
    refreshStatsRef.current?.();
    const wasRunning = statsWasRunningRef.current;
    statsWasRunningRef.current = agentRunning;
    if (agentRunning) {
      const timer = setInterval(() => {
        // 后台标签页不轮询（子代理面板的 stats 轮询早有此守卫）；回到前台时
        // 下一个 tick 或 agent_settled 的读数补上。
        if (document.visibilityState === "visible") refreshStatsRef.current?.();
      }, 3_000);
      return () => clearInterval(timer);
    }
    if (!wasRunning) return;
    const timers = [1_500, 5_000, 12_000].map((delay) => setTimeout(() => refreshStatsRef.current?.(), delay));
    return () => timers.forEach(clearTimeout);
  }, [agentRunning, session?.id]);

  const handleQueuedAction = useCallback(async (id: string, action: "toggle" | "edit" | "moveUp" | "moveDown" | "delete") => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const records = queuedSubmissionsRef.current;
    const target = records.find((record) => record.id === id);
    if (!target) return;
    let cleared: QueuedMessages;
    try {
      cleared = normalizeQueuedMessages(
        await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" }),
      );
    } catch (e) {
      console.error("Failed to take a queued message:", e);
      addNotice({ type: "error", message: "Failed to take the queued message" });
      return;
    }
    // clear_queue also emits an empty queue_update, but that only reaches us
    // while SSE is connected — update the rows locally, and synchronously, so a
    // second click cannot act on the queue this one just replaced. pi's lists
    // are authoritative: entries consumed mid-run must not be resurrected, so
    // the rebuild starts from `cleared`, not from the local records.
    // 取回编辑与删除均将目标从待发列表中移除：前者内容回到输入框，后者直接丢弃。
    const remaining = splitClearedQueue(cleared, records, action === "edit" || action === "delete" ? id : undefined);
    const toggledBehavior: QueuedBehavior = target.behavior === "steer" ? "followUp" : "steer";
    let nextRecords = remaining.map((item) => createQueuedSubmission(
      item.text,
      action === "toggle" && item.text === target.text && item.behavior === target.behavior
        ? toggledBehavior
        : item.behavior,
      item.images,
    ));
    if (action === "moveUp" || action === "moveDown") {
      nextRecords = moveQueuedEntry(nextRecords, target.behavior, target.text, action === "moveUp" ? "up" : "down") ?? nextRecords;
    }
    queuedSubmissionsRef.current = nextRecords;
    setQueuedSubmissions(nextRecords);
    // The rows just replaced the queue pi had, and no snapshot confirms that
    // until the re-sends land: a stale one must not resurrect the taken entry.
    // The gate bump marks this rebuild as a queue change, cutting every
    // state read issued before the clear.
    queueSnapshotGateRef.current.observe();
    const snapshot: QueuedMessages = { steering: [], followUp: [] };
    for (const record of nextRecords) {
      (record.behavior === "steer" ? snapshot.steering : snapshot.followUp).push(record.text);
    }
    lastQueueSnapshotRef.current = snapshot;
    if (action === "edit") {
      opts.chatInputRef?.current?.prependQueuedMessage(target.text, target.images);
    }
    for (const item of nextRecords) {
      await sendStreamingPrompt(item.text, item.behavior, item.images);
    }
  }, [addNotice, opts.chatInputRef, sendStreamingPrompt]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    if (level === "auto") {
      thinkingLevelOverrideRef.current = null;
      setNewSessionThinkingLevel(null);
      setCurrentThinkingOverride(null);
      return;
    }
    if (isNew) {
      thinkingLevelOverrideRef.current = level;
      setNewSessionThinkingLevel(level);
    } else {
      setCurrentThinkingOverride(level);
    }
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
      if (sessionHookMountedRef.current && sessionIdRef.current === sid) {
        setLiveThinkingLevel(level);
        setCurrentThinkingOverride(null);
      }
    } catch (e) {
      console.error("Failed to set thinking level:", e);
      setCurrentThinkingOverride(null);
    }
  }, [isNew]);

  const handleSetDefaultThinkingLevel = useCallback(async (level: ConcreteThinkingLevel) => {
    try {
      await saveDefaultPreferences({ thinkingLevel: level });
    } catch (e) {
      addNotice({ type: "error", message: `Failed to save default reasoning level: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    addNotice({ type: "success", message: `Default reasoning level: ${level}` });
    setSavedDefaultThinkingLevel(level);
    if (displayThinkingLevel !== level) await handleThinkingLevelChange(level);
    reloadModelsQuietly();
  }, [addNotice, displayThinkingLevel, handleThinkingLevelChange, reloadModelsQuietly, saveDefaultPreferences]);

  const handleToolPresetChange = useCallback(async (preset: ToolPreset) => {
    const toolNames = getToolNamesForPreset(preset);
    setPreferredToolPreset(preset);
    setToolPresetState(preset);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) {
      sessionToolsPinnedRef.current = toolNames !== undefined;
      return;
    }
    try {
      // Omitting toolNames retracts the session's pin so it follows the configured
      // defaults again; the server rebuilds the session to resolve them.
      const result = await sendAgentCommand<{ sessionId?: string; recreated?: boolean }>(sid, {
        type: "set_tools",
        ...(toolNames !== undefined ? { toolNames } : {}),
      });
      sessionToolsPinnedRef.current = toolNames !== undefined;
      const activeSessionId = result?.sessionId ?? sid;
      if (activeSessionId !== sid || result?.recreated) {
        cancelEventStreamGrace();
        closeEvents("set_tools");
        // The old wrapper cancels its pending extension UI only after its stream has
        // closed, so those close events never arrive; drop the requests here instead
        // of leaving them queued in front of the new wrapper's.
        setExtensionDialogs([]);
        setExtensionCustomUis([]);
        sessionIdRef.current = activeSessionId;
        if (result?.recreated && sessionPropIdRef.current === activeSessionId) {
          maintainEventsConnected(activeSessionId);
        }
      }
      clearSlashCommands();
      extensionUiGateRef.current.observe();
      setExtensionStatuses([]);
      setExtensionWidgets([]);
      const [state] = await Promise.all([
        sendAgentCommand<AgentStateResponse>(activeSessionId, { type: "get_state" }),
        loadTools(activeSessionId),
      ]);
      if (sessionHookMountedRef.current && sessionIdRef.current === activeSessionId) {
        setSystemPrompt(state.systemPrompt ?? "");
        syncLiveModel(state);
      }
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, [cancelEventStreamGrace, clearSlashCommands, closeEvents, loadTools, maintainEventsConnected, setToolPresetState, syncLiveModel]);

  // What a session read with its state (`loadSession(…, includeState)`) says is
  // under way on the server: a run or command, a `!` command, a compaction. The
  // mount and a hidden page's return show it the same way.
  const applyLoadedAgentState = useCallback((sid: string, loadedAgentState: unknown) => {
    const agentState = loadedAgentState as { running: boolean; state?: AgentStateResponse } | null;
    if (agentState?.running) {
      loadTools(sid);
      if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
        sdkAgentActiveRef.current = Boolean(agentState.state.isStreaming);
        rpcPromptPendingRef.current = Boolean(agentState.state.isPromptRunning);
        agentRunningRef.current = true;
        setAgentRunning(true);
        agentPhaseStore.set((prev) => runStatePhase(prev, agentState.state?.isStreaming === true));
        dispatch({ type: "resume" });
        if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
          void waitForPromptSettlement(sid);
        }
      }
      if (agentState.state?.isBashRunning) {
        bashRunningRef.current = true;
        setBashRunning(true);
        void waitForBashSettlement(sid);
      }
    }
    if (agentState?.state) {
      if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
      if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
      // 状态与 widget 不在这里再上：loadSession 的状态读已经写过一次（带闸门），
      // 这里重写相当于拿更旧的快照盖上刚到的 setStatus / setWidget。
      // 队列同理，在 loadSession 里过闸。
    }
  }, [agentPhaseStore, dispatch, loadTools, waitForBashSettlement, waitForPromptSettlement]);

  // Open a released stream again and read what it missed (a run another tab, a
  // device or an extension started or finished, statuses), shown as the mount
  // shows it. `connected` resumes a streaming run and replays pending extension
  // dialogs, so their completion and attention notifications reach the page as
  // if it had never let go. Nothing is resent.
  reattachEventStreamRef.current = (sid: string, reason: "visible" | "activity") => {
    if (endedSessionRef.current === sid) return;
    // “释放过”不等于“流真的死了”：iOS 把页面放进后台时常常直接干掉 SSE 连接，
    // 而页面自己并没有发起释放（idle 判断被扩展对话框、compaction 等拦着），
    // eventStreamReleasedRef 于是仍为 false。只看这个标记会让回页什么都不做，
    // 后台期间落盘的条目就再也没有通路补入。
    // 所以连接确实活着（connected）且没释放过才跳过；其它状态一律重连+补读。
    const connected = eventConnectionRef.current?.snapshot().state === "connected";
    if (!eventStreamReleasedRef.current && connected) return;
    eventStreamReleasedRef.current = false;
    reattachDebugRef.current = { count: reattachDebugRef.current.count + 1, lastAt: Date.now(), lastReason: reason };
    setEventStreamReattachCount((count) => count + 1);
    if (!sessionHookMountedRef.current || sessionIdRef.current !== sid || sessionPropIdRef.current !== sid) return;
    maintainEventsConnected(sid);
    void loadSession(sid, false, true).then((loadedAgentState) => {
      if (!sessionHookMountedRef.current || sessionIdRef.current !== sid) return;
      applyLoadedAgentState(sid, loadedAgentState);
    });
  };

  // The page keeps its selected session alive with a lease renewal every
  // SESSION_LEASE_RENEW_INTERVAL_MS, each one resetting the session's idle
  // countdown, whether or not it holds the event stream: a hidden page lets go
  // of the stream (#1283), not of the session, so the idle wrapper and an
  // extension's timer in it live on. A released page
  // reads each reply and opens the stream again as soon as something is under
  // way (sessionLeaseShowsActivity()); one that comes back opens it at once. A
  // dead stream is the connection's heartbeat watchdog's to notice.
  useEffect(() => {
    const sid = session?.id;
    if (!sid) return;
    let disposed = false;
    const leaseDebug = leaseDebugRef.current;
    const renew = async () => {
      const reply = await requestLease(sid);
      if (disposed || document.visibilityState !== "hidden") return;
      if (sessionLeaseShowsActivity(reply)) reattachEventStreamRef.current(sid, "activity");
    };
    void renew();
    const interval = setInterval(() => void renew(), SESSION_LEASE_RENEW_INTERVAL_MS);
    leaseDebug.renewStartedAt = Date.now();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      reattachEventStreamRef.current(sid, "visible");
      // A frozen background page renewed nothing; coming back renews at once.
      void renew();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      clearInterval(interval);
      leaseDebug.renewStartedAt = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [requestLease, session?.id]);

  // Load session on mount
  // Dormancy: a keep-alive slot hidden beyond DORMANT_AFTER_MS unloads its
  useEffect(() => {
    sessionHookMountedRef.current = true;
    // Usage reads started before a remount are stale.
    contextUsageAppliedIdRef.current = contextUsageRequestIdRef.current;
    if (session) {
      sessionIdRef.current = session.id;
      // Snapshot fast path: show the cached history window immediately, then
      // run the normal forced read in the background as the freshness check.
      const cached = restoreCachedView(session.id);
      loadSession(session.id, !cached, true, { force: true }).then((loadedAgentState) => {
        applyLoadedAgentState(session.id, loadedAgentState);
      });
    }
    return () => {
      sessionHookMountedRef.current = false;
      const abandonedDraftKey = isNew ? newSessionDraftKey : null;
      if (abandonedDraftKey) {
        queueMicrotask(() => {
          if (!sessionHookMountedRef.current && !newSessionPromotedRef.current) {
            clearDraft(abandonedDraftKey);
          }
        });
      }
      // Persist the settled view of the outgoing session so switching back can
      // restore it instantly. Only when the cached window still covers every
      // entry the UI has loaded (paged-in history included).
      const sid = sessionIdRef.current;
      const currentData = dataRef.current;
      if (sid && currentData && currentData.sessionId === sid && currentData.snapshotRevision) {
        const existing = getSessionViewSnapshot(sid);
        const entryIds = entryIdsRef.current;
        const coverable = !existing || snapshotCoversLoadedEntries(existing, entryIds);
        if (coverable) {
          setSessionViewSnapshot({
            sessionId: sid,
            revision: currentData.snapshotRevision,
            messages: messagesRef.current,
            entryIds: entryIdsRef.current,
            leafId: activeLeafIdRef.current,
            oldestEntryId: historyCursorRef.current,
            hasMore: hasEarlierMessagesRef.current,
            turnsBefore: earlierTurnCountRef.current,
            summaryTree: currentData.tree,
            thinkingLevel: currentData.context.thinkingLevel,
            model: currentData.context.model,
            stats: currentData.stats,
            totalActiveMs: currentData.totalActiveMs,
            loadedEntryIds: entryIdsRef.current,
          });
        } else {
          deleteSessionViewSnapshot(sid);
        }
      }
      // After the snapshot above, so the bubble of a send given back leaves it.
      releaseUnconfirmedSendRef.current();
      bashRecoveryIdRef.current += 1;
      cancelEventStreamGrace();
      closeEvents();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (background) return;
    onSystemPromptChange?.(systemPrompt);
  }, [background, systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (background) return;
    onSystemInfoLoaderChange?.(loadSystemInfo);
    return () => onSystemInfoLoaderChange?.(null);
  }, [background, loadSystemInfo, onSystemInfoLoaderChange]);

  // The debug panel's view of this page's stream and lease, read on its own
  // clock. Refs and plain copies only: it requests, opens, arms and renders nothing.
  const readDebugSnapshot = useCallback((): DebugClientSession => {
    let connection: DebugEventConnectionSnapshot | null = null;
    try {
      // A connection built before a hot reload may lack snapshot().
      connection = eventConnectionRef.current?.snapshot?.() ?? null;
    } catch {
      connection = null;
    }
    const sid = sessionIdRef.current;
    const lease = leaseDebugRef.current;
    const reattached = reattachDebugRef.current;
    return {
      pageId: peekPageId(),
      sessionId: sid,
      selectedSessionId: sessionPropIdRef.current,
      mounted: sessionHookMountedRef.current,
      wantsStream: sid !== null && wantsEventStream(sid),
      connection,
      released: { active: eventStreamReleasedRef.current, ...releaseDebugRef.current },
      reattached: { ...reattached },
      hiddenReleaseDueAt: hiddenReleaseDueAtRef.current,
      hiddenGraceMs: HIDDEN_PAGE_GRACE_MS,
      graceDueAt: eventStreamGraceDueAtRef.current,
      run: {
        agentRunning: agentRunningRef.current,
        bashRunning: bashRunningRef.current,
        compacting: isCompactingRef.current,
        dialogs: extensionUiCountRef.current,
      },
      lease: {
        renewIntervalMs: SESSION_LEASE_RENEW_INTERVAL_MS,
        renewStartedAt: lease.renewStartedAt,
        inFlightSince: lease.inFlightSince,
        requests: lease.requests,
        unanswered: lease.unanswered,
        errors: lease.errors,
        last: lease.last && { ...lease.last, reply: lease.last.reply && { ...lease.last.reply } },
      },
    };
  }, [wantsEventStream]);

  useEffect(() => {
    onDebugSnapshotReaderChange?.(readDebugSnapshot);
    return () => onDebugSnapshotReaderChange?.(null);
  }, [readDebugSnapshot, onDebugSnapshotReaderChange]);

  // 手动重载（顶栏菜单）：重新挂载当前会话——基线清零后走挂载路径（首屏 3 轮），
  // 事件流不断开。文件静止时 revision 保留分支会把刚清空的 messages 当「已载入」
  // 保留，故先丢弃视图快照，强制走服务端窗口替换。活跃会话的自动读盘已移除，
  // 这是断流期落盘条目的唯一补读入口。
  const reloadSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    entryIdsRef.current = [];
    setEntryIds([]);
    setMessages([]);
    browsingHistoryRef.current = false;
    pendingWindowMessagesRef.current = [];
    setNewestCursor(null);
    setHasNewerMessages(false);
    setHeadTurn(null);
    deleteSessionViewSnapshot(sid);
    await loadSession(sid, true, true, { force: true });
  }, [loadSession]);

  useEffect(() => {
    onReloadSessionChange?.(reloadSession);
    return () => onReloadSessionChange?.(null);
  }, [reloadSession, onReloadSessionChange]);

  const branchSwitchLocked = agentRunning || bashRunning || isCompacting;
  useEffect(() => {
    if (!onBranchDataChange || background) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange, branchSwitchLocked);
  }, [background, data?.tree, activeLeafId, handleLeafChange, branchSwitchLocked, onBranchDataChange]);

  // Load the model list with bounded retries; loadModels exposes each failure.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await loadModels(controller.signal);
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          if (e instanceof DOMException && e.name === "AbortError") return;
          if (attempt >= MODELS_RETRY_DELAYS_MS.length) return;
          await delay(MODELS_RETRY_DELAYS_MS[attempt]);
          if (controller.signal.aborted) return;
        }
      }
    })();
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  // 悬停暂停、自动消失、堆叠展开均为 sonner 内置；旧通知架的暂停与退出
  // 状态机已随 NoticeShelf 一并删除。
  useEffect(() => {
    setSessionStatsOverride(null);
  }, [session?.id]);

  const thinkingLevel: ThinkingLevelOption = displayThinkingLevel ?? "auto";
  // The head of each queue is on screen; the rest wait behind it.
  const extensionDialog = extensionDialogs[0] ?? null;
  const extensionDialogQueue = extensionDialogs.slice(1);
  const waitingExtensionDialogCount = extensionDialogQueue.length;
  const extensionCustomUi = extensionCustomUis[0] ?? null;
  const waitingExtensionCustomUiCount = Math.max(0, extensionCustomUis.length - 1);
  const messageKeys = useMemo(
    () => messageRenderKeys(entryIds, messages.length, messageKeyAliases),
    [entryIds, messages.length, messageKeyAliases],
  );

  return {
    // State
    data, loading, error, activeLeafId, messages, activeToolsStore, entryIds, messageKeys, historyCursor, hasEarlierMessages, earlierTurnCount, newestCursor, hasNewerMessages, headTurn, streamingStore,
    agentRunning, modelNames, modelList, modelError, missingCwd, modelScopeWarnings, isModelScopeActive, allModelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage: displayContextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, modelSwitching, sessionStats, autoCompactionEnabled,
    slashCommands, slashCommandsLoading, queuedSubmissions,
    extensionDialog, extensionDialogQueue, waitingExtensionDialogCount, extensionCustomUi, waitingExtensionCustomUiCount, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput, addNotice,
    isAutoModelSelection: isNew && newSessionModel === null,
    isAutoThinkingSelection: isNew && newSessionThinkingLevel === null,    defaultModel: newSessionDefaultModel,
    savedDefaultThinkingLevel,
    agentPhaseStore,
    isNew,
    editEntryId,
    // Refs
    sessionIdRef, scrollContainerRef,
    // Actions
    handleSend, handleAbort, startSideChat, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleQueuedAction, refreshSessionStats,
    reloadSession,
    dismissCompactError,
    handleBuiltinSlashCommand,
    handleEditContent,
    // Present only while a history edit is pending.
    cancelEdit: editEntryId ? cancelEdit : undefined,
    handleToolPresetChange, handleThinkingLevelChange, handleSetDefaultModel, handleSetDefaultThinkingLevel, loadTools, loadSlashCommands, loadAllModels, setActiveLeafId, setData, setMessages, loadContext,
    jumpToEntry, loadNewerPage,
    dispatch, setAgentRunning, setForkingEntryId,
    bashRunning, pendingBash,
    // Subscriptions
    handleAgentEventRef,
  };
}
