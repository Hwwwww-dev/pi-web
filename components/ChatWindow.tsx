"use client";

import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { isHiddenRelation } from "@/lib/session-family";
import { ArrowDownIcon, GitForkIcon, MessagesSquareIcon, QuoteIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentMessage, AssistantMessage, BashExecutionMessage, BlockingExtensionUiRequest, ExtensionStatusItem, ExtensionWidgetItem, MinimapTurnDescriptor, SessionInfo, SessionTreeNode, TextContent, ToolResultMessage, UserMessage } from "@/lib/types";
import type { StreamingStore } from "@/lib/streaming-message";
import { isHiddenCustomMessage, isMessageGroupAnchor, liveOutputPreview, liveOutputPreviewLines, splitFinalAssistantBlocks } from "@/lib/message-display";
import { buildTurnActivityItems, getFinishedTurnView, headSegmentEndsTurn, splitTurnParts, summarizeSegmentActivity, type ActivityItem } from "@/lib/turn-view";
import { SafeMarkdownBody } from "./SafeMarkdownBody";
import { type WrittenFile } from "@/lib/turn-written-files";
import { buildQuotedSelection } from "@/lib/quoted-selection";
import { dropMentionText, splitDroppedItems, uploadFiles, uploadRepoDirectory, type DroppedItem } from "@/lib/file-upload-client";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { getFileName } from "@/lib/file-paths";
import type { InspirationFileRef } from "@/lib/inspiration-shared";
import { MessageView, formatTime, getModelDisplayName } from "./MessageView";
import { ActiveToolsContext, TurnActivityBody, TurnMetaLine } from "./ActivityRows";
import dynamic from "next/dynamic";
import { ActivityNoticeLine, ChatInput, getUserMessageDraftImages, getUserMessageText, type ChatInputHandle } from "./ChatInput";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { ChatMinimap, useMessageRefs, MINIMAP_MIN_PANE_WIDTH } from "./ChatMinimap";
import { TurnTrace } from "./transcript/TurnTrace";
import { LiveTurnTrace } from "./transcript/LiveTurnTrace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility } from "@/components/ui/message-scroller";
import { ChatRow } from "@/components/chat/ChatRow";
import { computeRowWindow, sameRowWindow, type RowRect } from "@/lib/chat-row-window";
import { CHAT_COLUMN_CLASS, CHAT_PAGE_GUTTER_CLASS } from "@/lib/chat-layout";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import { formatTurnDuration } from "@/lib/turn-duration";
import { useAgentSession, type AgentEndInfo, type NewSessionChoices } from "@/hooks/useAgentSession";
import { selectHasStreamingContent, selectIsStreaming, selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import { useDelayedUnmount } from "@/hooks/useDelayedUnmount";
import { publishStreamCharacters } from "@/lib/stream-beam";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { DebugClientSession } from "@/lib/debug-types";
import type { ToolEntry } from "@/lib/tool-presets";
import type { SettingsSection } from "@/lib/settings-navigation";
import { streamingMessageKey } from "@/lib/message-keys";
import { claimDoneChime, DONE_CHIME_SAME_EVENT_MS } from "@/lib/done-chime";
import { useAdvancedSettings } from "@/hooks/useAdvancedSettings";
import { advancedValue } from "@/lib/advanced-values";
import { CheckpointRow } from "./CheckpointRow";
import { ExtensionCustomPanel, ExtensionDialog, type ExtensionDialogRequest } from "./chat/ExtensionDialogs";


/** 判定贴顶的容差：触摸惯性下滚动值带小数，难以精确归零。 */
const TOP_SLACK = 24;
/**
 * 官方贴底距离的默认值：离内容末端多少 px 内算贴底，也是 `autoScroll` 的吸附范围。
 *
 * 必须**不含**输入框垫底（`dockHeight`）：官方 `be()` 的第一分支是
 * `autoScroll && !end → mode = "following-bottom"`，所以只要落在“离末端 < 阈值”
 * 里，任何一次内容增长都会把视口拉回末端。以前传的是 `48 + 垫底`（垫底 100pt+），
 * 读者停在“最后一条贴着卡片上沿”的位置时，距机械末端仍差一整段垫底，因此会
 * 落入吸附带内，上滑十余像素即被拉回，重复表现为持续抖动。
 *
 * 取值 16px 实测合适，可在 Settings › 高级参数修改。
 */
const SCROLL_EDGE_THRESHOLD_DEFAULT = 16;
/**
 * Content 末端在输入条之上多留的缝，与 `pb-[calc(var(--composer-dock-h,0px)+8px)]` 里的 8 同值。
 * 官方把阀值加到这个垫底上，所以上滚 `k` px 时判据值 = `k`；而「末行底边碰到输入条上沿」
 * 那一刻是 `k = 8`（贴底位置末行还在上沿之上 8px）。减掉它，吸附带才从输入条上沿量起。
 */
const CONTENT_PAD_END_PX = 8;

const InspirationDialog = dynamic(() => import("./InspirationDialog").then((mod) => mod.InspirationDialog), { ssr: false });

interface Props {
  session: SessionInfo | null;
  searchTarget?: { sessionId: string; entryId: string; blockIndex?: number } | null;
  onSearchTargetHandled?: (target: { sessionId: string; entryId: string }) => void;
  /**
   * 该实例是否为当前可见会话。保活 dock 以 `display:none` 隐藏非当前槽位，隐藏会使
   * `scrollTop`/`scrollHeight` 归零；切回时须先还原位置，顶部加载器才不会把 0 视为贴顶。
   */
  active?: boolean;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  /** Shown above the composer while a fresh composer is still empty: where its session starts. */
  newSessionContextBar?: ReactNode;
  /** A fresh composer's model and reasoning picks, carried from the composer it replaces. */
  initialNewSessionChoices?: NewSessionChoices | null;
  onNewSessionChoicesChange?: (choices: NewSessionChoices) => void;
  onAgentEnd?: (end: AgentEndInfo) => void;
  onSessionEnded?: (sessionId: string) => void;
  onToolEnd?: (toolName: string) => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest, ownerSessionId?: string | null) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  /** A subagent's or side chat's tab beside the main chat: the page's global shortcuts stay with the main chat. */
  panel?: boolean;
  /** `/side`: a side chat was forked from this session; open its tab. */
  onSideSession?: (session: SessionInfo, prompt: string | null) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void, locked: boolean) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemToolsChange?: (tools: ToolEntry[] | null) => void;
  onMcpServersChange?: (summary: { total: number; ready: number; needsAuth: number } | null) => void;
  onSystemInfoLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  /** Keep-alive background slot: skip AppShell-wide state reporting so background instances cannot overwrite the visible session's state. */
  background?: boolean;
  /** Dormant keep-alive slot: this slot's message list was unloaded; the hook reloads it when the slot is shown again. */
  dormant?: boolean;
  /** Registers the debug panel's read-only reader of this chat's stream and lease. */
  onDebugSnapshotReaderChange?: (reader: (() => DebugClientSession) | null) => void;
  /** Registers the manual reload action (topbar ⋯ menu): re-mounts the current session's 3-turn window. */
  onReloadSessionChange?: (fn: (() => void) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  /** Opens Settings on a section: a bare `/mcp` that pi's built-in MCP extension owns opens Settings › MCP. */
  onOpenSettings?: (section: SettingsSection) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  onAskInNewChat?: (prompt: string, sourceSessionId: string, sourceEntryId: string) => Promise<void>;
  quoteSelectionEnabled?: boolean;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
  /** Keeps the completion sound's audio running until the returned release is called. */
  holdAudio?: () => () => void;
}

// 消息列的留白、宽度、字号、行距统一由 `lib/chat-layout.ts` 定义（数值见
// `app/globals.css` 的 `--chat-*` 变量），组件内不写字面量。

/**
 * 官方 scroller 的命令面。ChatWindow 渲染 Provider，自己就处于 Provider 之外，
 * 拿不到 `useMessageScroller`；这个空节点在 Provider 里把命令和贴底信号引出来。
 * 所有程序化滚动都走它——官方据此进入 `settling-jump` 并抑制跟随，自己写
 * scrollTop 会和跟随抢同一个帧。
 */
type ScrollerApi = {
  scrollToEnd: (options?: { behavior?: ScrollBehavior }) => boolean;
  scrollToMessage: (messageId: string, options?: {
    align?: "start" | "center" | "end" | "nearest";
    behavior?: ScrollBehavior;
    scrollMargin?: number;
  }) => boolean;
};

function ScrollerBridge({ apiRef, onAtTailChange, onVisibleEntryChange }: {
  apiRef: React.MutableRefObject<ScrollerApi | null>;
  onAtTailChange: (atTail: boolean) => void;
  onVisibleEntryChange: (entryId: string | null) => void;
}) {
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  const scrollable = useMessageScrollerScrollable();
  // 官方的可视性状态：位置记忆只认它给的“视口里最上面那条消息”。
  const { visibleMessageIds } = useMessageScrollerVisibility();
  apiRef.current = { scrollToEnd, scrollToMessage };
  useEffect(() => {
    onAtTailChange(!scrollable.end);
  }, [scrollable.end, onAtTailChange]);
  useEffect(() => {
    onVisibleEntryChange(visibleMessageIds[0] ?? null);
  }, [visibleMessageIds, onVisibleEntryChange]);
  return null;
}

/**
 * 流式回复气泡：唯一随 chunk 重渲染的组件。消息本体从 StreamingStore 订阅，
 * ChatWindow 只订阅 isStreaming/hasStreamingContent 两个布尔——chunk 不再
 * 触发整容器重渲染（文档一直声称的容器级隔离，此处落地）。
 */
function StreamingReply({ store, messageKey, toolResults, modelNames, cwd, onOpenFile, onOpenSubagent }: {
  store: StreamingStore;
  /** 落进列表后将携带的键：思考行的折叠选择与实测时长靠它活过重挂载。 */
  messageKey: string;
  toolResults: Map<string, ToolResultMessage>;
  modelNames: React.ComponentProps<typeof MessageView>["modelNames"];
  cwd: React.ComponentProps<typeof MessageView>["cwd"];
  onOpenFile: React.ComponentProps<typeof MessageView>["onOpenFile"];
  onOpenSubagent: React.ComponentProps<typeof MessageView>["onOpenSubagent"];
}) {
  const streamingMessage = useStreamingSelector(store, selectStreamingMessage);
  // 活跃回合的思考与工具由折叠行承担（LiveTurnTrace）：气泡只画正在写的文本。
  // 否则每个工具都会先在气泡里平铺、message_end 后再“收进去”，视觉上折叠两次；
  // 思考同理。纯工具/思考流式帧没有文本，不出气泡。
  const textMessage = streamingMessage
    ? { ...streamingMessage, content: streamingMessage.content.filter((block) => block.type === "text") }
    : null;
  if (!textMessage || textMessage.content.length === 0) return null;
  return (
    // 回复气泡入场：淡入 + 轻微上移，每轮运行挂载时播一次。
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
      <MessageView
        message={textMessage as AgentMessage}
        toolResults={toolResults}
        isStreaming
        messageKey={messageKey}
        modelNames={modelNames}
        cwd={cwd}
        onOpenFile={onOpenFile}
        onOpenSubagent={onOpenSubagent}
      />
    </div>
  );
}

/**
 * 扩展状态条的进出场：出现上滑淡入，消失时停在最后一次非空内容上下滑淡出
 * （useDelayedUnmount），不再是整条瞬现瞬失。出场要拿旧内容渲染——状态条本体
 * 对空 statuses 返回 null，直接条件渲染拿不到出场帧。
 */
function AnimatedExtensionStatusBar({ statuses, widgets, onCommand, commandsDisabled }: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  onCommand?: (command: string) => void;
  commandsDisabled?: boolean;
}) {
  const open = statuses.length > 0 || (widgets?.length ?? 0) > 0;
  const mounted = useDelayedUnmount(open, 150);
  const lastContentRef = useRef({ statuses, widgets, onCommand, commandsDisabled });
  if (open) lastContentRef.current = { statuses, widgets, onCommand, commandsDisabled };
  // 空态同样占一行：状态行出现或消失若改变停靠区高度，上方输入框会整体上下
  // 跳动一行。24px 与 `size="xs"` 状态胶囊同高。
  if (!mounted) return <div aria-hidden="true" className="h-6 w-full shrink-0" />;
  const shown = open ? { statuses, widgets, onCommand, commandsDisabled } : lastContentRef.current;
  return (
    // 停靠区为 flex-col：这一层 w-full 复原状态条本体的 stretch 铺满。
    <div
      className={`flex w-full shrink-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${open ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`}
    >
      <ExtensionStatusBar
        statuses={shown.statuses}
        widgets={shown.widgets}
        onCommand={shown.onCommand}
        commandsDisabled={shown.commandsDisabled}
      />
    </div>
  );
}

/**
 * 输入框边光的字符数发布者：订阅 store 自行发布，chunk 只重渲染这一个小节点。
 * 后台会话不写：计数器按会话隔离，它的字符数也只属于它自己。
 */
function StreamBeamPublisher({ store, channel, background }: {
  store: StreamingStore;
  channel: string;
  background: boolean;
}) {
  const streamingMessage = useStreamingSelector(store, selectStreamingMessage);
  useEffect(() => {
    if (background) return;
    let total = 0;
    for (const block of streamingMessage?.content ?? []) {
      if (block.type === "text") total += block.text.length;
      else if (block.type === "thinking") total += block.thinking.length;
    }
    publishStreamCharacters(channel, total);
  }, [streamingMessage, channel, background]);
  return null;
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

// 段摘要（结算段与活跃回合的已完成段共用）：数字口径见 lib/turn-view.ts 的
// summarizeSegmentActivity，这里只负责拼 i18n；空摘要兜底思考标签。
function segmentSummaryText(items: ActivityItem[], t: ReturnType<typeof useI18n>["t"]): string {
  const { counts, failed, firstTs, lastTs, durationMs } = summarizeSegmentActivity(items);
  const workedFor = firstTs !== undefined && lastTs !== undefined && lastTs > firstTs
    ? formatTurnDuration(lastTs - firstTs)
    : durationMs > 0 ? formatTurnDuration(durationMs) : undefined;
  const parts: string[] = [];
  if (workedFor) parts.push(t("chat.activity.workedFor", { duration: workedFor }));
  for (const [count, labelKey] of [
    [counts.read, "chat.toolCategory.view"],
    [counts.edit, "chat.toolCategory.edit"],
    [counts.run, "chat.trace.ranLabel"],
    [counts.subagent, "chat.toolCategory.subagent"],
  ] as const) {
    if (count > 0) parts.push(t("chat.activity.categoryCount", { count, label: t(labelKey) }));
  }
  if (failed > 0) parts.push(t("chat.activity.failedCount", { count: failed }));
  return parts.length > 0 ? parts.join(" · ") : t("i18n.thinking");
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}


// memo：后台 dock 常驻渲染，非流式内容变更不应触发重渲染
export const ChatWindow = memo(function ChatWindow({ session, searchTarget, onSearchTargetHandled, active = true, sessionRunning, newSessionCwd, newSessionDraftKey, newSessionContextBar, initialNewSessionChoices, onNewSessionChoicesChange, onAgentEnd, onSessionEnded, onToolEnd, onAttentionNeeded, onSessionCreated, onSessionForked, panel = false, onSideSession, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onMcpServersChange, onSystemInfoLoaderChange, onDebugSnapshotReaderChange, onReloadSessionChange, background = false, dormant = false, onSessionStatsChange, onSessionStatsPanelOpen, onOpenSettings, onContextUsageChange, onOpenFile, onOpenSubagent, onAskInNewChat, quoteSelectionEnabled = false, initialPrompt, onInitialPromptConsumed, soundEnabled = true, playDoneSound = () => {}, unlockAudio, holdAudio }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  // 滚动与显示参数来自 Settings › 高级参数；整页订阅，改完立刻重建 Provider。
  const advancedValues = useAdvancedSettings();
  const completionNotificationsEnabled = !isHiddenRelation(session?.relation);

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  /**
   * 最近一条助手回复，用来判断这轮是不是以错误收尾（`stopReason: "error"` 或
   * `errorMessage`）。`wrappedOnAgentEnd` 声明在 `useAgentSession` 之前，只能走 ref。
   */
  const lastAssistantRef = useRef<AssistantMessage | null>(null);
  const wrappedOnAgentEnd = useCallback((end: AgentEndInfo) => {
    // A run someone stopped did not finish anything, and one whose subagents still work did not finish the task.
    if (completionNotificationsEnabled && soundEnabledRef.current && !end.aborted && !end.subagentsActive) {
      // Another page showing this session got the same agent_end (#1688).
      const sid = sessionIdRef.current ?? session?.id;
      if (!sid || claimDoneChime([sid], Date.now() - DONE_CHIME_SAME_EVENT_MS)) playDoneSoundRef.current();
    }
    const last = lastAssistantRef.current;
    const failed = Boolean(last && (last.stopReason === "error" || last.errorMessage || last.stopReason === "aborted"));
    onAgentEnd?.(failed ? { ...end, failed } : end);
  // sessionIdRef is useAgentSession's ref, declared below: a dependency would read it before then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionNotificationsEnabled, onAgentEnd, session?.id]);

  // 发送后回底、钉顶跟随、位置还原全部交给官方 scroller。

  const {
    loading, error, messages, activeToolsStore, entryIds, messageKeys, historyCursor, hasEarlierMessages, earlierTurnCount, hasNewerMessages, newestCursor, headTurn, streamingStore,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, missingCwd, modelScopeWarnings, isModelScopeActive, allModelList, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedSubmissions,
    extensionDialog, extensionDialogQueue, waitingExtensionDialogCount, extensionCustomUi, waitingExtensionCustomUiCount, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput, addNotice,
    isAutoModelSelection,
    isAutoThinkingSelection,
    defaultModel,
    savedDefaultThinkingLevel,
    agentPhaseStore,
    isNew,
    sessionIdRef, scrollContainerRef,
    handleSend, handleAbort, startSideChat, handleFork, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleQueuedAction, handleEditContent, dismissCompactError, editEntryId, cancelEdit,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, handleSetDefaultModel, handleSetDefaultThinkingLevel, loadSlashCommands, loadAllModels,
    loadContext, activeLeafId, jumpToEntry, loadNewerPage,
  } = useAgentSession({
    session, sessionRunning, newSessionCwd, newSessionDraftKey, initialNewSessionChoices, onNewSessionChoicesChange, onAgentEnd: wrappedOnAgentEnd, onSessionEnded, onToolEnd, onAttentionNeeded, onSessionCreated, onSessionForked, onSideSession,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onMcpServersChange, onSystemInfoLoaderChange, onSessionStatsPanelOpen,
    background,
    dormant,
    onOpenSettings, onDebugSnapshotReaderChange, onReloadSessionChange, t,
  });

  // 这轮是否以错误收尾：`wrappedOnAgentEnd` 声明在 `useAgentSession` 之前，只能经由
  // 这个 ref 读到消息表；从末尾往前找，通常一步就命中最近一条助手回复。
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === "assistant") {
        lastAssistantRef.current = message as AssistantMessage;
        return;
      }
    }
    lastAssistantRef.current = null;
  }, [messages]);

  // Only whether a reply is streaming and has content yet: the chunks themselves
  // re-render StreamingReply alone.
  const isStreaming = useStreamingSelector(streamingStore, selectIsStreaming);
  const hasStreamingContent = useStreamingSelector(streamingStore, selectHasStreamingContent);
  // chunk 不再进入 ChatWindow 的渲染：流式气泡与边光字符数各自作为叶子组件
  // 订阅 store（见 StreamingReply / StreamBeamPublisher），这里只订阅两个布尔。
  const getStreamingMessage = useCallback(() => streamingStore.getState().streamingMessage, [streamingStore]);
  const sessionBusy = agentRunning || bashRunning;
  // 新会话输入框携带被 fork 的消息，便于直接重发或修改。
  const forkFromMessage = useCallback((entryId: string, message: UserMessage) => {
    void handleFork(entryId, { value: getUserMessageText(message), images: getUserMessageDraftImages(message) });
  }, [handleFork]);
  // Context window + live reading for usage lines: the polled reading when a
  // run is active, the session-stats fallback while just browsing. Held in a
  // ref so an update does not recompute the whole memoized message list.
  const ctxInfoRef = useRef(contextUsage ?? sessionStats?.contextUsage ?? null);
  ctxInfoRef.current = contextUsage ?? sessionStats?.contextUsage ?? null;
  // Read-only record of this run's answered dialogs, shown in the dialog header
  // so sequential questions ("问题 1/2") keep their earlier answers visible.
  const [answeredDialogs, setAnsweredDialogs] = useState<Array<{ id: string; question: string; answer: string; cancelled?: boolean }>>([]);
  // Answers belong to one ask sequence; a new run starts a clean page so the
  // previous run's answers cannot inflate the next dialog's "N/M" pager.
  const sessionBusyPrevRef = useRef(sessionBusy);
  useEffect(() => {
    if (sessionBusy && !sessionBusyPrevRef.current) setAnsweredDialogs([]);
    sessionBusyPrevRef.current = sessionBusy;
  }, [sessionBusy]);
  const handleDialogRespond = useCallback((request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => {
    const question = (request.title.split("\n").find((line: string) => line.trim()) ?? request.title).trim().slice(0, 80);
    let answer: string;
    let cancelled = false;
    if ("cancelled" in response) {
      answer = t("chat.cancel");
      cancelled = true;
    } else if ("confirmed" in response) {
      answer = t("chat.confirm");
    } else {
      answer = response.value;
    }
    setAnsweredDialogs((prev) => [...prev.slice(-9), { id: request.id, question, answer, cancelled }]);
    respondToExtensionUi(request, response);
  }, [respondToExtensionUi, t]);
  // While this session's run is under way its chime may come with the phone
  // locked, where a suspended context cannot start again (#1157).
  useEffect(() => {
    if (!agentRunning || !holdAudio) return;
    return holdAudio();
  }, [agentRunning, holdAudio]);
  const [quotedSelection, setQuotedSelection] = useState<{
    text: string;
    sourceEntryId?: string;
    top: number;
    left: number;
  } | null>(null);
  const [quoteInputOpen, setQuoteInputOpen] = useState(false);
  const [quoteAskTarget, setQuoteAskTarget] = useState<"side" | "new">("side");
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quotePopoverRef = useRef<HTMLDivElement | null>(null);
  const quoteChatInputRef = useRef<ChatInputHandle | null>(null);
  const closeQuotedSelection = useCallback(() => {
    setQuotedSelection(null);
    setQuoteInputOpen(false);
    setQuoteError(null);
  }, []);

  useEffect(() => {
    if (!quoteSelectionEnabled) closeQuotedSelection();
  }, [quoteSelectionEnabled, closeQuotedSelection]);

  const captureQuotedSelection = useCallback(() => {
    if (!quoteSelectionEnabled || quoteInputOpen) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const root = messageContentRef.current;
    if (!selection || selection.isCollapsed || !range || !root || !root.contains(range.commonAncestorContainer)) {
      setQuotedSelection(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setQuotedSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    const sourceEntryId = [ancestor, start, end]
      .map((element) => element?.closest<HTMLElement>('[data-message-role="assistant"]')?.dataset.entryId)
      .find((entryId): entryId is string => Boolean(entryId));
    setQuotedSelection({
      text,
      top: Math.min(window.innerHeight - 44, rect.bottom + 8),
      left: Math.max(64, Math.min(window.innerWidth - 64, rect.left + rect.width / 2)),
      sourceEntryId,
    });
  }, [quoteSelectionEnabled, quoteInputOpen]);

  useEffect(() => {
    if (!quoteInputOpen || !quotedSelection) return;
    quoteChatInputRef.current?.insertIfEmpty(buildQuotedSelection(quotedSelection.text));
  }, [quoteInputOpen, quotedSelection]);

  useLayoutEffect(() => {
    const popover = quotePopoverRef.current;
    if (!popover || !quotedSelection) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(top + 8, Math.min(quotedSelection.top, top + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(quotedSelection.left - rect.width / 2, left + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [quotedSelection, quoteInputOpen, quoteError]);

  useEffect(() => {
    if (!quotedSelection) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!quoteInputOpen && !quotePopoverRef.current?.contains(event.target as Node)) closeQuotedSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      if (!quoteSubmitting) closeQuotedSelection();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [quotedSelection, quoteInputOpen, quoteSubmitting, closeQuotedSelection]);

  const quoteSelectionHere = useCallback(() => {
    if (!quotedSelection) return;
    chatInputRef?.current?.insertQuote(buildQuotedSelection(quotedSelection.text));
    // No `removeAllRanges()` here: inserting focuses the composer, and that
    // focus already collapses the page's selection. Calling it afterwards also
    // clears the composer's own selection and drops its caret to offset 0
    // (#1319), so the quote would be typed in front of instead of after.
    closeQuotedSelection();
  }, [chatInputRef, quotedSelection, closeQuotedSelection]);

  const askSelectionInSideChat = useCallback(async (prompt: string) => {
    if (quoteSubmitting || !prompt.trim() || !quotedSelection) return;
    setQuoteSubmitting(true);
    setQuoteError(null);
    try {
      const refusal = await startSideChat(prompt, quotedSelection.text);
      if (!refusal) {
        closeQuotedSelection();
        return;
      }
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(refusal);
    } catch (error) {
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuoteSubmitting(false);
    }
  }, [quotedSelection, quoteSubmitting, closeQuotedSelection, startSideChat]);

  // The composer's Side chat button: its draft goes back on a refusal, as a failed send's does.
  const askInSideChat = useCallback(async (message: string) => {
    let refusal: string | null;
    try {
      refusal = await startSideChat(message);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    if (!refusal) return;
    chatInputRef?.current?.restoreSubmission(message);
    addNotice({ type: "error", message: refusal });
  }, [addNotice, chatInputRef, startSideChat]);

  const initialPromptSentRef = useRef(false);

  // dev：将选中文本引用到新会话提问；上游 v0.14 把同一弹窗改为侧聊入口，两个入口并存。
  const askSelectionInNewChat = useCallback(async (prompt: string) => {
    const sourceSessionId = sessionIdRef.current ?? session?.id;
    if (quoteSubmitting || !prompt.trim() || !quotedSelection?.sourceEntryId || !sourceSessionId || !onAskInNewChat) return;
    setQuoteSubmitting(true);
    setQuoteError(null);
    unlockAudio?.();
    try {
      await onAskInNewChat(
        prompt,
        sourceSessionId,
        quotedSelection.sourceEntryId,
      );
      closeQuotedSelection();
    } catch (error) {
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuoteSubmitting(false);
    }
  }, [onAskInNewChat, quotedSelection, quoteSubmitting, session?.id, sessionIdRef, closeQuotedSelection, unlockAudio]);
  useEffect(() => {
    if (loading || error || !initialPrompt || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    onInitialPromptConsumed?.();
    void handleSend(initialPrompt);
  }, [initialPrompt, loading, error, handleSend, onInitialPromptConsumed]);

  // Play the completion sound the first time a given extension dialog
  // surfaces; queued dialogs behind it only ring when they reach the front.
  useEffect(() => {
    if (!extensionDialog || completionNotificationsEnabled === false
      || soundedExtensionDialogIdRef.current === extensionDialog.id
    ) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    playDoneSoundRef.current();
  }, [completionNotificationsEnabled, extensionDialog]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    if (!panel) registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [panel, sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // 已加载的每一行都在 DOM 里，没有渲染行窗口：窗口一裁，翻页读进来的历史就真的
  // 不存在了。
  const messageRefs = useMessageRefs(messages.length);
  const messagesLenRef = useRef(0);
  messagesLenRef.current = messages.length;
  // Whole-branch turn index for the minimap's listing: turns the chat has not
  // loaded still show their preview there and page in when clicked. Absent
  // (fetch failed or still loading), the minimap falls back to loaded turns.
  const [minimapTurnIndex, setMinimapTurnIndex] = useState<MinimapTurnDescriptor[]>([]);
  // The chat pane's width decides whether the minimap shows at all: the rail
  // floats in the pane's left margin (MINIMAP_MIN_PANE_WIDTH = the 700px
  // column + one rail strip each side), so the message column stays
  // symmetrically centered and overlap is never the question. Callback ref +
  // element state: the component first renders a loading branch without the
  // pane, so the observer must start when the pane actually mounts. State
  // holds only the visibility decision: dragging the panel divider fires per
  // pixel, and a boolean keeps every non-crossing frame a no-op instead of
  // re-rendering the whole chat window.
  const [chatPaneElement, setChatPaneElement] = useState<HTMLDivElement | null>(null);
  const [minimapPaneWide, setMinimapPaneWide] = useState(false);
  useLayoutEffect(() => {
    if (!chatPaneElement) return;
    const observer = new ResizeObserver((entries) => {
      setMinimapPaneWide((entries[0]?.contentRect.width ?? 0) >= MINIMAP_MIN_PANE_WIDTH);
    });
    observer.observe(chatPaneElement);
    return () => observer.disconnect();
  }, [chatPaneElement]);
  useEffect(() => {
    const sid = session?.id;
    if (!sid) {
      setMinimapTurnIndex([]);
      return;
    }
    const controller = new AbortController();
    const loadTurns = () => {
      const params = activeLeafId ? `?leafId=${encodeURIComponent(activeLeafId)}` : "";
      fetch(`/api/sessions/${encodeURIComponent(sid)}/turns${params}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { turns?: MinimapTurnDescriptor[] } | null) => {
          if (data && Array.isArray(data.turns)) setMinimapTurnIndex(data.turns);
        })
        .catch(() => {
          // Aborted or transient; the minimap lists loaded turns only.
        });
    };
    // 缩略图的回合列表不属于首屏：等空闲再要，别和消息首屏抢主线程与连接。
    // 调度函数必须直接挂在 window 上调用：解构后调用会丢 receiver，Chromium 报 Illegal invocation。
    const usesIdleCallback = typeof window.requestIdleCallback === "function";
    const idleId = usesIdleCallback
      ? window.requestIdleCallback(loadTurns, { timeout: 1500 })
      : window.setTimeout(loadTurns, 300);
    return () => {
      controller.abort();
      if (usesIdleCallback) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, [session?.id, activeLeafId]);
  // State, not a ref: the sentinel can appear with nothing else changing (a
  // finished turn regrouped into more rows), and must get an observer then.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  /**
   * 读者是否贴底：官方 `MessageScrollerScrollable` 的反面（`scrollEdgeThreshold`＝
   * 16px）。只用于“贴底时向下加载更新页”。
   */
  const [atTail, setAtTail] = useState(true);
  const atTailRef = useRef(atTail);
  atTailRef.current = atTail;
  // 同步写 ref：挂载那一帧的副作用里就要读到官方刚发布的贴底状态，不能再等一次 render。
  const handleAtTailChange = useCallback((next: boolean) => {
    atTailRef.current = next;
    setAtTail(next);
  }, []);
  /** 视口里最上面那条已挂载消息：位置记忆用官方的 `visibleMessageIds`，不再自己量。 */
  const visibleEntryIdRef = useRef<string | null>(null);
  const handleVisibleEntryChange = useCallback((entryId: string | null) => {
    visibleEntryIdRef.current = entryId;
  }, []);
  const [pendingRevealEntryId, setPendingRevealEntryId] = useState<string | null>(null);
  const scrollerApiRef = useRef<ScrollerApi | null>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  /** 上一页请求进行中。 */
  const loadingOlderRef = useRef(false);
  /**
   * 读者上一次“往上翻”的手势：只有它之后的贴顶才取更早一页，所以位置还原、
   * 前插保位、键盘推挤这些程序化滚动永远不会把历史一页页拉出来。
   */
  const gestureUpRef = useRef(false);
  /**
   * 上一页已落地但尚未渲染并绘制一帧。此时再次请求会使两页前插互相推动、滚动锚点抖动，
   * 因此闸门比请求返回关闭得更晚。
   */
  const pageRenderingRef = useRef(false);
  const pageRenderWaitersRef = useRef<Array<() => void>>([]);
  const [olderPageState, setOlderPageState] = useState<"idle" | "loading" | "rendering">("idle");
  const [pendingSearchScroll, setPendingSearchScroll] = useState<Props["searchTarget"]>(null);
  const searchMessage = messages[entryIds.indexOf(pendingSearchScroll?.entryId ?? "")];
  const searchBlock = searchMessage?.role === "assistant"
    ? (pendingSearchScroll?.blockIndex === undefined
      ? searchMessage.content.find((block) => block.type === "text")
      : searchMessage.content[pendingSearchScroll.blockIndex])
    : undefined;
  const searchHistoryRef = useRef({ entryIds, historyCursor, hasEarlierMessages });
  searchHistoryRef.current = { entryIds, historyCursor, hasEarlierMessages };
  // The cursor of the older page asked for last, kept until the next cursor
  // renders: the page lands, and loadingOlderRef clears, a moment before that
  // render, and an observer report in between still holds this cursor.
  const requestedCursorRef = useRef<string | null>(null);
  const loadOlderPage = useCallback(async (sid: string, before: string, options?: { signal?: AbortSignal }) => {
    // 上一页未绘制完成时先等待：哨兵、点击、小地图翻页、搜索定位共用此入口，
    // 避免两页并发加载。
    if (pageRenderingRef.current) {
      await new Promise<void>((resolve) => pageRenderWaitersRef.current.push(resolve));
    }
    requestedCursorRef.current = before;
    loadingOlderRef.current = true;
    setOlderPageState("loading");
    try {
      const context = await loadContext(sid, activeLeafId, before, options);
      // Nothing landed, so the same page may be asked for again.
      if (!context && requestedCursorRef.current === before) requestedCursorRef.current = null;
      if (context) {
        pageRenderingRef.current = true;
        setOlderPageState("rendering");
      }
      return context;
    } finally {
      loadingOlderRef.current = false;
      if (!pageRenderingRef.current) setOlderPageState("idle");
    }
  }, [activeLeafId, loadContext]);
  // Jump to a minimap turn: one request fetches a window centred on that turn,
  // so the jump does not drag the whole branch in behind it page by page.
  const minimapJumpInFlightRef = useRef(false);
  const minimapJumpTargetRef = useRef<string | null>(null);
  const revealTurnForMinimap = useCallback(async (turnNumber: number) => {
    const sid = session?.id;
    const target = minimapTurnIndex[turnNumber];
    if (!sid || !target) return;
    // 目标不在当前窗口时只取一窗（该轮居中），不拖整条分支；落地后由下面的
    // effect 按 entryId 定位，滚动交给官方 `scrollToMessage`。
    if (!searchHistoryRef.current.entryIds.includes(target.entryId)) {
      // 拖拽会连续掠过未加载轮：单飞 + latest-wins。在途时只记录最新目标，
      // 本窗落地后补跳最新，不为每个 mousemove 各发一窗请求。
      if (minimapJumpInFlightRef.current) {
        minimapJumpTargetRef.current = target.entryId;
        return;
      }
      minimapJumpInFlightRef.current = true;
      try {
        let wanted = target.entryId;
        for (;;) {
          const entryId = minimapJumpTargetRef.current ?? wanted;
          minimapJumpTargetRef.current = null;
          const context = await jumpToEntry(sid, activeLeafId, entryId);
          if (!context) return;
          wanted = entryId;
          if (!minimapJumpTargetRef.current) {
            setPendingRevealEntryId(entryId);
            return;
          }
        }
      } finally {
        minimapJumpInFlightRef.current = false;
      }
    }
    setPendingRevealEntryId(target.entryId);
  }, [session?.id, minimapTurnIndex, activeLeafId, jumpToEntry]);

  // 小地图跳转的落位：行已经在 DOM 里就滚过去（官方命令会抑制跟随）。
  useLayoutEffect(() => {
    if (!pendingRevealEntryId) return;
    if (scrollerApiRef.current?.scrollToMessage(pendingRevealEntryId, { align: "center", behavior: "instant" })) {
      setPendingRevealEntryId(null);
    }
  }, [pendingRevealEntryId, entryIds]);
  // 窗口位于中段时，到达底部即向下加载一页，直至回到叶子。
  useEffect(() => {
    const sid = session?.id;
    if (!sid || !atTail || !hasNewerMessages || !newestCursor) return;
    void loadNewerPage(sid, activeLeafId, newestCursor);
  }, [atTail, hasNewerMessages, newestCursor, session?.id, activeLeafId, loadNewerPage]);
  useEffect(() => {
    // A reloaded history can come back to a cursor asked for before.
    if (historyCursor !== requestedCursorRef.current) requestedCursorRef.current = null;
  }, [historyCursor]);

  // 保活槽以 `display:none` 隐藏时 scrollTop 与 scrollHeight 会被清为 0，切回的第一帧
  // 必须把位置放回去——否则顶部加载器会把 0 当成贴顶。位置只用官方状态：
  // `visibleMessageIds` 的第一条 + `scrollToMessage`，不再自己量矩形。
  const savedScrollRef = useRef<{ atBottom: boolean; entryId: string | null } | null>(null);
  const wasActiveRef = useRef(active);
  useLayoutEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active) {
      if (wasActive) savedScrollRef.current = { atBottom: atTailRef.current, entryId: visibleEntryIdRef.current };
      return;
    }
    if (wasActive) return;
    const api = scrollerApiRef.current;
    if (!api) return;
    const saved = savedScrollRef.current;
    if (saved && !saved.atBottom && saved.entryId
      && api.scrollToMessage(saved.entryId, { align: "start", behavior: "instant" })) return;
    // 隐藏期间挂载完的会话没有记录；官方的默认位置在 clientHeight 为 0 时已被消耗。
    api.scrollToEnd({ behavior: "instant" });
  }, [active]);

  // 监听器需读取当前可见状态，故用 ref 而非闭包中的旧 prop。
  const activeRef = useRef(active);
  activeRef.current = active;

  // 折叠块展开不再推动列表：`components/transcript/TraceRow.tsx` 让被切换的那一行
  // 自己的上沿保持不动，展开只往下长，不会把尾部顶进视口。

  // 键盘升起时 html/body 不缩高：由 iOS 自己 pan visual viewport，整个界面连带页头
  // 一起上移。这里不插手滚动，避免与浏览器自己的贴底争同一帧。

  // 键盘弹起时不写回滚动位置：官方 scroller 自行区分贴尾与浏览历史，手动回写
  // scrollTop/window.scrollY 会在视口缩高的那一帧把列表拉回。

  useEffect(() => {
    if (!searchTarget || loading) return;
    const controller = new AbortController();
    const locate = async () => {
      const history = searchHistoryRef.current;
      let found = history.entryIds.includes(searchTarget.entryId);
      if (!found && !sessionBusy && history.hasEarlierMessages && history.historyCursor && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        // ponytail: one extra page, the same size scrolling reads; an older or other-branch hit just opens the session.
        const context = await loadOlderPage(searchTarget.sessionId, history.historyCursor, { signal: controller.signal });
        loadingOlderRef.current = false;
        found = Boolean(context?.entryIds.includes(searchTarget.entryId));
      }
      if (controller.signal.aborted) return;
      if (found) {
        setPendingSearchScroll(searchTarget);
      } else {
        onSearchTargetHandled?.(searchTarget);
      }
    };
    void locate();
    return () => controller.abort();
  }, [searchTarget, loading, sessionBusy, loadOlderPage, onSearchTargetHandled, scrollContainerRef]);

  useLayoutEffect(() => {
    if (!pendingSearchScroll || pendingSearchScroll !== searchTarget) return;
    const selector = `[data-entry-id="${CSS.escape(pendingSearchScroll.entryId)}"]`;
    const element = scrollContainerRef.current?.querySelector<HTMLElement>(searchMessage?.role === "user" ? selector : `${selector} [data-search-target]`);
    // 定位交给官方 `scrollToMessage`：它按 messageId 进入 settling-jump 并抑制跟随，
    // 自己改 scrollTop 会在下一帧被跟随补位推翻。
    scrollerApiRef.current?.scrollToMessage(pendingSearchScroll.entryId, { align: "center", behavior: "instant" });
    element?.animate([
      { backgroundColor: "var(--accent)" },
      { backgroundColor: "transparent" },
    ], { duration: 2500 });
    setPendingSearchScroll(null);
    onSearchTargetHandled?.(pendingSearchScroll);
  }, [pendingSearchScroll, searchTarget, searchMessage, scrollContainerRef, onSearchTargetHandled]);

  // 贴顶取更早一页：只有读者“往上翻”的手势（向上的滚轮、手指往下拖、
  // ArrowUp/PageUp/Home）之后、200ms 防抖窗口内仍然贴顶，才取一页。
  // 位置还原、前插保位、键盘推挤这些程序化滚动因此永远不会取页。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    let timer = 0;
    const take = () => {
      timer = 0;
      if (!activeRef.current || !gestureUpRef.current) return;
      if (container.scrollTop > TOP_SLACK) return;
      // 贴底（官方 `scrollable.end` 为假）时不存在“翻到顶”：此时的
      // `scrollTop ≈ 0` 均为其他原因——回合结束后行被替换、内容变短、浏览器把
      // `scrollTop` 夹回顶部，或滚容器自行回到末端。若当作读者翻到顶，每次
      // 回复完成都会多取一页旧消息。真正处于长列表顶部时，`end` 很大，
      // `atTail` 为假，闸门照常放行。
      if (atTailRef.current) return;
      // A page is loading, or the last one is still rendering.
      if (loadingOlderRef.current || pageRenderingRef.current) return;
      // Fetch the previous page from the server and prepend it. 前插保位由官方 scroller
      // 的 `preserveScrollOnPrepend` 负责：它按 `messageId` 记住视口边缘那一行，
      // 新页落地后把同一行放回原位。
      const oldestId = historyCursor;
      // Its page already landed; the next cursor has not rendered yet.
      if (!oldestId || oldestId === requestedCursorRef.current) return;
      const sid = session?.id ?? sessionIdRef.current;
      if (!sid) return;
      // 一次手势只取一页：取完先收回意图，下一次上滑重新给。
      gestureUpRef.current = false;
      loadingOlderRef.current = true;
      void loadOlderPage(sid, oldestId).finally(() => {
        loadingOlderRef.current = false;
      });
    };
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(take, advancedValue<number>("autoLoadDebounceMs"));
    };
    // 只在“向上翻历史”的意图下开闸，而且必须分方向：往下滚轮、手指上推、
    // 按 ArrowDown/PageDown/End 都是在往回读，不该开闸。用 touchmove 而非
    // touchstart/pointerdown：点按折叠头、长按复制不产生拖拽，不该开闸。
    let touchY: number | null = null;
    const onWheel = (event: WheelEvent) => {
      // 反方向即撤销意思：一次向上滚轮只在“仍然在往上翻”期间有效，否则闸门会
      // 一直开着，以后任何一次偶然触顶都会拉出一页。
      if (event.deltaY >= 0) {
        gestureUpRef.current = false;
        return;
      }
      gestureUpRef.current = true;
      schedule();
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      // 手指下移 = 内容往回走 = 在读更早的历史；上推是回到底部，撤销意思。
      if (touchY !== null && y > touchY) {
        gestureUpRef.current = true;
        schedule();
      } else if (touchY !== null && y < touchY) {
        gestureUpRef.current = false;
      }
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
        gestureUpRef.current = false;
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "PageUp" && event.key !== "Home") return;
      gestureUpRef.current = true;
      schedule();
    };
    const onScroll = () => {
      if (gestureUpRef.current) schedule();
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    // 挂载时不取页：贴顶打开的会话就停在首屏那几轮，往上滑才续。
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("keydown", onKeyDown);
      if (timer) window.clearTimeout(timer);
    };
  }, [sentinel, historyCursor, session, loadOlderPage, sessionIdRef, scrollContainerRef]);

  // Clear the page gate once the prepended rows have painted a frame. Until then
  // the sentinel and the row stay inert, so two pages can never be in flight with
  // one still half-rendered.
  // `olderPageState` is in the deps so a page that prepended nothing (the server
  // repeated the cursor) still releases the gate instead of wedging it shut.
  useLayoutEffect(() => {
    if (!pageRenderingRef.current) return;
    const container = scrollContainerRef.current;
    // 内容撑不满一屏时没有可滚的余量，前插后 scrollTop 会停在顶部。
    const notFull = () => !container || container.scrollHeight <= container.clientHeight + TOP_SLACK;
    const release = () => {
      pageRenderingRef.current = false;
      // 不为“内容撑不满一屏”自动续取：那会让列表在读者没动手时一页页自己长出来。
      // 顶部的手动入口（加载更早）仍可随时请求一页。
      setOlderPageState("idle");
      const waiters = pageRenderWaitersRef.current;
      pageRenderWaitersRef.current = [];
      for (const resolve of waiters) resolve();
    };
    // 前插的一页要真的落位才放行：内容还没撑开时 scrollTop 仍在顶端，此时放行会被
    // 贴顶判定当成"读者还在顶部"而立刻再取一页，读到的就是连续跳页。
    let frame = 0;
    let frames = 0;
    const settle = () => {
      frame = requestAnimationFrame(() => {
        frames += 1;
        const settled = !container
          || container.scrollTop > TOP_SLACK
          || notFull();
        if (settled || frames >= advancedValue<number>("prependSettleFrames")) {
          release();
          return;
        }
        settle();
      });
    };
    settle();
    return () => cancelAnimationFrame(frame);
  }, [messages.length, olderPageState, scrollContainerRef]);

  // Read one more page only when the reader asks for it (the sentinel at the top
  // or the "load earlier" row). Reading the whole branch up front put dozens of
  // page-sized prepends on screen while the reader was still at the tail, which
  // is what made loading look like it was jumping around.
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    if (background) return;
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [background, statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    if (background) return;
    onContextUsageChange?.(contextUsageRef.current);
  }, [background, ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  // Images attach to the prompt. Other files go through the unified upload
  // repository (`~/.pi-web/upload/<date>/`, never replacing a file already
  // there) and come back as @mentions of their repository paths. The working
  // directory is never touched, so the file tree has nothing to refresh.
  const uploadDroppedFiles = useCallback(async (files: File[]): Promise<boolean> => {
    const directory = uploadRepoDirectory("composer");
    try {
      const { status, data } = await uploadFiles(directory, files, "skip");
      if (status !== 200 && status !== 207) throw new Error(data.error ?? `HTTP ${status}`);
      const uploaded = data.uploaded ?? [];
      const skipped = data.skipped ?? [];
      const mentions = dropMentionText(files, directory, [...uploaded, ...skipped]);
      if (mentions) chatInputRef?.current?.insertText(mentions);
      if (uploaded.length > 0) {
        addNotice({ type: "success", message: t("chat.dropUploaded", { count: uploaded.length }) });
      }
      if (skipped.length > 0) {
        addNotice({ type: "warning", message: t("chat.dropAlreadyExists", { names: skipped.join(", ") }) });
      }
      for (const failure of data.errors ?? []) {
        addNotice({ type: "error", message: t("chat.dropFailed", { message: `${failure.name}: ${failure.error}` }) });
      }
      return true;
    } catch (uploadError) {
      addNotice({ type: "error", message: t("chat.dropFailed", { message: uploadError instanceof Error ? uploadError.message : String(uploadError) }) });
      return false;
    }
  }, [addNotice, chatInputRef, t]);

  // 大文案粘贴（DeepSeek 同款）：超过阈值的粘贴文本不进输入框，落到系统临时目录的
  // `pi/pasted`（macOS 即 `/tmp/pi/pasted`）后再以 `@绝对路径` 引用。落盘不碰会话工作
  // 目录，也不触发文件树刷新；写入失败把原文插回输入框，文案不丢。
  const onPasteLargeText = useCallback(async (text: string) => {
    try {
      const response = await fetch("/api/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json().catch(() => null)) as { path?: string } | null;
      if (!response.ok || typeof data?.path !== "string") throw new Error(`HTTP ${response.status}`);
      chatInputRef?.current?.insertText(buildAtMentionText(data.path, false));
      addNotice({ type: "success", message: t("chat.pasteSaved", { path: data.path }) });
    } catch (error) {
      addNotice({ type: "warning", message: t("chat.pasteFailed", { message: error instanceof Error ? error.message : String(error) }) });
      chatInputRef?.current?.insertText(text);
    }
  }, [addNotice, chatInputRef, t]);

  // 💡灵感「实现」：文本与图片装进输入框（不自动发送），附件引用做编排——
  // 工作目录已有同名文件就引用原路径（@相对路径），否则引用仓库里的
  // `~/.pi-web/upload/inspiration/<日期>/<原名>`（大模型认识 `~`）。焦点回到输入框。
  const handleImplementInspiration = useCallback(async (text: string, images: File[], fileRefs: InspirationFileRef[]) => {
    if (text) chatInputRef?.current?.insertText(text);
    if (images.length > 0) chatInputRef?.current?.addImages(images);
    if (fileRefs.length > 0) {
      const cwd = session?.cwd ?? newSessionCwd;
      let cwdFiles: string[] | null = null;
      if (cwd) {
        try {
          const res = await fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}`);
          if (res.ok) cwdFiles = ((await res.json()) as { files?: string[] }).files ?? [];
        } catch {
          cwdFiles = null; // 索引不可用就全部引用仓库路径，附件不丢。
        }
      }
      const mentions = fileRefs
        .map((ref) => buildAtMentionText(cwdFiles?.find((entry) => getFileName(entry) === ref.name) ?? ref.path, false))
        .join("");
      if (mentions) chatInputRef?.current?.insertText(mentions);
    }
    chatInputRef?.current?.focus();
  }, [chatInputRef, newSessionCwd, session?.cwd]);

  const onDrop = useCallback((items: DroppedItem[]) => {
    const { images, files, folders } = splitDroppedItems(items);
    if (images.length > 0) chatInputRef?.current?.addImages(images);
    if (folders.length > 0) {
      addNotice({ type: "warning", message: t("chat.dropFoldersUnsupported", { names: folders.join(", ") }) });
    }
    if (files.length > 0) void uploadDroppedFiles(files);
  }, [addNotice, chatInputRef, t, uploadDroppedFiles]);

  const onAttachFiles = useCallback((files: File[]) => {
    onDrop(files.map((file) => ({ kind: "file", file })));
  }, [onDrop]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);
  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamingStore), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  // In-flight tool results are not in this map: the running card subscribes to
  // activeToolsStore by toolCallId (ActiveToolsContext), so a
  // tool_execution_update neither rebuilds this map nor recomputes the list.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const isEmptyNew = isNew && messages.length === 0 && !isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  // 状态行现在住在输入框里（队列之下、卡片正上方），而它的文案在列表渲染之后才
  // 算得出来；因此输入框延迟到停靠区那一刻才构造，避免把两百行 JSX 搬下来。
  const renderChatInput = (notice: ReactNode) => (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSideChat={onSideSession && !isHiddenRelation(session?.relation) ? askInSideChat : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onSteer={agentRunning ? handleSteer : undefined}
      onPasteLargeText={onPasteLargeText}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      missingCwd={missingCwd}
      modelScopeWarnings={modelScopeWarnings}
      allModelList={allModelList}
      onLoadAllModels={isModelScopeActive ? loadAllModels : undefined}
      onModelChange={handleModelChange}
      modelSwitching={modelSwitching}
      defaultModel={defaultModel}
      onSetDefaultModel={handleSetDefaultModel}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      onDismissCompactError={dismissCompactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={(session && !isHiddenRelation(session.relation)) || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      isAutoThinkingSelection={isAutoThinkingSelection}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      savedDefaultThinkingLevel={savedDefaultThinkingLevel}
      onSetDefaultThinkingLevel={session || isNew ? handleSetDefaultThinkingLevel : undefined}
      retryInfo={retryInfo}
      queuedSubmissions={queuedSubmissions}
      activityNotice={notice ?? undefined}
      streamStatusStore={streamingStore}
      inputHistory={inputHistory}
      onQueuedAction={handleQueuedAction}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      extensionUiOpen={Boolean(extensionDialog || extensionCustomUi)}
      onBuiltinCommand={handleBuiltinSlashCommand}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      cwd={session?.cwd ?? newSessionCwd}
      onAttachFiles={onAttachFiles}
      onOpenInspirations={session ? () => setInspirationOpen(true) : undefined}
    />
  );

  // The message list is built in one memoized pass. Streaming chunks only change
  // `streamState`, so the memo holds across them: per-chunk renders reuse the
  // previous element identities and the memoized message/activity views skip
  // re-rendering. Recomputes happen on message appends (a few times per turn),
  // search reveals, and run boundaries.
  const messageListView = useMemo(() => {
    let liveActivityRendered = false;
      // Anchor for live-tail detection. A compaction summary or subagent
      // completion can sit after the last user message and own the
      // still-streaming segment.
      // 流式中的回合不得被回合锚点切开（否则被按已结束回合拆分渲染）。只降级
      // 流式助手之后的非用户锚点（子代理完成通知等 custom）：新提问的乐观气泡
      // 入列时流式助手多半还没进 messages，streamingAssistantIdx 会指向上一回
      // 合的助手，把用户消息一并降级会吞掉新回合（用量栏消失、气泡错位）。
      let streamingAssistantIdx = -1;
      if (sessionBusy || isStreaming) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "assistant") { streamingAssistantIdx = i; break; }
        }
      }
      const isTurnAnchor = (i: number) => {
        const anchorMsg = messages[i];
        if (!isMessageGroupAnchor(anchorMsg)) return false;
        // 跑着的回合里，压缩摘要 / 子代理完成通知会落在用户消息之后（回合并没结束）。
        // 它们不是新回合的分界：认成锚点会把正在跑的折叠块切成「已结束回合」，
        // 而这一刻的思考与工具还在流式 store 里（结束态路径不并它们）→ 折叠块整块
        // 消失，屏幕只剩用户消息和一条压缩。放行它们，压缩卡片作为本回合的活动项
        // 留在折叠体里，回合结束后再回到锚点位置。
        if (anchorMsg.role === "custom" && (sessionBusy || isStreaming)) return false;
        if (streamingAssistantIdx === -1 || i < streamingAssistantIdx) return true;
        // 流式助手之后的锚点：用户新回合永远生效（含流式启动竞态——新提问入列
        // 时 streamingAssistantIdx 还指向上一回合的助手）；仅 custom 通知降级，
        // 不切开流式回合。
        return anchorMsg.role === "user";
      };
      let lastAnchorIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (isTurnAnchor(i)) { lastAnchorIdx = i; break; }
      }

      const visibleRefIndexByMessage = new Map<number, number>();
      let refIdx = 0;
      messages.forEach((msg, idx) => {
        if (isMessageGroupAnchor(msg) || msg.role === "assistant") {
          visibleRefIndexByMessage.set(idx, refIdx++);
        }
      });

      const attachVisibleRef = (_idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
        messageRefs.current[refIndex] = el;
      };

      /**
       * 回合级行的 React key：用 `lib/message-keys.ts` 算好的稳定身份（落盘前是
       * live 键、落盘后原位接力），不用 `entryIds[userIdx]`——它从 `undefined`
       * 变成真 id 时整回合的行会全部重挂：折叠状态、思考、图片、高亮全丢，
       * 官方的前插保位也因为「首个子元素换了节点」而失效。
       */
      const stableKey = (i: number): string | number => messageKeys[i] ?? entryIds[i] ?? i;

      // The model name is said once per run: the same model on the next step is noise.
      let labeledModel: string | null = null;
      const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; writtenFiles?: WrittenFile[]; showModelLabel?: boolean; hideUsage?: boolean; hideCopy?: boolean } = {}): ReactNode => {
        const msg = options.messageOverride ?? messages[idx];
        // pi's TUI never renders custom messages without a display payload; one
        // card per idle session restart flooded the chat (#1043).
        if (isHiddenCustomMessage(msg as { role?: AgentMessage["role"]; display?: boolean })) return null;
        const isVisible = isMessageGroupAnchor(msg) || msg.role === "assistant";
        const currentRefIdx = visibleRefIndexByMessage.get(idx);
        const keyPrefix = options.keyPrefix ?? "message";
        const messageKey = messageKeys[idx] ?? entryIds[idx] ?? idx;
        let showTimestamp = false;
        if (msg.role === "assistant") {
          showTimestamp = true;
          for (let j = idx + 1; j < messages.length; j++) {
            const r = messages[j].role;
            if (r === "user") break;
            if (r === "assistant") { showTimestamp = false; break; }
          }
          // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
          if (showTimestamp && isStreaming && idx === messages.length - 1) {
            showTimestamp = false;
          }
        }
        if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
        const modelInfo = msg.role === "assistant" ? `${msg.provider ?? ""}/${msg.model ?? ""}` : null;
        const labelModel = Boolean(options.showModelLabel) && modelInfo !== null && labeledModel !== modelInfo;
        if (labelModel) labeledModel = modelInfo;
        const view = (
          <MessageView
            key={`${keyPrefix}-view-${messageKey}`}
            message={msg}
            toolResults={toolResultsMap}
            modelNames={modelNames}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
            onOpenSubagent={onOpenSubagent}
            entryId={entryIds[idx]}
            messageKey={messageKey}
            searchBlock={entryIds[idx] === pendingSearchScroll?.entryId ? searchBlock : undefined}
            onFork={bashRunning || isNew ? undefined : forkFromMessage}
            forking={forkingEntryId === entryIds[idx]}
            onEditContent={sessionBusy ? undefined : handleEditContent}
            isEditing={entryIds[idx] !== undefined && editEntryId === entryIds[idx]}
            onCancelEdit={cancelEdit}
            showTimestamp={showTimestamp}
            prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
            sessionId={session?.id ?? sessionIdRef.current ?? undefined}
            writtenFiles={options.writtenFiles}
            showModelLabel={labelModel}
            hideUsage={options.hideUsage}
            hideCopy={options.hideCopy}
          />
        );
        if (!isVisible || currentRefIdx === undefined) {
          // ref 窗口外的行：包一层只管入场动画的 div，键沿用 view 自己的键，
          // 官方 scroller 解析 messageId 的结果与原来一致。
          return (
            <div key={`${keyPrefix}-view-${messageKey}`} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
              {view}
            </div>
          );
        }
        return (
          // 行高固定：content-visibility 的估算高度会导致行进出视口时滚动位置跳动。
          // 入场动画挂在这一层：新行挂载播一次，会话切换整列同步淡入。
          <div
            key={`${keyPrefix}-${messageKey}`}
            data-entry-id={entryIds[idx]}
            ref={options.attachRef === false ? undefined : attachVisibleRef(idx, currentRefIdx)}
            className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          >
            {view}
          </div>
        );
      };

      const rendered: ReactNode[] = [];
      let idx = 0;
      // Lazy pagination: the loaded window may begin mid-turn, before
      // this turn's user message, so the anchor scan cannot group it.
      // Render that partial head as flat activity rows (like the live
      // tail) instead of standalone messages; once earlier messages
      // finish loading the turn regroups normally.
      if (hasEarlierMessages && messages.length > 0 && !isMessageGroupAnchor(messages[0])) {
        let headEnd = 0;
        while (headEnd < messages.length && !isMessageGroupAnchor(messages[headEnd])) headEnd += 1;
        const headItems = buildTurnActivityItems({
          messages,
          startIdx: 0,
          endIdx: headEnd,
          entryIds,
          toolResults: toolResultsMap,
          searchEntryId: pendingSearchScroll?.entryId,
          searchBlock,
        });
        if (headItems.length > 0) {
          rendered.push(
            <TurnActivityBody
              key="head-activity"
              items={headItems}
              cwd={messageCwd}
              onOpenFile={onOpenFile}
              onOpenSubagent={onOpenSubagent}
              sessionId={session?.id ?? sessionIdRef.current ?? undefined}
            />,
          );
        } else {
          for (let headIdx = 0; headIdx < headEnd; headIdx++) {
            rendered.push(renderMessage(headIdx, { showModelLabel: true }));
          }
        }
        // 被截断的回合头走到这一轮的终点：整轮求和要用窗口外的助手消息，客户端
        // 只拿得到半截，所以数字由服务端随窗口下发（headTurn）。窗口止于叶子时
        // 回合可能还在跑，那时不算结束，等整轮结束再补。
        const headEndsTurn = headSegmentEndsTurn({ headEnd, messageCount: messages.length, running: sessionBusy || isStreaming });
        if (headItems.length > 0 && headTurn && headEndsTurn) {
          rendered.push(
            <div key="head-activity-meta" className="mb-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
              <TurnMetaLine
                usage={headTurn.usage}
                model={headTurn.provider ? getModelDisplayName(headTurn.provider, headTurn.model, modelNames) : undefined}
                thinkingLevel={headTurn.thinkingLevel ?? thinkingLevel}
                time={formatTime(headTurn.timestamp)}
                timestamp={headTurn.timestamp}
              />
            </div>,
          );
        }
        idx = headEnd;
      }
      for (; idx < messages.length;) {
        if (!isTurnAnchor(idx)) {
          rendered.push(renderMessage(idx, { showModelLabel: true }));
          idx += 1;
          continue;
        }

        const userIdx = idx;
        let endIdx = userIdx + 1;
        while (endIdx < messages.length && !isTurnAnchor(endIdx)) endIdx += 1;

        const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

        if (finalAssistantIdx === -1) {
          // 首条 assistant 条目落盘前的空窗：思考或等待阶段会话文件里只有用户
          // 消息，此前本回合仅剩一条空回复气泡，折叠行与思考均不出现。活跃尾回合（正在跑、最后一锚、就在末尾）挂一把与
          // isLiveTail 首段同键（:0）的空折叠：标题从流式 store 取最新块
          // （思考期=思考+秒表），首条条目落盘后 isLiveTail 分支无缝接管；
          // 非活跃回合维持原平铺渲染。
          const livePreTurn = (sessionBusy || isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
          for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
            rendered.push(renderMessage(renderIdx, { showModelLabel: true }));
          }
          if (livePreTurn) {
            liveActivityRendered = true;
            rendered.push(
              <LiveTurnTrace
                key={`live-activity-pre-${stableKey(userIdx)}`}
                items={[]}
                startTs={(messages[userIdx] as (AgentMessage & { timestamp?: number })).timestamp}
                foldKey={entryIds[userIdx] === undefined ? undefined : `process:${entryIds[userIdx]}:0`}
                store={streamingStore}
                phaseStore={agentPhaseStore}
                toolResults={toolResultsMap}
                cwd={messageCwd}
                onOpenFile={onOpenFile}
                onOpenSubagent={onOpenSubagent}
                mergeStreaming
              />,
            );
          }
          idx = endIdx;
          continue;
        }

        const isLiveTail = (sessionBusy || isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
        if (isLiveTail) {
          // 运行中的回合整轮折叠（LiveTurnTrace）：活动行（含中途回复的文本块）
          // 全部收进折叠体，最新进展由折叠行标题承担；最终回复照常流式显示。
          rendered.push(renderMessage(userIdx));
          const liveItems = buildTurnActivityItems({
            messages,
            startIdx: userIdx + 1,
            endIdx,
            entryIds,
            toolResults: toolResultsMap,
            searchEntryId: pendingSearchScroll?.entryId,
            searchBlock,
          });
          // 折叠行整个运行期都在：首轮还在思考/等待首块落盘时也显示秒表，
          // 而不是等第一条活动行落盘才凭空出现。中途回复显示在折叠外面，
          // 活动按回复切成多个行内大折叠；段序号进折叠键，
          // 与完成态逐段对上；只有最后一段并入流式工具（它才是“最新”）。
          liveActivityRendered = true;
          const liveParts = splitTurnParts(liveItems);
          const liveAnchorTs = (messages[userIdx] as (AgentMessage & { timestamp?: number })).timestamp;
          liveParts.forEach((part, partIdx) => {
            if (part.kind === "checkpoint") {
              rendered.push(<CheckpointRow key={`live-checkpoint-${part.view.key}`} view={part.view} />);
              return;
            }
            if (part.kind === "fold") {
              // 只有最后一段挂秒表（LiveTurnTrace）；已完成段直接按完成态渲染。
              // pi 常把 thinking/中间回复/工具写进同一条 assistant 条目，相邻段
              // 首条目时间戳相同，两把秒表会同秒同跳（两段时长因此相同）；
 // 都是 49s）；完成段也不该在完成后继续走秒。完成段外观与 settle 后零差异。
              const isLiveSegment = partIdx === liveParts.length - 1;
              const segStartTs = part.items.find((item) => item.ts !== undefined)?.ts ?? liveAnchorTs;
              const segFoldKey = entryIds[userIdx] === undefined ? undefined : `process:${entryIds[userIdx]}:${partIdx}`;
              const segBody = (
                <TurnActivityBody
                  items={part.items}
                  cwd={messageCwd}
                  onOpenFile={onOpenFile}
                  onOpenSubagent={onOpenSubagent}
                  sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                  live={isLiveSegment}
                />
              );
              if (!isLiveSegment) {
                rendered.push(
                  <TurnTrace
                    key={`live-activity-${stableKey(userIdx)}-${partIdx}`}
                    summary={segmentSummaryText(part.items, t)}
                    foldKey={segFoldKey}
                    defaultOpen={false}
                    reveal={part.items.some((item) => item.searchTarget)}
                  >
                    {segBody}
                  </TurnTrace>,
                );
                return;
              }
              rendered.push(
                <LiveTurnTrace
                  key={`live-activity-${stableKey(userIdx)}-${partIdx}`}
                  items={part.items}
                  startTs={segStartTs}
                  foldKey={segFoldKey}
                  store={streamingStore}
                  phaseStore={agentPhaseStore}
                  toolResults={toolResultsMap}
                  cwd={messageCwd}
                  onOpenFile={onOpenFile}
                  onOpenSubagent={onOpenSubagent}
                  mergeStreaming
                >
                  {segBody}
                </LiveTurnTrace>,
              );
              return;
            }
            rendered.push(
              <div
                key={`live-reply-${stableKey(userIdx)}-${partIdx}`}
                className="my-1"
                data-message-text
                data-search-target={part.searchTarget || undefined}
              >
                <SafeMarkdownBody>{part.block.text}</SafeMarkdownBody>
              </div>,
            );
          });
          // 活动行不渲染用户消息：流式段内助手之后入列的排队/引导用户消息在
          // 实时段末尾原样渲染，保持「已排队」可见。
          for (let queuedIdx = userIdx + 1; queuedIdx < endIdx; queuedIdx++) {
            if (messages[queuedIdx].role === "user") {
              rendered.push(renderMessage(queuedIdx, { showModelLabel: true }));
            }
          }
          idx = endIdx;
          continue;
        }

        rendered.push(renderMessage(userIdx));

        // Per-turn view model, cached by the turn's entry fingerprint so its
        // object identities survive list recomputes (memoized MessageView /
        // TurnActivityBody then skip finished turns entirely).
        const turnView = getFinishedTurnView({
          messages,
          userIdx,
          endIdx,
          finalAssistantIdx,
          entryIds,
          cwd: messageCwd,
          searchEntryId: pendingSearchScroll?.entryId,
          searchBlockKey: pendingSearchScroll?.blockIndex,
          searchBlock,
        });
        const { finalAnswerMessage, writtenFiles, activityItems, processBlockLimitByIdx } = turnView;

        // Search reveal: 搜索命中落在哪个折叠段由分段的 item.searchTarget 决定
        // （splitTurnParts 会把标记带进各段），这里只锚定整组过程区的 ref。
        let processRefIdx: number | undefined;
        for (let processIdx = userIdx + 1; processIdx <= finalAssistantIdx; processIdx++) {
          const processMessage = messages[processIdx];
          if (processMessage.role === "custom" && isHiddenCustomMessage(processMessage)) continue;
          if (processMessage.role === "custom") {
            processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
            continue;
          }
          if (processMessage.role !== "assistant") continue;
          const processContent = (processMessage as AssistantMessage).content ?? [];
          const processLimit = processBlockLimitByIdx?.get(processIdx) ?? processContent.length;
          if (processLimit === 0) continue;
          processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
        }

        // 活动按中途回复切段：每段一个行内大折叠，回复以普通文本段显示在外面。段序号进折叠键，与活跃期的 LiveTurnTrace 一致，settle
        // 交换帧逐段原样接管展开/收起状态。段时长取首尾活动时间戳之差；
        // 取不到时退回分类计数。
        const turnParts = splitTurnParts(activityItems);
        if (turnParts.length > 0) {
          const processKey = entryIds[userIdx];
          rendered.push(
            <div
              key={`process-group-${processKey ?? userIdx}`}
              className="flex flex-col gap-2"
              ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
            >
              {turnParts.map((part, partIdx) => {
                if (part.kind === "checkpoint") {
                  return <CheckpointRow key={`turn-checkpoint-${part.view.key}`} view={part.view} />;
                }
                if (part.kind === "reply") {
                  return (
                    <div
                      key={`turn-reply-${stableKey(userIdx)}-${partIdx}`}
                      className="my-1"
                      data-message-text
                      data-search-target={part.searchTarget || undefined}
                    >
                      <SafeMarkdownBody>{part.block.text}</SafeMarkdownBody>
                    </div>
                  );
                }
                // 结算段摘要：与活跃回合的已完成段共用同一实现（segmentSummaryText）。
                const segSummary = segmentSummaryText(part.items, t);
                return (
                  <TurnTrace
                    key={`turn-fold-${stableKey(userIdx)}-${partIdx}`}
                    summary={segSummary}
                    foldKey={processKey === undefined ? undefined : `process:${processKey}:${partIdx}`}
                    defaultOpen={!finalAnswerMessage}
                    reveal={part.items.some((item) => item.searchTarget)}
                  >
                    <TurnActivityBody
                      items={part.items}
                      cwd={messageCwd}
                      onOpenFile={onOpenFile}
                      onOpenSubagent={onOpenSubagent}
                      sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                    />
                  </TurnTrace>
                );
              })}
            </div>,
          );
        }

        if (finalAnswerMessage && hasFinalAssistantAnswer(finalAnswerMessage)) {
          rendered.push(renderMessage(finalAssistantIdx, {
            messageOverride: finalAnswerMessage,
            writtenFiles,
            // The turn's timestamp lives on the TurnMetaLine right below; a
            // second copy in the message footer read like a rendering glitch.
            showTimestamp: false,
            // The turn's usage/model line below carries the numbers; a second copy here read as noise.
            hideUsage: true,
            // The copy affordance joins the TurnMetaLine instead of hanging
            // alone under the reply.
            hideCopy: true,
          }));
        }

        // One aggregated usage/model/time line per turn replaces the
        // per-message usage rows and model labels. ctx = context occupancy
        // after this turn: the next request's prompt, or the live reading
        // while this is still the conversation tail.
        const { usage: turnUsage, lastAssistant: turnLastAssistant } = turnView;
        const finalAnswerCopyText = finalAnswerMessage
          ? (finalAnswerMessage.content ?? [])
              .filter((b): b is TextContent => b.type === "text")
              .map((b) => b.text)
              .join("\n")
          : "";
        const metaNode = (
          <div key={`turn-meta-${stableKey(userIdx)}`} className="mb-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
            <TurnMetaLine
              usage={turnUsage}
              model={turnLastAssistant?.provider ? getModelDisplayName(turnLastAssistant.provider, turnLastAssistant.model, modelNames) : undefined}
              thinkingLevel={turnLastAssistant?.thinkingLevel ?? thinkingLevel}
              time={formatTime(turnLastAssistant?.timestamp)}
              timestamp={turnLastAssistant?.timestamp}
              copySource={finalAnswerCopyText || undefined}
            />
          </div>
        );
        // 用量与本轮最后一块内容同属一行：跨行间距会被 content-visibility 的包含块吞掉，
        // 负边距则会重叠，仅同行内的 gap 可靠。
        const lastNode = rendered[rendered.length - 1];
        // 提问本身是本轮最后一块内容时（回复尚未写入），合并会使用量贴到气泡上，
        // 故仍单独成行，间距由行距提供。入场动画包装层（ref 窗口外的行）不带
        // message，向里看一层拿角色。
        const lastRole = (() => {
          const outerProps = isValidElement(lastNode) ? (lastNode.props as { message?: unknown; children?: ReactNode }) : null;
          const node = outerProps && !("message" in outerProps) && isValidElement(outerProps.children)
            ? outerProps.children
            : lastNode;
          return isValidElement(node)
            ? (node.props as { message?: { role?: string } }).message?.role
            : undefined;
        })();
        if (isValidElement<{ "data-entry-id"?: string }>(lastNode) && lastRole !== "user") {
          rendered[rendered.length - 1] = (
            <div
              key={lastNode.key ?? `turn-body-${stableKey(userIdx)}`}
              data-entry-id={lastNode.props["data-entry-id"]}
              className="flex min-w-0 flex-col gap-1.5"
            >
              {lastNode}
              {metaNode}
            </div>
          );
        } else {
          rendered.push(metaNode);
        }

        for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
          // 每轮仅保留 TurnMetaLine 一处用量，中间步骤不再各自成行。
          rendered.push(renderMessage(renderIdx, { showModelLabel: true, hideUsage: true }));
        }
        idx = endIdx;
      }
    return { rendered, liveActivityRendered };
  }, [messages, entryIds, messageKeys, toolResultsMap, hasEarlierMessages, isStreaming, sessionBusy,
     forkingEntryId, pendingSearchScroll, searchBlock, t, modelNames, messageCwd, session?.id,
     sessionIdRef, forkFromMessage, handleEditContent, onOpenFile, onOpenSubagent, streamingStore,
     agentPhaseStore,
     isNew, messageRefs, bashRunning, editEntryId, cancelEdit, thinkingLevel, headTurn]);
  const { rendered: turnRendered, liveActivityRendered } = messageListView;
  // 运行状态提示（等待模型、执行工具、运行命令、压缩上下文）不进消息列表：
  // 它在列表尾出现或消失都会改动滚动内容的高度，尾部跟随下整列随之上下跳。
  // 它固定在输入框上方的一行里，那一行由 min-h 恒占一行文字，有无与换文案
  // 都不改任何高度。两个提示争一个槽时命令优先：bash 在跑是更当下的事实。
  // 阶段文案是叶子组件（订阅 agentPhaseStore）：工具输出事件只换这一行文字，
  // 不再重渲染 ChatWindow。元素按输入 memo 化，身份稳定才不破 ChatInput 的 memo。
  const activityNotice = useMemo(() => (
    <ActivityNoticeLine
      store={agentPhaseStore}
      live={liveActivityRendered}
      bashRunning={bashRunning}
      pendingBash={Boolean(pendingBash)}
      agentRunning={agentRunning}
      isCompacting={isCompacting}
      hasStreamingContent={hasStreamingContent}
      queuedCount={queuedSubmissions.length}
    />
  ), [agentPhaseStore, liveActivityRendered, bashRunning, pendingBash, agentRunning, isCompacting, hasStreamingContent, queuedSubmissions]);
  // 每一行都已加载的消息都在 DOM 里，只由服务端是否还有更早的页决定顶部入口。
  const hasMoreRendered = hasEarlierMessages;
  // 主聊天停靠区：浮在消息之上（消息列延伸到卡片背后，末端按停靠区高度垫底），
  // 桌面与手机一致。空态（hero+composer 簇的垂直居中依赖文档流）与侧面板保持
  // 原有布局。
  /**
   * 窗口外的消息行：条目 id → 占位高度。渲染层据此把内容换成等高占位。
   * 行必须先真实渲染过一次才有高度，所以这里是“先量后收”，不是按估算高度虚拟。
   */
  const [collapsedRows, setCollapsedRows] = useState<ReadonlyMap<string, number>>(() => new Map());
  const collapsedRowsRef = useRef<ReadonlyMap<string, number>>(collapsedRows);
  collapsedRowsRef.current = collapsedRows;
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const composerFloating = !panel && !isEmptyNew;
  // 停靠区实测高度。既进 CSS 变量（内容末端垫底：那层 padding 就是被输入条盖住、
  // 读者永远看不到的区域），也进贴底阈值——阈值必须把这层垫底排除掉，否则正常
  // 阅读位置（最后一条贴着卡片上沿）就已经离机械底一整段垫底，判成「未贴底」。
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    const dock = composerDockRef.current;
    const host = dock?.parentElement;
    if (!dock || !host || panel) return;
    const apply = () => {
      const height = dock.offsetHeight;
      host.style.setProperty("--composer-dock-h", `${height}px`);
      setDockHeight(height);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(dock);
    return () => {
      ro.disconnect();
      host.style.removeProperty("--composer-dock-h");
    };
  }, [panel]);
  /**
   * 停靠区高度就是内容末端的垫底（`--composer-dock-h`）。它是在 restore 之后才
   * 量到的，而还原时“底”里还没有这段垫底，于是最后一条（用量行）停在输入框背后
   * ——读者会认为“重进会话即物理贴底”。仅在读者本来就贴底时补一次。
   */
  /**
   * 窗口化：量一次真实行高，把视口上下各 1.5 屏之外的行收成等高占位（内容是
   * 消息组件树，收起即卸载：memo、语法高亮、图片、折叠状态全跟着走）。收与放
   * 高度相同，所以滚动位置、锚点还原、顶部前插保位、搜索定位都不受影响。
   * 保活槽隐藏时 `clientHeight` 为 0，量到的都是 0，直接跳过。
   */
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    if (!container || !content) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (container.clientHeight === 0) return;
      const contentTop = content.getBoundingClientRect().top;
      const rows: RowRect[] = [];
      for (const element of content.children) {
        if (!(element instanceof HTMLElement)) continue;
        const id = element.dataset.rowId;
        if (!id) continue;
        const rect = element.getBoundingClientRect();
        rows.push({ id, top: rect.top - contentTop, height: rect.height });
      }
      const next = computeRowWindow(rows, container.scrollTop, container.clientHeight).collapsed;
      if (sameRowWindow(next, collapsedRowsRef.current)) return;
      setCollapsedRows(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    container.addEventListener("scroll", schedule, { passive: true });
    return () => {
      container.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollContainerRef, messageContentRef, turnRendered.length, session?.id, loading, dockHeight]);
  useEffect(() => {
    setCollapsedRows((current) => (current.size === 0 ? current : new Map()));
  }, [session?.id]);
  /**
   * 停靠区高度是内容末端的垫底（`--composer-dock-h`），浮层输入条长高/缩矮都会改它。
   * 读者本来就贴底时把尾部跟上去，否则最后一行会被输入条盖住；不贴底就完全不动，
   * 交给浏览器原生锚定（输入框高度变化本身会触发滚动到底）。
   */
  const measuredDockHeightRef = useRef(0);
  useEffect(() => {
    const previous = measuredDockHeightRef.current;
    measuredDockHeightRef.current = dockHeight;
    if (previous === dockHeight) return;
    // 等一帧：官方先在挂载时落默认位置（`last-anchor`），贴不贴底要看它落完的结果。
    const frame = requestAnimationFrame(() => {
      if (!atTailRef.current) return;
      scrollerApiRef.current?.scrollToEnd({ behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [dockHeight]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-[560px]">
          <AlertDescription className="whitespace-pre-wrap wrap-anywhere">
            {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }


  return (
    <ActiveToolsContext value={activeToolsStore}>
    <div
      className="chat-content relative flex h-full min-w-0 flex-col overflow-hidden [padding-bottom:env(safe-area-inset-bottom,0px)]"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 始终挂载：流结束时（streamingMessage 为 null）发布 0，复位边光。 */}
      <StreamBeamPublisher store={streamingStore} channel={session?.id ?? newSessionDraftKey ?? "new"} background={background} />
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] motion-reduce:animate-none items-center justify-center bg-primary/[0.06] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-primary/50 animate-[drop-ripple_2.4s_ease-out_infinite_backwards] motion-reduce:animate-none"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-opacity="0.5" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="var(--accent)" fill-opacity="0.16" stroke="var(--accent)" stroke-opacity="0.4" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="var(--accent)" fill-opacity="0.22" stroke="var(--accent)" stroke-opacity="0.55" strokeWidth="1.6"/>
            <g stroke="var(--accent)" stroke-opacity="0.45" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      <div ref={setChatPaneElement} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {extensionDialog && (
          <ExtensionDialog
            key={extensionDialog.id}
            request={extensionDialog}
            waitingCount={waitingExtensionDialogCount}
            queueTotal={extensionDialogQueue.length + 1}
            answered={answeredDialogs}
            onRespond={handleDialogRespond}
          />
        )}
        {extensionCustomUi && (
          <ExtensionCustomPanel key={extensionCustomUi.id} request={extensionCustomUi} waitingCount={waitingExtensionCustomUiCount} onInput={sendExtensionCustomInput} />
        )}
        {!isEmptyNew && (loading ? (
          // 加载骨架占据消息列表区：顶栏与输入框照常渲染（此前整个布局被三根
          // 小条替换，用户反馈“小气而且不对”）。宽度参仿一段对话。骨架底色是全站
          // 统一的中性灰（`ui/skeleton` 的默认值），不跟主题色相。
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-[var(--chat-column-padding,40px)] pt-[22px] max-sm:px-6 max-sm:pt-4 animate-in fade-in duration-200">
            {/* 与消息列同一条居中列（CHAT_COLUMN_CLASS）：骨架不再通铺全宽。 */}
            <div className={cn(CHAT_COLUMN_CLASS, "flex flex-col gap-3")}>
              <Skeleton className="h-4 w-[38%]" />
              <Skeleton className="h-4 w-[55%]" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[80%]" />
              <Skeleton className="h-4 w-[60%]" />
              <Skeleton className="h-4 w-[45%]" />
            </div>
          </div>
        ) : <>
        {/* 完全按官方默认：`autoScroll` 常开（发送后跟随、流式跟随、图片撑高继续跟），
            `defaultScrollPosition="end"` 让打开会话落到底部，贴底容差 16px。
            不传 `scrollAnchor`（见 `components/chat/ChatRow.tsx`）：带上锚点时，任何
            内容变动都会让滚容器滚到“第一个未处理”的锚点行，即历史最顶部那条提问
            （回合结束重读会话后行 key 变化、子元素数量不变，曾因此跳顶并连带触发
            上翻取页）。没有锚点行时，只走 `following-bottom` 分支。 */}
        <MessageScrollerProvider
          autoScroll={advancedValues.autoScroll !== false}
          defaultScrollPosition={advancedValues.defaultScrollPosition === "last-anchor" ? "last-anchor" : "end"}
          // 「底」指输入条上沿，不指物理视口底：官方判据 `末行 bottom + 垫底 - scrollTop - clientHeight`
          // 实际上就是「从上滚离输入条上沿多少 px」，但它的零点在贴底位置（末行距上沿 8px），
          // 所以补上这 8px，设置里的吸附带才真是「末行离开输入条上沿多少 px 内仍算在底」。
          // 绝不能把整段垫底（dockHeight）也加进去：那是重复计入，按钮要往上滚一整个输入条高才出现。
          scrollEdgeThreshold={CONTENT_PAD_END_PX + Number(advancedValues.scrollEdgeThreshold ?? SCROLL_EDGE_THRESHOLD_DEFAULT)}
          scrollPreviousItemPeek={Number(advancedValues.scrollPreviousItemPeek ?? 64)}
        >
        <ScrollerBridge apiRef={scrollerApiRef} onAtTailChange={handleAtTailChange} onVisibleEntryChange={handleVisibleEntryChange} />
        <MessageScroller className="relative min-h-0 min-w-0 flex-1 animate-in fade-in duration-150">
        <MessageScrollerViewport ref={scrollContainerRef}>
          {/* 每行必须是 MessageScrollerItem 的直接子节点：官方 scroller 仅扫描 Content 的 children
              做测量、可见性、前插保位与贴底跟随，多包一层 div 会使这四项全部失效。纵向留白也放在
              Content 上，官方按 computed padding 计算内容末端。 */}
          <MessageScrollerContent
            ref={messageContentRef}
            onPointerUp={captureQuotedSelection}
            className="min-h-0 gap-[var(--chat-row-gap)] pt-[22px] pb-[calc(var(--composer-dock-h,0px)+8px)] max-sm:pt-4"
          >
            {/* “加载更早”排在 Content 子元素的最后、用 CSS `order-first` 放到最上面：
                官方的前插保位判定是「原先的首个子元素是否移到了 index > 0」，
                它若占在 DOM 首位则永远不动，`preserveScrollOnPrepend` 永不生效，
                前插就变成「内容往上塞、眼前整块往下掉」。视觉位置由 order 保持。 */}
            {turnRendered.map((node, index) => {
              // 每条消息一个 Item：官方据此测量、锚定并记录可视性。
              // 离屏行不做 `content-visibility` 跳过：估算高度会让新行先矮再撑开。非元素行（空渲染）原样返回。
              if (!isValidElement<{ "data-entry-id"?: string }>(node)) return node;
              // messageId 是官方 scroller 的 Item 身份（可见性、前插保位都按它跟踪），
              // 必须跨前插/追加稳定：优先 entryId，其次行自身的稳定 key
              //（entryId 或 live: 键），绝不回退到会随前插漂移的数组下标。
              const messageId = node.props["data-entry-id"]
                ?? (typeof node.key === "string" && node.key ? node.key : `turn-${index}`);
              // 窗口外只留占位高度、内容卸载（`--` 见 lib/chat-row-window.ts）：
              // 收起来的行高度与量到时相等，滚动位置、scrollToMessage、前插保位都不受影响。
              const placeholder = collapsedRows.get(messageId);
              return (
                <ChatRow
                  key={node.key ?? messageId}
                  messageId={messageId}
                >
                  {placeholder === undefined ? node : <div aria-hidden style={{ height: placeholder }} />}
                </ChatRow>
              );
            })}
            {/* 非条目行（流式回复、待执行命令）不是 Item 的测量对象，但仍需落在
                与行一致的列宽内。上收 10px：容器行距 16px 是普通消息行的节奏，
                而流式行紧跟的 TurnTrace 活动行内部只有 gap-1.5（6px），不减回
                差额，思考行会与上方活动行之间裂开一道两倍半的空隙。条件取
                “运行中”而不是“已有流式内容”：回复到达的首帧不能连带改变行的
                外边距，否则上下沿各跳一次。 */}
            <ChatRow className={agentRunning || isCompacting ? "-mt-2.5" : undefined}>
            {isStreaming && hasStreamingContent && (
              <StreamingReply store={streamingStore} messageKey={streamingMessageKey(entryIds, messages.length - entryIds.length)} toolResults={toolResultsMap} modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} />
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  ...pendingBash.result,
                  excludeFromContext: pendingBash.excludeFromContext,
                  // Its own card: a later command's does not open because this one was opened.
                  timestamp: pendingBash.startedAt,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}
            {pendingBash?.liveOutput && !pendingBash.result && (
              // Its last lines while it runs, at most as many rows once wrapped, as pi's
              // TUI previews a command: the box keeps the bottom rows, a long line's end.
              <div
                aria-live="off"
                className="-mt-0.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[12px] leading-[1.45] text-text-muted"
              >
                <pre
                  className="m-0 flex flex-col justify-end overflow-hidden whitespace-pre-wrap break-words"
                  style={{ maxHeight: `${liveOutputPreviewLines() * 1.45}em` }}
                >
                  <span>{liveOutputPreview(pendingBash.liveOutput)}</span>
                </pre>
              </div>
            )}

            </ChatRow>
            {hasMoreRendered && (
              // 手动入口：自动加载需等上一页渲染完成，此按钮允许随时请求一页。
              // 位置见上方注释：DOM 末位 + `order-first`。
              <Button
                ref={setSentinel}
                type="button"
                variant="ghost"
                onClick={() => {
                  if (loadingOlderRef.current || pageRenderingRef.current) return;
                  const sid = session?.id ?? sessionIdRef.current;
                  if (!sid || !historyCursor) return;
                  void loadOlderPage(sid, historyCursor);
                }}
                disabled={olderPageState !== "idle"}
                data-state={olderPageState}
                className="order-first mx-auto block h-auto rounded-lg px-3 py-3 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-60"
              >
                {olderPageState === "idle" ? t("chat.loadEarlier") : t("chat.loadingEarlier")}
              </Button>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* 位置取自实测停靠区高度而非 `--composer-dock-h`：变量由 ResizeObserver
            首帧之后才写入，缺失时 fallback 为 0，按钮会落到页面物理底部。
            尚未量到时整颗隐藏，避免错位。 */}
        <MessageScrollerButton
          behavior="instant"
          style={{ bottom: dockHeight + 16 }}
          className={`text-muted-foreground transition-opacity hover:text-foreground [@media(hover:hover)]:opacity-30 [@media(hover:hover)]:hover:opacity-100${dockHeight > 0 ? "" : " invisible"}`}
        >
          <ArrowDownIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("chat.scrollToLatest")}</span>
        </MessageScrollerButton>
        </MessageScroller>
        </MessageScrollerProvider>
        {isMobile || !minimapPaneWide || advancedValues.showMinimap === false ? null : (
          <ChatMinimap
            messages={messages}
            entryIds={entryIds}
            getStreamingMessage={getStreamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
            onRevealTurn={revealTurnForMinimap}
            turnsBefore={earlierTurnCount}
            turnIndex={minimapTurnIndex}
          />
        )}
        </>)}
      </div>

      {quoteSelectionEnabled && quotedSelection && createPortal(
        <div
          ref={quotePopoverRef}
          role={quoteInputOpen ? "dialog" : "toolbar"}
          aria-label={t(quoteInputOpen ? "chat.newQuoteChat" : "chat.selectionActions")}
          className={cn(
            "fixed z-(--z-selection-toolbar) flex flex-wrap items-start gap-[3px] max-w-[calc(100vw-16px)] max-h-[calc(var(--app-viewport-height,100dvh)-16px)] overflow-y-auto rounded-md border border-border bg-popover shadow-md",
            quoteInputOpen ? "w-[min(420px,calc(100vw-16px))] p-3" : "p-[3px]",
          )}
          style={{
            top: quotedSelection.top,
            left: quotedSelection.left,
          }}
        >
          {quoteInputOpen ? (
            <fieldset
              disabled={quoteSubmitting}
              aria-busy={quoteSubmitting}
              className="m-0 flex w-full min-w-0 flex-col gap-2.5 border-0 p-0"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs font-semibold">{t(quoteAskTarget === "side" ? "chat.askInSideChat" : "chat.askInNewChat")}</span>
                <Button type="button" variant="ghost" size="icon-sm" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={quoteSubmitting} onClick={closeQuotedSelection}>
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <ChatInput
                ref={quoteChatInputRef}
                compact
                onSend={quoteAskTarget === "side" ? askSelectionInSideChat : askSelectionInNewChat}
                onAbort={closeQuotedSelection}
                isStreaming={false}
              />
              {quoteError && <div role="alert" className="text-xs text-destructive wrap-anywhere">{quoteError}</div>}
            </fieldset>
          ) : <>
          <Button
            type="button"
            variant="ghost"
            title={t("chat.quoteSelection")}
            aria-label={t("chat.quoteSelection")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={quoteSelectionHere}
            className="h-[35px] gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <QuoteIcon data-icon="inline-start" strokeWidth={1.8} aria-hidden="true" />
            <span>{t("chat.quoteSelection")}</span>
          </Button>
          {onSideSession && !isHiddenRelation(session?.relation) && (
            <Button
              type="button"
              variant="ghost"
              title={t("chat.askInSideChat")}
              aria-label={t("chat.askInSideChat")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { setQuoteAskTarget("side"); setQuoteInputOpen(true); window.getSelection()?.removeAllRanges(); }}
              className="h-[35px] gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <MessagesSquareIcon data-icon="inline-start" strokeWidth={1.8} aria-hidden="true" />
              <span>{t("chat.askInSideChat")}</span>
            </Button>
          )}
          {onAskInNewChat && (
            <Button
              type="button"
              variant="ghost"
              title={t("chat.askInNewChat")}
              aria-label={t("chat.askInNewChat")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { setQuoteAskTarget("new"); setQuoteInputOpen(true); window.getSelection()?.removeAllRanges(); }}
              className="h-[35px] gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <GitForkIcon data-icon="inline-start" strokeWidth={1.8} aria-hidden="true" />
              <span>{t("chat.askInNewChat")}</span>
            </Button>
          )}
          </>}
        </div>,
        document.body,
      )}

      {/* 底部停靠区：运行状态行、排队条与输入框。底边留白由停靠区统一承担
          （pb-3），扩展状态行可有可无，出现/消失不会改变输入框与屏幕底边的距离。
          桌面主聊天浮动在消息之上（chat-content 相对定位）：消息列延伸到卡片背后，
          只有贴近卡片的部分被卡片的羽化光晕遮住。手机（max-sm）停靠在文档流里：
          滚区的底就是停靠区顶，队列/速率/扩展行/键盘改变高度时滚区自身伸缩，
          “底”永远贴着输入条顶沿，不再需要任何垫底补偿；滚动全部发生在可视区，
          消息不会被输入条盖住。空态与侧面板（panel）保持文档流。 */}
      <div
        ref={composerDockRef}
        className={cn(
          "chat-composer-dock relative flex min-h-0 flex-col pb-3",
          CHAT_PAGE_GUTTER_CLASS,
          composerFloating
            ? "absolute inset-x-0 z-30 bottom-[env(safe-area-inset-bottom,0px)]"
            : "shrink-0",
        )}
      >
        {/* The brand (the logo, "Pi Web" and its versions line), then the
            project/worktree row right above the composer, all on the
            composer's left edge. */}
        {isEmptyNew && (
          <div className="new-session-hero max-md:px-4 md:px-4">
            <div className={cn("new-session-hero-inner flex flex-col items-start", CHAT_COLUMN_CLASS)}>
              <div className="new-session-brand flex min-w-0 items-center gap-3 mb-5 max-[640px]:mb-4">
                <Image src="/icons/logo.svg" width={120} height={120} alt="" priority unoptimized className="new-session-logo size-30 shrink-0 max-[640px]:size-8" />
                <div className="new-session-brand-text flex min-w-0 flex-col gap-0.5 font-mono">
                  <span className="new-session-brand-name text-xl font-semibold leading-[1.15] whitespace-nowrap text-foreground max-[640px]:text-xl">Pi Web</span>
                  <span className="new-session-meta flex min-w-0 items-center gap-1.5 text-xs leading-[1.4] whitespace-nowrap text-muted-foreground [&>*]:flex-none">
                    <span>web v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                    <span aria-hidden="true">·</span>
                    <span className="new-session-meta-pi min-w-0 overflow-hidden text-ellipsis">pi v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                  </span>
                </div>
              </div>
              <div className="flex w-full justify-start">{newSessionContextBar}</div>
            </div>
          </div>
        )}
        {/* 运行状态行（阶段文案 + 流式速率）已移进输入框：位于队列之下、输入卡片
            正上方。队列长高只往聊天区方向长，状态行不再被顶走。 */}
        {renderChatInput(activityNotice)}
        {(advancedValues.showExtensionStatus !== false || advancedValues.showExtensionWidgets !== false) && (
          <AnimatedExtensionStatusBar
            statuses={advancedValues.showExtensionStatus === false ? [] : extensionStatuses}
            widgets={advancedValues.showExtensionWidgets === false ? [] : extensionWidgets}
            onCommand={handleSend}
            commandsDisabled={sessionBusy}
          />
        )}
      </div>
      {/* 手机端底部留白占偏置的两份（顶部聊天列仍为一份），使空态的 hero+composer
          簇高于正中：保持簇完整，品牌块不与浮层重叠。 */}
      {isEmptyNew && <div className="min-h-0 flex-1 max-sm:flex-[2]" />}
    </div>
    {/* 💡灵感：会话隔离；灵感按 session.id 归档，新会话（无 session）不挂。 */}
    {session && (
      <InspirationDialog
        sessionId={session.id}
        open={inspirationOpen}
        onOpenChange={setInspirationOpen}
        onImplement={handleImplementInspiration}
      />
    )}
    </ActiveToolsContext>
  );
});
