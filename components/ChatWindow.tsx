"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { isHiddenRelation } from "@/lib/session-family";
import { ArrowDownIcon, GitForkIcon, MessagesSquareIcon, QuoteIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentMessage, AssistantMessage, BashExecutionMessage, BlockingExtensionUiRequest, ExtensionUiRequest, MinimapTurnDescriptor, SessionInfo, SessionTreeNode, TextContent, ToolResultMessage, UserMessage } from "@/lib/types";import { isTuiText, normalizeCustomPanelLines, stripAnsi } from "@/lib/ansi";
import { splitNoticeText } from "@/lib/notice-text";
import { EXTENSION_DIALOG_BASE_WIDTH, fitExtensionDialogWidth } from "@/lib/extension-dialog-fit";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { isHiddenCustomMessage, isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import { getToolCategory, TOOL_CATEGORY_LABEL_KEYS, type ToolCategory } from "@/lib/tool-categories";
import { buildTurnActivityItems, getFinishedTurnView } from "@/lib/turn-view";
import { type WrittenFile } from "@/lib/turn-written-files";
import { buildQuotedSelection } from "@/lib/quoted-selection";
import { dropMentionText, splitDroppedItems, uploadFiles, type DroppedItem } from "@/lib/file-upload-client";
import { MessageView, formatTime, getModelDisplayName } from "./MessageView";
import { TurnActivityBody, TurnMetaLine } from "./ActivityRows";
import { MarkdownBody } from "./MarkdownBody";
import { ChatInput, getUserMessageDraftImages, getUserMessageText, type ChatInputHandle } from "./ChatInput";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { ChatMinimap, useMessageRefs, MINIMAP_MIN_PANE_WIDTH } from "./ChatMinimap";
import { AnsiText } from "./AnsiText";
import { TurnTrace } from "./transcript/TurnTrace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { ChatRow } from "@/components/chat/ChatRow";
import { CHAT_COLUMN_CLASS, CHAT_PAGE_GUTTER_CLASS } from "@/lib/chat-layout";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TuiText } from "./TuiText";
import { useI18n } from "@/hooks/useI18n";
import { formatTurnDuration, getTurnDurationMs } from "@/lib/turn-duration";
import { phaseLabel } from "@/lib/chat-phase-label";
import { useAgentSession, type AgentEndInfo, type NewSessionChoices, type NoticeItem } from "@/hooks/useAgentSession";
import { selectHasStreamingContent, selectIsStreaming, selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import { publishStreamCharacters } from "@/lib/stream-beam";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDialogMaxHeight } from "@/hooks/useDialogMaxHeight";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { DebugClientSession } from "@/lib/debug-types";
import type { ToolEntry } from "@/lib/tool-presets";
import type { SettingsSection } from "@/lib/settings-navigation";
import { findChatScrollAnchor, type ChatScrollPosition } from "@/lib/chat-scroll-position";
import { shouldFollow } from "@/lib/chat-follow";
import {
  getNextVisibleCount,
  getPromptAnchorSpacerHeight,
  getVisibleRenderWindow,
  isScrollAtTail,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
import { SCROLL_ANCHOR_SETTLE_MS, applyScrollAnchor, captureScrollAnchor, holdScrollAnchor, type ScrollAnchor } from "@/lib/scroll-anchor";

/** 判定贴顶的容差：触摸惯性下滚动值带小数，难以精确归零。 */
const TOP_SLACK = 24;
/** 前插一页后等待其落位的最长帧数；超时即放行，避免闸门卡死。 */
const PREPEND_SETTLE_FRAMES = 12;
/** 两次自动取页之间的最小间隔：连续滚动事件不应把多页挤进同一次操作。 */
const AUTO_LOAD_MIN_INTERVAL_MS = 400;

/**
 * 读取当前滚动位置：贴尾记为 atBottom，否则记录视口顶部条目及其偏移。
 * 保存会话位置与保活槽隐藏前的快照共用此实现。
 */
function readScrollPosition(
  container: HTMLElement,
  content: HTMLElement | null,
  oldestEntryId: string | null,
): ChatScrollPosition | null {
  if (isScrollAtTail(container.scrollTop, container.clientHeight, container.scrollHeight)) return { atBottom: true };
  if (!content) return null;
  const viewportTop = container.getBoundingClientRect().top;
  const candidates = Array.from(content.children).flatMap((element) => {
    if (!(element instanceof HTMLElement) || !element.dataset.entryId) return [];
    const rect = element.getBoundingClientRect();
    return [{ entryId: element.dataset.entryId, top: rect.top, bottom: rect.bottom }];
  });
  const anchor = findChatScrollAnchor(candidates, viewportTop);
  if (!anchor) return null;
  return { atBottom: false, ...anchor, oldestEntryId };
}

interface Props {
  session: SessionInfo | null;
  searchTarget?: { sessionId: string; entryId: string; blockIndex?: number } | null;
  onSearchTargetHandled?: (target: { sessionId: string; entryId: string }) => void;
  initialScrollPosition?: ChatScrollPosition | null;
  /**
   * 该实例是否为当前可见会话。保活 dock 以 `display:none` 隐藏非当前槽位，隐藏会使
   * `scrollTop`/`scrollHeight` 归零；切回时须先还原位置，顶部加载器才不会把 0 视为贴顶。
   */
  active?: boolean;
  onScrollPositionChange?: (sessionId: string, position: ChatScrollPosition) => void;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  /** Shown above the composer while a fresh composer is still empty: where its session starts. */
  newSessionContextBar?: ReactNode;
  /** A fresh composer's model and reasoning picks, carried from the composer it replaces. */
  initialNewSessionChoices?: NewSessionChoices | null;
  onNewSessionChoicesChange?: (choices: NewSessionChoices) => void;
  onAgentEnd?: (end: AgentEndInfo) => void;
  onToolEnd?: (toolName: string) => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
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
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  /** Opens Settings on a section: a bare `/mcp` that pi's built-in MCP extension owns opens Settings › MCP. */
  onOpenSettings?: (section: SettingsSection) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  /** Files dropped onto the chat were written into the working directory. */
  onFilesUploaded?: () => void;
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
 * 官方 scroller 的跟随模式（`following-bottom`）会被 wheel/touch/按键、scrollTop 变小、
 * 点击跳转等打断，仅挂载与其自身 `scrollToEnd` 能恢复。因此由本组件接管：`atTail` 为真
 * 期间内容长高即再次调用 `scrollToEnd`，读者上滑超过 8px 后 `atTail` 变假并停止干涉。
 */
function FollowTailWhenAtTail({ atTail, contentRef }: {
  atTail: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => {
    if (!atTail) return;
    const content = contentRef.current;
    if (!content) return;
    let frame = 0;
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrollToEnd({ behavior: "instant" });
      });
    };
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    follow();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [atTail, contentRef, scrollToEnd]);
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
export const ChatWindow = memo(function ChatWindow({ session, searchTarget, onSearchTargetHandled, initialScrollPosition, active = true, onScrollPositionChange, sessionRunning, newSessionCwd, newSessionDraftKey, newSessionContextBar, initialNewSessionChoices, onNewSessionChoicesChange, onAgentEnd, onToolEnd, onAttentionNeeded, onSessionCreated, onSessionForked, panel = false, onSideSession, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onMcpServersChange, onSystemInfoLoaderChange, onDebugSnapshotReaderChange, background = false, dormant = false, onSessionStatsChange, onSessionStatsPanelOpen, onOpenSettings, onContextUsageChange, onOpenFile, onFilesUploaded, onOpenSubagent, onAskInNewChat, quoteSelectionEnabled = false, initialPrompt, onInitialPromptConsumed, soundEnabled = true, playDoneSound = () => {}, unlockAudio, holdAudio }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
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
  const wrappedOnAgentEnd = useCallback((end: AgentEndInfo) => {
    // A run someone stopped did not finish anything, and one whose subagents still work did not finish the task.
    if (completionNotificationsEnabled && soundEnabledRef.current && !end.aborted && !end.subagentsActive) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.(end);
  }, [completionNotificationsEnabled, onAgentEnd]);

  const initialScrollPositionRef = useRef(searchTarget ? null : initialScrollPosition ?? null);
  const [pendingScrollRestore, setPendingScrollRestore] = useState<Extract<ChatScrollPosition, { atBottom: false }> | null>(() => {
    const position = initialScrollPositionRef.current;
    return position && !position.atBottom ? position : null;
  });
  const [restoreAnchorReady, setRestoreAnchorReady] = useState(false);

  const {
    loading, error, messages, activeToolResults, entryIds, historyCursor, hasEarlierMessages, earlierTurnCount, hasNewerMessages, newestCursor, streamingStore,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, missingCwd, modelScopeWarnings, isModelScopeActive, allModelList, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedSubmissions,
    notices, extensionDialog, extensionDialogQueue, waitingExtensionDialogCount, extensionCustomUi, waitingExtensionCustomUiCount, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput, setNoticePaused, dismissNotice, addNotice,
    isAutoModelSelection,
    isAutoThinkingSelection,
    defaultModel,
    savedDefaultThinkingLevel,
    agentPhase,
    isNew,
    sessionIdRef, scrollContainerRef,
    lastUserMsgRef, promptAnchorActive,
    handleSend, handleAbort, startSideChat, handleFork, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleQueuedAction, handleEditContent, dismissCompactError, editEntryId, cancelEdit,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, handleSetDefaultModel, handleSetDefaultThinkingLevel, loadSlashCommands, loadAllModels, scrollUserMsgToTop,
    loadContext, activeLeafId, scrollToBottom, scrollToMessage, jumpToEntry, loadNewerPage,
  } = useAgentSession({
    session, sessionRunning, newSessionCwd, newSessionDraftKey, initialNewSessionChoices, onNewSessionChoicesChange, onAgentEnd: wrappedOnAgentEnd, onToolEnd, onAttentionNeeded, onSessionCreated, onSessionForked, onSideSession,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onMcpServersChange, onSystemInfoLoaderChange, onSessionStatsPanelOpen,
    background,
    dormant,
    onOpenSettings, onDebugSnapshotReaderChange, t,
    deferInitialScroll: Boolean(pendingScrollRestore),
  });
  // Only whether a reply is streaming and has content yet: the chunks themselves
  // re-render StreamingReply alone.
  const isStreaming = useStreamingSelector(streamingStore, selectIsStreaming);
  const hasStreamingContent = useStreamingSelector(streamingStore, selectHasStreamingContent);
  const streamingMessage = useStreamingSelector(streamingStore, selectStreamingMessage);
  // streamState shape kept from the dev hook contract; derived from the store selectors.
  const streamState = useMemo(() => ({ isStreaming, streamingMessage }), [isStreaming, streamingMessage]);
  // 当前流的字符数，供输入框边光使用：发布到 `lib/stream-beam`，由被 memo 的输入框
  // 自行订阅，避免每个 chunk 更换 prop。
  const streamCharacters = useMemo(() => {
    let total = 0;
    for (const block of streamingMessage?.content ?? []) {
      if (block.type === "text") total += block.text.length;
      else if (block.type === "thinking") total += block.thinking.length;
    }
    return total;
  }, [streamingMessage]);
  useEffect(() => {
    // 后台会话不写：计数器按会话隔离，它的字符数也只属于它自己。
    if (background) return;
    publishStreamCharacters(session?.id ?? newSessionDraftKey ?? "new", streamCharacters);
  }, [streamCharacters, background, session?.id, newSessionDraftKey]);
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
      if (event.key !== "Escape" || event.isComposing) return;
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
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
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
    const params = activeLeafId ? `?leafId=${encodeURIComponent(activeLeafId)}` : "";
    fetch(`/api/sessions/${encodeURIComponent(sid)}/turns${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { turns?: MinimapTurnDescriptor[] } | null) => {
        if (data && Array.isArray(data.turns)) setMinimapTurnIndex(data.turns);
      })
      .catch(() => {
        // Aborted or transient; the minimap lists loaded turns only.
      });
    return () => controller.abort();
  }, [session?.id, activeLeafId]);
  // State, not a ref: the sentinel can appear with nothing else changing (a
  // finished turn regrouped into more rows), and must get an observer then.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  /** 展开/折叠行的若干帧内禁用贴底跟随，否则该行会被拉上去。 */
  const [foldInFlight, setFoldInFlight] = useState(false);
  /**
   * 读者是否贴底。贴底跟随是官方 scroller 的内部状态：若传入恒为 true 的 `autoScroll`，
   * 前插整页时会被当作跟随而滑到底部，导致翻页时在底与顶之间跳动。
   */
  const [atTail, setAtTail] = useState(true);
  const foldTimerRef = useRef<number | undefined>(undefined);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
  /** 上一页请求进行中。 */
  const loadingOlderRef = useRef(false);
  /**
   * 自动加载是否可用。每取一页即用掉一次，只有读者真的滚动才重新武装：闸门放行后
   * 若自行重试，前插还没落位的那几帧仍判为贴顶，会连续取页。
   */
  const autoLoadArmedRef = useRef(true);
  /** 上一次自动取页的时刻，用于拦截同一串滚动事件里的连续取页。 */
  const lastAutoLoadAtRef = useRef(0);
  /**
   * 上一页已落地但尚未渲染并绘制一帧。此时再次请求会使两页前插互相推动、滚动锚点抖动，
   * 因此闸门比请求返回关闭得更晚。
   */
  const pageRenderingRef = useRef(false);
  const pageRenderWaitersRef = useRef<Array<() => void>>([]);
  const [olderPageState, setOlderPageState] = useState<"idle" | "loading" | "rendering">("idle");
  const restoreStartedRef = useRef(false);
  const pendingScrollRestoreRef = useRef(pendingScrollRestore);
  pendingScrollRestoreRef.current = pendingScrollRestore;
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
  const loadOlderPage = useCallback(async (sid: string, before: string, options?: { tail?: number; signal?: AbortSignal }) => {
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
  const revealTurnForMinimap = useCallback(async (turnNumber: number) => {
    const sid = session?.id;
    const target = minimapTurnIndex[turnNumber];
    if (!sid || !target) return;
    if (!searchHistoryRef.current.entryIds.includes(target.entryId)) {
      const context = await jumpToEntry(sid, activeLeafId, target.entryId);
      if (!context) return;
      setVisibleCount((current) => Math.max(current, context.messages.length));
      return;
    }
    setVisibleCount((current) => Math.max(current, messagesLenRef.current));
  }, [session?.id, minimapTurnIndex, activeLeafId, jumpToEntry]);
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

  useLayoutEffect(() => {
    const sessionId = session?.id;
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    if (!sessionId || !onScrollPositionChange || !container || !content) return;
    return () => {
      if (pendingScrollRestoreRef.current) return;
      const position = readScrollPosition(container, content, searchHistoryRef.current.historyCursor);
      if (position) onScrollPositionChange(sessionId, position);
    };
  }, [loading, onScrollPositionChange, scrollContainerRef, session?.id]);

  // 保活槽以 `display:none` 隐藏时，scrollTop 与 scrollHeight 会被清为 0。切回的第一帧
  // 必须还原位置：顶部加载器只读 scrollTop，晚一帧即会把 0 视为贴顶而连续加载至顶部。
  const savedScrollRef = useRef<ChatScrollPosition | null>(null);
  const scrollRestoringRef = useRef(false);
  const wasActiveRef = useRef(active);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!container) return;
    if (!active) {
      if (!wasActive || pendingScrollRestoreRef.current) return;
      // 此时容器多为 `display:none`（0/0/0 会被判为贴尾），改用滚动时记录的位置；
      // 仅当容器仍可测高时才现量。
      const measured = container.clientHeight > 0
        ? readScrollPosition(container, content, searchHistoryRef.current.historyCursor)
        : null;
      savedScrollRef.current = measured ?? liveScrollRef.current;
      return;
    }
    if (wasActive) return;
    const saved = savedScrollRef.current;
    if (!saved) {
      // 挂载于隐藏槽位的会话：provider 的默认位置在 clientHeight 为 0 时已被消耗，
      // 切回时既无默认位置也无记录，直接定位到最新一条。
      container.scrollTop = container.scrollHeight;
      liveScrollRef.current = { atBottom: true };
      return;
    }
    liveScrollRef.current = saved;
    // 还原期间禁止顶部加载器介入，也禁止贴底跟随改写位置。
    scrollRestoringRef.current = true;
    if (saved.atBottom || !content) {
      container.scrollTop = container.scrollHeight;
    } else {
      const anchorEntryId = saved.anchorEntryId;
      const anchorOffset = saved.anchorOffset;
      const anchor = Array.from(content.children).find((child): child is HTMLElement => (
        child instanceof HTMLElement && child.dataset.entryId === anchorEntryId
      ));
      if (anchor) {
        container.scrollTop += (anchor.getBoundingClientRect().top - container.getBoundingClientRect().top) - anchorOffset;
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
    const frame = requestAnimationFrame(() => { scrollRestoringRef.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [active, scrollContainerRef]);

  useEffect(() => {
    if (searchTarget) setPendingScrollRestore(null);
  }, [searchTarget]);

  // 保活槽以 `display:none` 隐藏时 scrollTop 与 scrollHeight 会被清为 0，故须在其可见时
  // 记录读者位置：每次滚动记录一份，隐藏那一帧使用该记录。
  const liveScrollRef = useRef<ChatScrollPosition | null>(null);
  // 监听器需读取当前可见状态，故用 ref 而非闭包中的旧 prop。
  const activeRef = useRef(active);
  activeRef.current = active;
  // 跟随状态仅由滚动决定，判定交给 `shouldFollow`：8px 贴底容差只用于“回到最新”
  // 按钮，跟随使用 48px，因触控板一次惯性可达数十像素。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let following = true;
    let previousTop = container.scrollTop;
    const update = () => {
      const next = shouldFollow(
        following,
        previousTop,
        container.scrollTop,
        container.clientHeight,
        container.scrollHeight,
      );
      following = next;
      previousTop = container.scrollTop;
      setAtTail(next);
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [scrollContainerRef, session?.id, loading]);

  // 在同一批滚动事件中记录读者位置：保活槽被 `display:none` 隐藏后 scrollTop 与
  // scrollHeight 归零，届时无法测量。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let frame = 0;
    const remember = () => {
      frame = 0;
      if (!activeRef.current || container.clientHeight === 0) return;
      liveScrollRef.current = readScrollPosition(container, messageContentRef.current, searchHistoryRef.current.historyCursor);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(remember);
    };
    remember();
    container.addEventListener("scroll", schedule, { passive: true });
    return () => {
      container.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollContainerRef, session?.id, loading]);

  // Expanding a collapsed thinking row or tool card grows the content. While
  // the user reads at the tail, keep the tail in view instead of letting the
  // Expanding a collapsed row no longer kicks the list: `components/transcript/TraceRow.tsx`
  // keeps the toggled row's own top edge fixed across the change, so opening a card
  // grows it downward instead of scrolling the tail into view.

  // 展开/折叠行期间关闭贴底跟随：行保持在原位、内容向下增长，避免先上拉后补内容
  // 造成的闪动。
  useEffect(() => {
    const onFold = () => {
      setFoldInFlight(true);
      window.clearTimeout(foldTimerRef.current);
      foldTimerRef.current = window.setTimeout(() => setFoldInFlight(false), 260);
    };
    window.addEventListener("pi-web:trace-fold", onFold);
    return () => {
      window.removeEventListener("pi-web:trace-fold", onFold);
      window.clearTimeout(foldTimerRef.current);
    };
  }, []);

  // 键盘收起由壳层整体位移实现（`.app-shell` 的 translate3d），列表布局高度不变，
  // 贴底跟随自然停在原位；此处不再额外平滑滚动，以免与壳层位移争用同一帧。

  // 键盘弹起时不写回滚动位置：官方 scroller 自行区分贴尾与浏览历史，手动回写
  // scrollTop/window.scrollY 会在视口缩高的那一帧把列表拉回。

  useEffect(() => {
    const position = pendingScrollRestore;
    const sessionId = session?.id;
    if (!position || !sessionId || loading || searchTarget || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const controller = new AbortController();

    const locate = async () => {
      const initialHistory = searchHistoryRef.current;
      if (initialHistory.entryIds.includes(position.anchorEntryId)) {
        setVisibleCount((current) => Math.max(current, initialHistory.entryIds.length * 2));
        setRestoreAnchorReady(true);
        return;
      }

      loadingOlderRef.current = true;
      let before = initialHistory.historyCursor;
      let hasMore = initialHistory.hasEarlierMessages;
      try {
        while (hasMore && before && !controller.signal.aborted) {
          const context = await loadOlderPage(sessionId, before, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!context) {
            scrollToBottom("instant");
            setPendingScrollRestore(null);
            return;
          }
          setVisibleCount((current) => current + Math.max(VISIBLE_PAGE_SIZE, context.messages.length * 2));
          if (context.entryIds.includes(position.anchorEntryId)) {
            setRestoreAnchorReady(true);
            return;
          }
          if (context.oldestEntryId === position.oldestEntryId) break;
          before = context.oldestEntryId;
          hasMore = context.hasMore;
        }
        if (!controller.signal.aborted) {
          scrollToBottom("instant");
          setPendingScrollRestore(null);
        }
      } finally {
        loadingOlderRef.current = false;
      }
    };

    void locate();
    return () => {
      controller.abort();
      // A branch change cancels restoration and must reveal the new context.
      setPendingScrollRestore(null);
    };
  }, [activeLeafId, loadOlderPage, loading, pendingScrollRestore, scrollToBottom, searchTarget, session?.id]);

  useLayoutEffect(() => {
    const position = pendingScrollRestore;
    const content = messageContentRef.current;
    if (!position || !content || searchTarget) return;
    const element = Array.from(content.children).find((candidate) => (
      candidate instanceof HTMLElement && candidate.dataset.entryId === position.anchorEntryId
    ));
    if (element instanceof HTMLElement) {
      scrollToMessage(element, position.anchorOffset);
      setPendingScrollRestore(null);
      return;
    }
    if (restoreAnchorReady) {
      scrollToBottom("instant");
      setPendingScrollRestore(null);
    }
  }, [entryIds, pendingScrollRestore, restoreAnchorReady, scrollToBottom, scrollToMessage, searchTarget, visibleCount]);

  useEffect(() => {
    if (!searchTarget || loading) return;
    const controller = new AbortController();
    const locate = async () => {
      const history = searchHistoryRef.current;
      let found = history.entryIds.includes(searchTarget.entryId);
      if (!found && !sessionBusy && history.hasEarlierMessages && history.historyCursor && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        const container = scrollContainerRef.current;
        if (container) scrollAnchorRef.current = captureScrollAnchor(container, messageContentRef.current);
        // ponytail: one extra page, the same size scrolling reads; an older or other-branch hit just opens the session.
        const context = await loadOlderPage(searchTarget.sessionId, history.historyCursor, { signal: controller.signal });
        loadingOlderRef.current = false;
        found = Boolean(context?.entryIds.includes(searchTarget.entryId));
      }
      if (controller.signal.aborted) return;
      if (found) {
        scrollAnchorRef.current = null;
        setVisibleCount((current) => Math.max(current, (searchHistoryRef.current.entryIds.length + 200) * 2));
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
    if (element) {
      scrollToMessage(element);
      element.animate([
        { backgroundColor: "var(--accent)" },
        { backgroundColor: "transparent" },
      ], { duration: 2500 });
    }
    setPendingSearchScroll(null);
    onSearchTargetHandled?.(pendingSearchScroll);
  }, [pendingSearchScroll, searchTarget, searchMessage, scrollContainerRef, scrollToMessage, onSearchTargetHandled]);

  // 贴顶时自动加载下一页。IntersectionObserver 仅在交叉状态变化时回调，哨兵持续可见
  // 时不再上报，故改为监听 scroll：贴顶即尝试一次，且每次自动取页只允许由一次滚动
  // 或首屏进入触发。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const attempt = () => {
      // 隐藏槽位、正在写回位置的帧、以及等待分页锚点落地的会话均不计为贴顶。
      if (scrollRestoringRef.current || pendingScrollRestoreRef.current || !activeRef.current) return;
      if (container.scrollTop > TOP_SLACK) return;
      // Skip while a page is loading or the last one is still rendering.
      if (loadingOlderRef.current || pageRenderingRef.current) return;
      if (performance.now() - lastAutoLoadAtRef.current < AUTO_LOAD_MIN_INTERVAL_MS) return;
      if (!hasEarlierMessages) {
        // Everything is loaded, yet the sentinel shows: the messages render as
        // more rows than the window holds (an answer and its thinking are
        // two), so widen the window.
        scrollAnchorRef.current = captureScrollAnchor(container, messageContentRef.current);
        autoLoadArmedRef.current = false;
        lastAutoLoadAtRef.current = performance.now();
        setVisibleCount((current) => getNextVisibleCount(current));
        return;
      }
      autoLoadArmedRef.current = false;
      lastAutoLoadAtRef.current = performance.now();
      // Fetch the previous page from the server and prepend it (loadContext
      // handles prepend + scroll anchoring).
      const oldestId = historyCursor;
      // Its page already landed; the next cursor has not rendered yet.
      if (!oldestId || oldestId === requestedCursorRef.current) return;
      const sid = session?.id ?? sessionIdRef.current;
      if (!sid) return;
      loadingOlderRef.current = true;
      // 使用元素锚点而非 scrollHeight 差值：新页中的 markdown、代码高亮与图片分帧长高，
      // 高度差只能补第一帧，读者会被留在近顶部；锚点在页面落地后每帧重测，不随高度漂移。
      scrollAnchorRef.current = captureScrollAnchor(container, messageContentRef.current);
      void loadOlderPage(sid, oldestId).then(() => {
        // 固定读者所在行：新页只向下增长，并使滚动位置离开顶端，否则哨兵持续可见会
        // 连续加载。
        holdScrollAnchor(container, messageContentRef.current);
      }).finally(() => {
        loadingOlderRef.current = false;
      });
    };
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        attempt();
      });
    };
    // 只在真实输入下重新武装：前插后的锚点写入、位置还原都会触发 scroll，若以 scroll
    // 作为武装信号，一次手势即可连续取页。
    const arm = () => {
      autoLoadArmedRef.current = true;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", arm, { passive: true });
    container.addEventListener("touchstart", arm, { passive: true });
    container.addEventListener("pointerdown", arm, { passive: true });
    container.addEventListener("keydown", arm);
    // 首次也尝试一次（贴顶打开的会话不会触发滚动事件）；闸门放行导致的重建只有在
    // 武装时才会再试，否则会连跳多页。
    if (autoLoadArmedRef.current) attempt();
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", arm);
      container.removeEventListener("touchstart", arm);
      container.removeEventListener("pointerdown", arm);
      container.removeEventListener("keydown", arm);
      if (frame) cancelAnimationFrame(frame);
    };
    // `olderPageState` 为刻意依赖：上一页落地并绘制后 effect 重建，内容撑不满一屏
    // 时闸门会重新武装并在此接续，无需再次滚动。
  }, [sentinel, visibleCount, historyCursor, hasEarlierMessages, session, loadOlderPage, sessionIdRef, scrollContainerRef, olderPageState]);

  // Keep the rendered window at least as large as what's loaded, so prepended
  // (older) pages stay visible instead of being sliced off the top.
  useEffect(() => {
    setVisibleCount((current) => Math.max(current, messages.length));
  }, [messages.length]);

  // Clear the page gate once the prepended rows are in the rendered window and a
  // frame has been painted. Until then the sentinel and the row stay inert, so
  // two pages can never be in flight with one still half-rendered.
  // `olderPageState` is in the deps so a page that prepended nothing (the server
  // repeated the cursor) still releases the gate instead of wedging it shut.
  useLayoutEffect(() => {
    if (!pageRenderingRef.current) return;
    if (visibleCount < messages.length) return;
    const container = scrollContainerRef.current;
    const notFull = () => !container || container.scrollHeight <= container.clientHeight + TOP_SLACK;
    const release = () => {
      pageRenderingRef.current = false;
      // 内容撑不满一屏时读者无法靠滚动再触发，放行后允许直接续取。
      if (notFull()) autoLoadArmedRef.current = true;
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
        if (settled || frames >= PREPEND_SETTLE_FRAMES) {
          release();
          return;
        }
        settle();
      });
    };
    settle();
    return () => cancelAnimationFrame(frame);
  }, [visibleCount, messages.length, olderPageState]);

  // Read one more page only when the reader asks for it (the sentinel at the top
  // or the "load earlier" row). Reading the whole branch up front put dozens of
  // page-sized prepends on screen while the reader was still at the tail, which
  // is what made loading look like it was jumping around.

  // After visibleCount increases (older messages prepended) put the row the
  // reader was looking at back where it was — and keep it there while the rows
  // above settle (markdown, highlighting, images all report their height late).
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // 新页会将内容整体下推，需把读者固定在原行。读更早一页与放宽窗口两种情况共用
    // 同一份元素锚点。
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    scrollAnchorRef.current = null;
    applyScrollAnchor(container, anchor);
    const content = messageContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => applyScrollAnchor(container, anchor));
    observer.observe(content);
    const stop = window.setTimeout(() => observer.disconnect(), SCROLL_ANCHOR_SETTLE_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [visibleCount, messages.length, scrollContainerRef, scrollToBottom]);
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

  // Images attach to the prompt. Other files go through the file explorer's
  // upload into the working directory, never replacing a file already there,
  // and come back as @mentions. The composer's attach button takes the same
  // path, for phones that cannot drop files.
  const uploadDroppedFiles = useCallback(async (files: File[]) => {
    const cwd = session?.cwd ?? newSessionCwd;
    if (!cwd) {
      addNotice({ type: "warning", message: t("chat.dropNeedsCwd") });
      return;
    }
    try {
      const { status, data } = await uploadFiles(cwd, files, "skip");
      if (status !== 200 && status !== 207) throw new Error(data.error ?? `HTTP ${status}`);
      const uploaded = data.uploaded ?? [];
      const skipped = data.skipped ?? [];
      const mentions = dropMentionText(files, [...uploaded, ...skipped]);
      if (mentions) chatInputRef?.current?.insertText(mentions);
      if (uploaded.length > 0) {
        addNotice({ type: "success", message: t("chat.dropUploaded", { count: uploaded.length }) });
        onFilesUploaded?.();
      }
      if (skipped.length > 0) {
        addNotice({ type: "warning", message: t("chat.dropAlreadyExists", { names: skipped.join(", ") }) });
      }
      for (const failure of data.errors ?? []) {
        addNotice({ type: "error", message: t("chat.dropFailed", { message: `${failure.name}: ${failure.error}` }) });
      }
    } catch (uploadError) {
      addNotice({ type: "error", message: t("chat.dropFailed", { message: uploadError instanceof Error ? uploadError.message : String(uploadError) }) });
    }
  }, [addNotice, chatInputRef, newSessionCwd, onFilesUploaded, session?.cwd, t]);

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
  const toolResultsMap = useMemo(() => {
    const map = new Map(activeToolResults);
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [activeToolResults, messages]);
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
  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const promptAnchorSpacerRef = useRef<HTMLDivElement | null>(null);
  const promptAnchorSpacerHeightRef = useRef(0);
  const promptAnchorMeasureFrameRef = useRef<number | null>(null);
  const promptAnchorAdjustmentDoneRef = useRef(false);
  const promptAnchorUpdateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const spacer = promptAnchorSpacerRef.current;
    if (!agentRunning || !promptAnchorActive) {
      promptAnchorUpdateRef.current = null;
      promptAnchorSpacerHeightRef.current = 0;
      promptAnchorAdjustmentDoneRef.current = false;
      if (spacer) spacer.style.height = "";
      return;
    }

    const container = scrollContainerRef.current;
    const messageContent = messageContentRef.current;
    const userMessage = lastUserMsgRef.current;
    if (!container || !messageContent || !userMessage || !spacer) return;

    let disposed = false;
    const updatePromptAnchorSpacer = () => {
      if (
        disposed
        || scrollContainerRef.current !== container
        || messageContentRef.current !== messageContent
        || lastUserMsgRef.current !== userMessage
        || promptAnchorSpacerRef.current !== spacer
      ) return;

      const containerTop = container.getBoundingClientRect().top;
      const userMessageTop = userMessage.getBoundingClientRect().top
        - containerTop
        + container.scrollTop;
      const targetTop = Math.max(0, userMessageTop - 16);
      const contentEnd = spacer.getBoundingClientRect().top
        - containerTop
        + container.scrollTop;
      const nextPromptAnchorSpacerHeight = getPromptAnchorSpacerHeight(
        targetTop,
        contentEnd,
        container.clientHeight,
      );

      const isInitialMeasurement = !promptAnchorAdjustmentDoneRef.current;
      const needsInitialAdjustment = isInitialMeasurement
        && nextPromptAnchorSpacerHeight > 0;
      if (isInitialMeasurement) promptAnchorAdjustmentDoneRef.current = true;
      if (nextPromptAnchorSpacerHeight === promptAnchorSpacerHeightRef.current) return;

      promptAnchorSpacerHeightRef.current = nextPromptAnchorSpacerHeight;
      spacer.style.height = nextPromptAnchorSpacerHeight > 0
        ? `${nextPromptAnchorSpacerHeight}px`
        : "";
      if (needsInitialAdjustment) scrollUserMsgToTop();
    };

    promptAnchorUpdateRef.current = updatePromptAnchorSpacer;
    const schedulePromptAnchorMeasure = () => {
      if (disposed || promptAnchorMeasureFrameRef.current !== null) return;
      promptAnchorMeasureFrameRef.current = requestAnimationFrame(() => {
        promptAnchorMeasureFrameRef.current = null;
        updatePromptAnchorSpacer();
      });
    };

    updatePromptAnchorSpacer();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedulePromptAnchorMeasure);
    observer?.observe(container);
    observer?.observe(messageContent);
    observer?.observe(userMessage);
    return () => {
      disposed = true;
      if (promptAnchorUpdateRef.current === updatePromptAnchorSpacer) {
        promptAnchorUpdateRef.current = null;
      }
      observer?.disconnect();
      if (promptAnchorMeasureFrameRef.current !== null) {
        cancelAnimationFrame(promptAnchorMeasureFrameRef.current);
        promptAnchorMeasureFrameRef.current = null;
      }
    };
  }, [
    agentRunning,
    lastUserMsgRef,
    messages.length,
    promptAnchorActive,
    scrollContainerRef,
    scrollUserMsgToTop,
  ]);

  // Each streamed chunk StreamingReply commits, and the bubble coming and going.
  const updatePromptAnchor = useCallback(() => {
    promptAnchorUpdateRef.current?.();
  }, []);
  useLayoutEffect(updatePromptAnchor, [isStreaming, hasStreamingContent, updatePromptAnchor]);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSideChat={onSideSession && !isHiddenRelation(session?.relation) ? askInSideChat : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onSteer={agentRunning ? handleSteer : undefined}
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
      inputHistory={inputHistory}
      onQueuedAction={handleQueuedAction}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      cwd={session?.cwd ?? newSessionCwd}
      onAttachFiles={onAttachFiles}
    />
  );

  // The message list is built in one memoized pass. Streaming chunks only change
  // `streamState`, so the memo holds across them: per-chunk renders reuse the
  // previous element identities and the memoized message/activity views skip
  // re-rendering. Recomputes happen on message appends (a few times per turn),
  // search reveals, and run boundaries.
  const messageListView = useMemo(() => {
    let liveActivityRendered = false;
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") { lastUserIdx = i; break; }
      }
      // Anchor for live-tail detection. A compaction summary or subagent
      // completion can sit after the last user message and own the
      // still-streaming segment. lastUserIdx stays the scroll target.
      let lastAnchorIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (isMessageGroupAnchor(messages[i])) { lastAnchorIdx = i; break; }
      }

      const visibleRefIndexByMessage = new Map<number, number>();
      let refIdx = 0;
      messages.forEach((msg, idx) => {
        if (isMessageGroupAnchor(msg) || msg.role === "assistant") {
          visibleRefIndexByMessage.set(idx, refIdx++);
        }
      });

      const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
        messageRefs.current[refIndex] = el;
        if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
      };

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
        const messageKey = entryIds[idx] ?? idx;
        let showTimestamp = false;
        if (msg.role === "assistant") {
          showTimestamp = true;
          for (let j = idx + 1; j < messages.length; j++) {
            const r = messages[j].role;
            if (r === "user") break;
            if (r === "assistant") { showTimestamp = false; break; }
          }
          // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
          if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
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
        if (!isVisible || currentRefIdx === undefined) return view;
        return (
          // 行高固定：content-visibility 的估算高度会导致行进出视口时滚动位置跳动。
          <div key={`${keyPrefix}-${messageKey}`} data-entry-id={entryIds[idx]} ref={options.attachRef === false ? undefined : attachVisibleRef(idx, currentRefIdx)}>
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
        idx = headEnd;
      }
      for (; idx < messages.length;) {
        const msg = messages[idx];
        if (!isMessageGroupAnchor(msg)) {
          rendered.push(renderMessage(idx, { showModelLabel: true }));
          idx += 1;
          continue;
        }

        const userIdx = idx;
        let endIdx = userIdx + 1;
        while (endIdx < messages.length && !isMessageGroupAnchor(messages[endIdx])) endIdx += 1;

        const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

        if (finalAssistantIdx === -1) {
          for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
            rendered.push(renderMessage(renderIdx, { showModelLabel: true }));
          }
          idx = endIdx;
          continue;
        }

        const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
        if (isLiveTail) {
          // A running turn streams as flat activity rows (no wrapper, no
          // final-answer split); once settled the turn regroups below.
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
          if (liveItems.length > 0) {
            liveActivityRendered = true;
            rendered.push(
              <TurnActivityBody
                key={`live-activity-${entryIds[userIdx] ?? userIdx}`}
                items={liveItems}
                cwd={messageCwd}
                onOpenFile={onOpenFile}
                onOpenSubagent={onOpenSubagent}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                live
              />,
            );
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

        // Search reveal: the outer group opens when the hit sits inside it.
        let revealProcess = false;
        let processRefIdx: number | undefined;
        for (let processIdx = userIdx + 1; processIdx <= finalAssistantIdx; processIdx++) {
          const processMessage = messages[processIdx];
          if (processMessage.role === "custom" && isHiddenCustomMessage(processMessage)) continue;
          const hitsEntry = Boolean(pendingSearchScroll && pendingSearchScroll.entryId === entryIds[processIdx]);
          if (processMessage.role === "custom") {
            revealProcess ||= hitsEntry;
            processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
            continue;
          }
          if (processMessage.role !== "assistant") continue;
          const processContent = (processMessage as AssistantMessage).content ?? [];
          const processLimit = processBlockLimitByIdx?.get(processIdx) ?? processContent.length;
          if (processLimit === 0) continue;
          processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
          revealProcess ||= hitsEntry && (!searchBlock || processContent.slice(0, processLimit).includes(searchBlock));
        }

        const categoryCounts = new Map<ToolCategory, number>();
        for (const item of activityItems) {
          if (item.kind === "tool") {
            const category = getToolCategory(item.block.toolName);
            categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
          }
        }
        let processMessageCount = 0;
        for (let processIdx = userIdx + 1; processIdx <= finalAssistantIdx; processIdx++) {
          const role = messages[processIdx]?.role;
          if (role === "custom" && isHiddenCustomMessage(messages[processIdx])) continue;
          if (role === "assistant" || role === "custom") processMessageCount += 1;
        }
        const categorySummary = [...categoryCounts.entries()]
          .map(([category, count]) => `${count} ${t(TOOL_CATEGORY_LABEL_KEYS[category])}`)
          .join(" · ");
        // 折叠行描述整轮（官方 Whole Turn：「Worked for 2m 4s, 1 command failed」）；
        // 未跑完、取不到时长时退回分类计数。
        const failedCalls = activityItems.filter((item) => item.kind === "tool" && item.result?.isError).length;
        const turnDurationMs = getTurnDurationMs(messages, userIdx, finalAssistantIdx + 1);
        const workedFor = turnDurationMs === undefined ? undefined : formatTurnDuration(turnDurationMs);
        const processSummary = workedFor
          ? (failedCalls > 0
            ? t("chat.activity.workedForFailed", { duration: workedFor, count: failedCalls })
            : t("chat.activity.workedFor", { duration: workedFor }))
          : categorySummary
            ? `${t("chat.processDetails")} · ${categorySummary}`
            : `${t("chat.processDetails")} · ${processMessageCount} ${t(processMessageCount === 1 ? "chat.message" : "chat.messages")}`;

        if (activityItems.length > 0) {
          const processKey = entryIds[userIdx];
          rendered.push(
            <div
              key={`process-group-${processKey ?? userIdx}`}
              ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
            >
              <TurnTrace
              summary={processSummary}
              // 无 entry id 时不传 foldKey：索引作 key 会在前插一页后全部错位。
              foldKey={processKey === undefined ? undefined : `process:${processKey}`}
              defaultOpen={!finalAnswerMessage}
              reveal={revealProcess}
            >
                <TurnActivityBody
                  items={activityItems}
                  cwd={messageCwd}
                  onOpenFile={onOpenFile}
                  onOpenSubagent={onOpenSubagent}
                  sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                />
              </TurnTrace>
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
        const isConversationTail = endIdx >= messages.length;
        const liveCtx = turnView.nextPromptTokens === undefined && isConversationTail
          ? ctxInfoRef.current ?? null
          : null;
        const metaNode = (
          <div className="mb-2">
            <TurnMetaLine
              usage={turnUsage}
              model={turnLastAssistant?.provider ? getModelDisplayName(turnLastAssistant.provider, turnLastAssistant.model, modelNames) : undefined}
              time={formatTime(turnLastAssistant?.timestamp)}
              copySource={finalAnswerCopyText || undefined}
              ctxTokens={turnView.nextPromptTokens}
              liveCtx={liveCtx}
              ctxWindow={ctxInfoRef.current?.contextWindow}
            />
          </div>
        );
        // 用量与本轮最后一块内容同属一行：跨行间距会被 content-visibility 的包含块吞掉，
        // 负边距则会重叠，仅同行内的 gap 可靠。
        const lastNode = rendered[rendered.length - 1];
        // 提问本身是本轮最后一块内容时（回复尚未写入），合并会使用量贴到气泡上，
        // 故仍单独成行，间距由行距提供。
        const lastRole = isValidElement(lastNode)
          ? (lastNode.props as { message?: { role?: string } }).message?.role
          : undefined;
        if (isValidElement<{ "data-entry-id"?: string }>(lastNode) && lastRole !== "user") {
          rendered[rendered.length - 1] = (
            <div
              key={lastNode.key ?? `turn-body-${entryIds[userIdx] ?? userIdx}`}
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
  }, [messages, entryIds, toolResultsMap, hasEarlierMessages, streamState.isStreaming, sessionBusy,
     forkingEntryId, pendingSearchScroll, searchBlock, t, modelNames, messageCwd, session?.id,
     sessionIdRef, forkFromMessage, handleEditContent, onOpenFile, onOpenSubagent,
     isNew, messageRefs, lastUserMsgRef, bashRunning, editEntryId, cancelEdit]);
  const { rendered: turnRendered, liveActivityRendered } = messageListView;
  const { startIndex } = getVisibleRenderWindow(turnRendered.length, visibleCount);
  const hasMoreRendered = startIndex > 0 || hasEarlierMessages;
  if (loading) {
    return (
      <div className="flex h-full flex-col justify-center gap-3 px-10">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

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
    <div
      className="chat-content relative flex h-full min-w-0 flex-col overflow-hidden [padding-bottom:env(safe-area-inset-bottom,0px)]"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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

      <div
        className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-end px-[var(--chat-column-padding)]"
      >
        <NoticeShelf notices={notices} floating onPauseChange={setNoticePaused} onDismiss={dismissNotice} />
      </div>

      <div ref={setChatPaneElement} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {extensionDialog && (
          <ExtensionDialog
            key={extensionDialog.id}
            request={extensionDialog}
            waitingCount={waitingExtensionDialogCount}
            queueTotal={extensionDialogQueue.length}
            answered={answeredDialogs}
            onRespond={handleDialogRespond}
          />
        )}
        {extensionCustomUi && (
          <ExtensionCustomPanel key={extensionCustomUi.id} request={extensionCustomUi} waitingCount={waitingExtensionCustomUiCount} onInput={sendExtensionCustomInput} />
        )}
        {!isEmptyNew && <>
        <MessageScrollerProvider autoScroll={atTail && !foldInFlight} defaultScrollPosition="end">
        <FollowTailWhenAtTail atTail={atTail} contentRef={messageContentRef} />
        <MessageScroller className="min-h-0 min-w-0 flex-1">
        <MessageScrollerViewport
          ref={scrollContainerRef}
          className={cn(pendingScrollRestore && "invisible")}
        >
          {/* 每行必须是 MessageScrollerItem 的直接子节点：官方 scroller 仅扫描 Content 的 children
              做测量、可见性、前插保位与贴底跟随，多包一层 div 会使这四项全部失效。纵向留白也放在
              Content 上，官方按 computed padding 计算内容末端。 */}
          <MessageScrollerContent
            ref={messageContentRef}
            onPointerUp={captureQuotedSelection}
            className="pt-[22px] pb-2 max-sm:pt-4"
          >
            {hasMoreRendered && (
              // 手动入口：自动加载需等上一页渲染完成，此按钮允许随时请求一页。
              <button
                // 该行固定在内容顶部，翻页时不移动，滚动锚点须跳过它。
                data-scroll-anchor-ignore=""
                ref={setSentinel}
                type="button"
                onClick={() => {
                  if (loadingOlderRef.current || pageRenderingRef.current) return;
                  const sid = session?.id ?? sessionIdRef.current;
                  if (!sid || !historyCursor) return;
                  void loadOlderPage(sid, historyCursor);
                }}
                disabled={olderPageState !== "idle"}
                data-state={olderPageState}
                className="mx-auto block rounded-lg px-3 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {olderPageState === "idle" ? t("chat.loadEarlier") : t("chat.loadingEarlier")}
              </button>
            )}
            {turnRendered.slice(startIndex).map((node, index) => {
              // 每条消息一个 Item：官方据此测量、锚定并记录可视性；离屏行由 content-visibility
              // 跳过渲染，长会话仅付出可见部分开销。非元素行（空渲染）原样返回。
              if (!isValidElement<{ "data-entry-id"?: string }>(node)) return node;
              const messageId = node.props["data-entry-id"] ?? `turn-${startIndex + index}`;
              // 官方锚点：`defaultScrollPosition="last-anchor"` 在回复超过一屏时把最后一条
              // 用户消息顶到顶部，否则直接贴尾。
              const anchorRole = (node.props as { message?: { role?: string } }).message?.role;
              return (
                <ChatRow
                  key={node.key ?? messageId}
                  messageId={messageId}
                  scrollAnchor={anchorRole === "user"}
                >
                  {node}
                </ChatRow>
              );
            })}
            {/* 非条目行（流式回复、阶段提示、待执行命令）不是 Item 的测量对象，
                但仍需落在与行一致的列宽内。 */}
            <ChatRow>
            {streamState.isStreaming && hasStreamingContent && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} toolResults={toolResultsMap} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} onOpenSubagent={onOpenSubagent} />
            )}

            {(agentRunning || isCompacting) && !hasStreamingContent && (agentPhase || isCompacting) && !liveActivityRendered && (
              <div className="break-words py-2 text-sm text-muted-foreground">
                <span className="animate-[pulse_1.5s_infinite] motion-reduce:animate-none">{phaseLabel(agentPhase, t, isCompacting, queuedSubmissions.length)}</span>
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div className="py-2 text-sm text-muted-foreground">
                 <span className="animate-[pulse_1.5s_infinite] motion-reduce:animate-none">{t("chat.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}

            </ChatRow>
            <div ref={promptAnchorSpacerRef} aria-hidden="true" />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="text-muted-foreground transition-opacity hover:text-foreground [@media(hover:hover)]:opacity-30 [@media(hover:hover)]:hover:opacity-100">
          <ArrowDownIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("chat.scrollToLatest")}</span>
        </MessageScrollerButton>
        </MessageScroller>
        </MessageScrollerProvider>
        {isMobile || pendingScrollRestore || !minimapPaneWide ? null : (
          <ChatMinimap
            messages={messages}
            getStreamingMessage={getStreamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
            onRevealTurn={revealTurnForMinimap}
            turnsBefore={earlierTurnCount}
            turnIndex={minimapTurnIndex}
          />
        )}
        </>}
      </div>

      {quoteSelectionEnabled && quotedSelection && createPortal(
        <div
          ref={quotePopoverRef}
          role={quoteInputOpen ? "dialog" : "toolbar"}
          aria-label={t(quoteInputOpen ? "chat.newQuoteChat" : "chat.selectionActions")}
          className={cn(
            "fixed z-[260] flex flex-wrap items-start gap-[3px] max-w-[calc(100vw-16px)] max-h-[calc(var(--app-viewport-height,100dvh)-16px)] overflow-y-auto rounded-md border border-border bg-popover shadow-md",
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

      <div className={cn("relative flex min-h-0 flex-col shrink-0", CHAT_PAGE_GUTTER_CLASS)}>
        {/* The brand (the logo, "Pi Web" and its versions line), then the
            project/worktree row right above the composer, all on the
            composer's left edge. */}
        {isEmptyNew && (
          <div className="new-session-hero max-md:px-4 md:px-4">
            <div className={cn("new-session-hero-inner flex flex-col items-start", CHAT_COLUMN_CLASS)}>
              <div className="new-session-brand flex min-w-0 items-center gap-3 mb-5 max-[640px]:mb-4">
                <Image src="/icons/logo.svg" width={120} height={120} alt="" priority unoptimized className="new-session-logo size-30 shrink-0 max-[640px]:size-8" />
                <div className="new-session-brand-text flex min-w-0 flex-col gap-0.5 font-mono">
                  <span className="new-session-brand-name text-xl font-bold leading-[1.15] whitespace-nowrap text-foreground max-[640px]:text-xl">Pi Web</span>
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
        {chatInputElement}
        <ExtensionStatusBar
          statuses={extensionStatuses}
          widgets={extensionWidgets}
          onCommand={handleSend}
          commandsDisabled={sessionBusy}
        />
      </div>
      {/* 手机端底部留白占偏置的两份（顶部聊天列仍为一份），使空态的 hero+composer
          簇高于正中：保持簇完整，品牌块不与浮层重叠。 */}
      {isEmptyNew && <div className="min-h-0 flex-1 max-sm:flex-[2]" />}
    </div>
  );
});

// A one-line notice is exactly as tall as its entrance animation pins it, and
// its line sits dead centre: the two 1px borders, a 21px line box (14px at
// line-height 1.5) and this padding twice add up to 60px. Letting the card's
// min-height take the leftover instead leaves the top-aligned text 4.5px above
// the centre, since the rest of the leftover stays under it.
const NOTICE_MIN_HEIGHT_PX = 60;
const NOTICE_LINE_BOX_PX = 21;
const NOTICE_TEXT_PADDING_Y_PX = (NOTICE_MIN_HEIGHT_PX - 2 - NOTICE_LINE_BOX_PX) / 2;
// Toast 整体高度上限；文本区高度上限 = 整体上限 − 2px 边框（全局 box-sizing: border-box，
// 文本区的 max-height 已包含自身上下 padding，不再重复扣减）。
const NOTICE_MAX_HEIGHT_PX = 500;
const NOTICE_TEXT_MAX_HEIGHT_PX = NOTICE_MAX_HEIGHT_PX - 2;

function NoticeShelf({ notices, floating = false, onPauseChange, onDismiss }: { notices: NoticeItem[]; floating?: boolean; onPauseChange?: (id: string | null) => void; onDismiss?: (id: string) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className={cn("flex flex-col items-end", floating ? "mb-0" : "mb-2.5")}>
      {notices.map((notice, index) => {
        return (
          <div
            key={notice.id}
            className="notice-shelf-item pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-xl border border-border/70 bg-background w-fit max-w-[min(100%,620px)] px-3 text-sm leading-normal text-muted-foreground origin-top-right shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)] motion-reduce:[animation-duration:0.001ms]!"
            onMouseEnter={() => onPauseChange?.(notice.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) onPauseChange?.(null);
            }}
            onFocus={() => onPauseChange?.(notice.id)}
            onBlur={(event) => {
              if (!event.currentTarget.matches(":hover")) onPauseChange?.(null);
            }}
            style={{
              minHeight: NOTICE_MIN_HEIGHT_PX,
              // 整体高度上限：超出部分由文本区内部滚动承担（见下方 span 的 overflowY），
              // 容器自身保持 hidden，小圆点固定在顶部不随文本滚动。
              maxHeight: NOTICE_MAX_HEIGHT_PX,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : undefined,
              // Use backwards fill for the entrance animation so height styles return to
              // inline styles once it finishes; otherwise the keyframe's fixed 60px would
              // stick around in fill mode and permanently clamp the expanded toast
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out backwards",
            }}
          >
            <span
              className={cn(
                "size-[7px] shrink-0 rounded-full",
                notice.type === "error" ? "bg-destructive" : notice.type === "warning" ? "bg-warning" : notice.type === "success" ? "bg-success" : "bg-primary",
              )}
              style={{
                // Align with the optical center of the first text line: the text's
                // vertical padding + (21px line box - 7px dot) / 2
                marginTop: NOTICE_TEXT_PADDING_Y_PX + 7,
              }}
            />
            {/* Full text by default: pre-line preserves \n (nowrap/normal collapse
                newlines into spaces) and long lines wrap instead of truncating;
                content taller than the cap scrolls inside the text area */}
            {isTuiText(notice.message) ? (
              <TuiText
                tabIndex={0}
                text={notice.message}
                className="min-w-0 max-w-full"
                style={{ padding: `${NOTICE_TEXT_PADDING_Y_PX}px 0`, maxHeight: NOTICE_TEXT_MAX_HEIGHT_PX }}
              />
            ) : (
              <span
                tabIndex={0}
                className="min-w-0 max-w-full overflow-y-auto whitespace-pre-line break-words"
                style={{ padding: `${NOTICE_TEXT_PADDING_Y_PX}px 0`, maxHeight: NOTICE_TEXT_MAX_HEIGHT_PX }}
              >
                {splitNoticeText(notice.message).map((part, partIndex) => part.kind === "art" ? (
                  // A terminal QR code or bar (#755): every space kept, rows touching, and a
                  // font stack whose first font has the blocks too (the bundled Noto subset
                  // has none, so spaces and blocks would come from fonts of different widths).
                  <span
                    key={partIndex}
                    className="inline-block max-w-full overflow-x-auto whitespace-pre align-top font-mono leading-none text-foreground"
                  >
                    {part.text}
                  </span>
                ) : part.text)}
              </span>
            )}
            {onDismiss && (
              <Button
                type="button"
                variant="ghost"
                className="ml-0.5 mt-3.5 size-6 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Dismiss notification"
                title="Dismiss notification"
                onClick={() => onDismiss(notice.id)}
              >
                <XIcon size={12} strokeWidth={2} className="size-3" aria-hidden="true" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function getExtensionDialogSummary(request: ExtensionDialogRequest): string | undefined {
  if (request.method === "select" && request.options.length > 0) return stripAnsi(request.options[0]);
  if (request.method === "confirm") {
    const firstLine = stripAnsi(request.message).split("\n").find((line) => line.trim());
    return firstLine?.trim();
  }
  return undefined;
}

// Extensions pack structured details (e.g. permission prompts: tool/command/paths)
// into the dialog title as "key : value" lines. Render those lines as a two-column
// table so the values align. ask_user_question's RPC path appends per-option
// preview blocks as "--- N. label preview ---" followed by raw markdown; those
// blocks render through MarkdownBody so the preview shows fully formatted.
const PREVIEW_HEADING_RE = /^--- (.+) preview ---$/;

type DialogTitleSegment =
  | { kind: "plain"; text: string }
  | { kind: "preview"; heading: string; markdown: string };

function parseDialogTitleSegments(title: string): DialogTitleSegment[] {
  const segments: DialogTitleSegment[] = [];
  let plain: string[] = [];
  let preview: { heading: string; lines: string[] } | null = null;
  const flushPlain = () => {
    if (plain.length > 0) segments.push({ kind: "plain", text: plain.join("\n") });
    plain = [];
  };
  const flushPreview = () => {
    if (preview) segments.push({ kind: "preview", heading: preview.heading, markdown: preview.lines.join("\n") });
    preview = null;
  };
  for (const line of title.split("\n")) {
    const match = PREVIEW_HEADING_RE.exec(line.trim());
    if (match) {
      flushPlain();
      flushPreview();
      preview = { heading: match[1], lines: [] };
    } else if (preview) {
      preview.lines.push(line);
    } else {
      plain.push(line);
    }
  }
  flushPlain();
  flushPreview();
  return segments;
}

function DialogTitlePlainText({ text }: { text: string }) {
  const [heading, ...rest] = text.split("\n");
  const headingClass = "text-sm font-semibold leading-[1.45] text-foreground";
  // Terminal text is laid out for a fixed width: render it verbatim so box
  // drawing, tables and progress bars keep their shape (see TuiText).
  const body = rest.join("\n").replace(/^\n+|\n+$/g, "");
  if (isTuiText(body)) {
    return (
      <div className="min-w-0">
        <div className={headingClass}>{heading}</div>
        <TuiText text={body} className="mt-1 text-xs leading-[1.45] text-muted-foreground" />
      </div>
    );
  }
  const rows: Array<{ label: string; value: string }> = [];
  const plain: string[] = [];
  for (const line of rest) {
    const match = /^\s*([^:\n]{1,48}?)\s*:\s*(.+)$/.exec(line);
    if (match) rows.push({ label: match[1].trim(), value: match[2].trim() });
    else plain.push(line.trim());
  }
  if (rows.length === 0) {
    return (
      <div className="whitespace-pre-wrap wrap-anywhere">
        <div className={headingClass}>{heading}</div>
        {plain.map((line, index) => (
          <div key={index} className="mt-0.5 text-xs text-muted-foreground">{line}</div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <div className={headingClass}>{heading}</div>
      {/* Flex rows, not a table: WebKit's auto table layout gives the value column
          only its min-content when overflow-wrap: anywhere is set, crushing values
          like "external_directory" into one character per line on narrow screens. */}
      <div className="mt-1.5 text-xs leading-[1.5]">
        {rows.map((row) => (
          <div key={row.label + row.value} className="flex items-baseline gap-3.5 py-[3px]">
            <div className="shrink-0 whitespace-nowrap text-muted-foreground">{row.label}</div>
            <div className="min-w-0 flex-1 font-mono text-foreground wrap-anywhere">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExtensionDialogTitle({ title }: { title: string }) {
  const segments = parseDialogTitleSegments(title);
  return (
    <div className="min-w-0">
      {segments.map((segment, index) =>
        segment.kind === "preview" ? (
          <div key={index} className="mt-2.5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {segment.heading}
            </div>
            {isTuiText(segment.markdown) ? (
              <TuiText
                text={segment.markdown}
                className="rounded-md bg-muted px-2 py-1.5 text-xs leading-[1.4] text-muted-foreground"
              />
            ) : (
              <MarkdownBody>{segment.markdown}</MarkdownBody>
            )}
          </div>
        ) : (
          <DialogTitlePlainText key={index} text={segment.text} />
        ),
      )}
    </div>
  );
}

// Permission-style options read as approve/deny; tint them so the choice
// is recognizable at a glance. Only matches at the start of the option text.
function extensionOptionTone(option: string): "affirmative" | "negative" | "neutral" {
  const text = option.trim().toLowerCase();
  if (/^(yes|y|ok|okay|allow|approve|accept|continue|always)\b/.test(text) || /^[是允禄确认同意好的]/.test(option.trim())) return "affirmative";
  if (/^(no|n|deny|reject|cancel|never|stop|don'?t)\b/.test(text) || /^[否不拒绝取消]/.test(option.trim())) return "negative";
  return "neutral";
}

// pi has no toggle RPC for multi-select questions: the host sends an
// input-method dialog whose title carries a numbered option list and asks
// for comma-separated numbers ("1,3") in the text field. Detect that shape
// so the web UI can offer real checkboxes instead of typed digits.
function parseMultiSelectPrompt(title: string): { question: string; options: Array<{ id: string; label: string }> } | null {
  const lines = title.split("\n");
  const hintIndex = lines.findIndex((line) => /enter the numbers/i.test(line));
  if (hintIndex < 0) return null;
  const options: Array<{ id: string; label: string }> = [];
  const question: string[] = [];
  for (let i = 0; i < hintIndex; i++) {
    const match = /^\s*(\d+)[.、)]\s*(.+)$/.exec(lines[i]);
    if (match) options.push({ id: match[1], label: match[2].trim() });
    else question.push(lines[i]);
  }
  if (options.length < 2) return null;
  return { question: question.join("\n"), options };
}

function ExtensionWaitingCount({ count }: { count: number }) {
  const { t } = useI18n();
  if (count <= 0) return null;
  return (
    <Badge variant="ghost" className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary">
      {t("chat.extensionMoreWaiting", { count })}
    </Badge>
  );
}

/** Corner brackets pointing outward; when expanded they point inward (restore). */
function ExtensionSizeIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded
        ? <path d="M3.5 1v2.5H1M6.5 1v2.5H9M6.5 9v-2.5H9M3.5 9v-2.5H1" />
        : <path d="M1 3.5V1h2.5M6.5 1H9v2.5M9 6.5V9H6.5M3.5 9H1V6.5" />}
    </svg>
  );
}

function ExtensionDialog({
  request,
  waitingCount,
  onRespond,
  queueTotal,
  answered,
}: {
  request: ExtensionDialogRequest;
  /** Further dialogs queued behind this one; each opens after this one is answered. */
  waitingCount: number;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
  /** Requests still queued including this one — the ask tool sends several. */
  queueTotal?: number;
  answered?: Array<{ id: string; question: string; answer: string; cancelled?: boolean }>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const multiSelect = request.method === "input" ? parseMultiSelectPrompt(request.title) : null;
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([]);
  const [customAnswer, setCustomAnswer] = useState("");
  // Select is two-step: a click only marks the choice; the Confirm button (or
  // double-click) sends it, so a stray click can be revised before it counts.
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const toggleMultiOption = (id: string) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };
  const [collapsed, setCollapsed] = useState(false);
  // Multi-question asks page: ‹ › steps back through the answers already sent
  // (read-only review — those responses are with the agent) and forward to the
  // question awaiting a response.
  const totalQuestions = (answered?.length ?? 0) + (queueTotal ?? 1);
  const currentQuestionIndex = (answered?.length ?? 0) + 1;
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const reviewed = reviewIndex !== null ? answered?.[reviewIndex] : undefined;
  const stepToPrevious = () => {
    const count = answered?.length ?? 0;
    if (!count) return;
    setReviewIndex((current) => current === null ? count - 1 : Math.max(0, current - 1));
  };
  const stepToNext = () => {
    const count = answered?.length ?? 0;
    setReviewIndex((current) => current === null || current + 1 >= count ? null : current + 1);
  };
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The dialog is a Radix Dialog portaled into this panel, so it stays inside
  // the chat area instead of covering the whole app.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  // The panel this dialog is anchored in, not the visual viewport, is what
  // bounds it: on mobile the chat panel is far shorter than the viewport.
  const dialogMaxHeight = useDialogMaxHeight(wrapperRef);
  // Dialogs open at the historical width and grow only when their own content cannot
  // fit (a code block or table that would scroll sideways), so no extension has to ask
  // for room. The maximize button is the user's own override for this dialog (#947).
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => setFull((prev) => !prev), []);
  const [now, setNow] = useState(() => Date.now());
  const focusFirstOption = useCallback((element: HTMLElement | null) => element?.focus(), []);

  const summary = getExtensionDialogSummary(request);
  const remainingSeconds = request.expiresAt === undefined
    ? null
    : Math.max(0, Math.ceil((request.expiresAt - now) / 1000));

  useLayoutEffect(() => {
    if (collapsed) return;
    const dialog = dialogRef.current;
    const body = bodyRef.current;
    if (!dialog || !body) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const blocks = body.querySelectorAll<HTMLElement>("pre, .markdown-table-wrap");
      if (blocks.length === 0) return;
      // Code fences wrap their long lines; measured unwrapped, they still widen
      // the dialog as far as the screen allows and wrap only past that. The
      // class is an attribute change, which the observer below does not watch.
      body.classList.add("extension-dialog-measuring");
      const overflows = Array.from(blocks, (block) => block.scrollWidth - block.clientWidth);
      body.classList.remove("extension-dialog-measuring");
      const needed = fitExtensionDialogWidth(dialog.offsetWidth, overflows);
      // Only ever grow: shrinking again would make the dialog jump while it is read.
      if (needed !== null) setFitWidth((prev) => (prev !== null && prev >= needed ? prev : needed));
    };
    fit();
    // Highlighted code replaces its plain fallback after the first paint, and a web
    // font can change glyph widths once it arrives.
    const mutations = new MutationObserver(fit);
    mutations.observe(body, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => {
      disposed = true;
      mutations.disconnect();
    };
  }, [collapsed]);

  useEffect(() => {
    if (request.expiresAt === undefined) return;
    // The server closes expired requests via extension_ui_closed.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);

  const countdown = remainingSeconds !== null && (
    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
      {t("chat.extensionExpiresIn", { seconds: remainingSeconds })}
    </span>
  );

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else if (request.method === "select") {
      if (selectedOption !== null) onRespond(request, { value: selectedOption });
    } else if (multiSelect) {
      const value = checkedIds.length > 0
        ? checkedIds.slice().sort((a, b) => Number(a) - Number(b)).join(",")
        : customAnswer;
      onRespond(request, { value });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        setPortalHost(node);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        // Reviewing a previous question: Escape returns to the live one
        // instead of cancelling a response the user did not intend.
        if (reviewIndex !== null) {
          setReviewIndex(null);
          return;
        }
        onRespond(request, { cancelled: true });
      }}
      className={cn("absolute inset-0 z-[90] flex justify-center p-5 pointer-events-none", collapsed ? "items-start" : "items-end")}
    >
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          className="pointer-events-auto flex h-auto w-full max-w-[min(560px,100%)] cursor-pointer items-center justify-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-left font-normal text-foreground shadow-lg hover:bg-background hover:text-foreground"
        >
          <span className="shrink-0 text-xs font-[650] text-primary">
            {t("chat.extensionPending")}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {stripAnsi(request.title)}
          </span>
          {summary && (
            <span className="max-w-[34%] shrink truncate text-xs text-muted-foreground">
              {summary}
            </span>
          )}
          <ExtensionWaitingCount count={waitingCount} />
          {countdown}
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("chat.extensionExpand")}
          </span>
        </Button>
      ) : (
      <Dialog open modal={false}>
      <DialogContent
        ref={dialogRef}
        container={portalHost}
        showCloseButton={false}
        overlayClassName="hidden"
        aria-label={stripAnsi(request.title)}
        className="pointer-events-auto static top-auto left-auto mx-auto translate-x-0 translate-y-0 flex max-w-none flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background p-0 shadow-2xl animate-[extension-drawer-in_0.22s_ease-out] duration-0 motion-reduce:animate-none"
        style={{
          // "Full" fills the content region above the composer: the overlay is inset:0 with
          // 20px padding, so 100% keeps that breathing room without covering the input.
          width: full ? "100%" : `min(${fitWidth ?? EXTENSION_DIALOG_BASE_WIDTH}px, 100%)`,
          // Bounded by the panel that holds it, so a tall option preview cannot
          // push the drawer past the chat area and clip its header.
          maxHeight: full ? "100%" : dialogMaxHeight,
        }}
      >
        <div className="flex shrink min-h-0 items-start gap-2 px-3.5 py-3 max-h-[180px] overflow-y-auto">
          <div className="min-w-0 flex-1">
            {/* Pi's TUI shows the title verbatim, newlines included; select/input have no
                separate message field, so extensions put multi-line text here. */}
            <ExtensionDialogTitle title={multiSelect ? stripAnsi(multiSelect.question || request.title) : stripAnsi(request.title)} />
            <div className="mt-[3px] flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground">
              <span>{t("chat.extensionRequest")}</span>
              {totalQuestions > 1 && (
                <span className="inline-flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    onClick={stepToPrevious}
                    disabled={!answered?.length || reviewIndex === 0}
                    aria-label={t("chat.question.previous")}
                    title={t("chat.question.previous")}
                    className="size-[18px] rounded-[4px] p-0"
                  >
                    <svg className="size-2 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="6.5 2 3 5 6.5 8" />
                    </svg>
                  </Button>
                  <span className={cn("tabular-nums", reviewIndex !== null ? "text-foreground" : "text-primary")}>
                    {t("chat.question.pager", { index: reviewIndex !== null ? reviewIndex + 1 : currentQuestionIndex, total: totalQuestions })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    onClick={stepToNext}
                    disabled={reviewIndex === null}
                    aria-label={t("chat.question.next")}
                    title={t("chat.question.next")}
                    className="size-[18px] rounded-[4px] p-0"
                  >
                    <svg className="size-2 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3.5 2 7 5 3.5 8" />
                    </svg>
                  </Button>
                </span>
              )}
              <ExtensionWaitingCount count={waitingCount} />
              {countdown}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={toggleFull}
            title={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
            aria-label={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
            className="size-7 shrink-0 rounded-md"
          >
            <ExtensionSizeIcon expanded={full} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => setCollapsed(true)}
            aria-expanded={true}
            title={t("chat.extensionCollapse")}
            aria-label={t("chat.extensionCollapse")}
            className="size-7 shrink-0 rounded-md"
          >
            <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2 3.5 5 6.5 8 3.5" />
            </svg>
          </Button>
        </div>

        <div
          ref={bodyRef}
          className="min-h-0 min-w-0 flex-[1_1_auto] overflow-y-auto p-3.5 extension-ask-body"
        >
          {reviewed ? (
            <div className="grid gap-2.5">
              <div className="text-sm font-semibold leading-[1.55] text-foreground wrap-anywhere">
                {`${(reviewIndex ?? 0) + 1}. ${reviewed.question}`}
              </div>
              <div className="rounded-sm border border-border bg-card px-2.5 py-2 text-sm leading-[1.6] text-foreground wrap-anywhere whitespace-pre-wrap">
                <span className="mb-1 block text-xs text-muted-foreground">
                  {reviewed.cancelled ? t("chat.question.answeredCancelled") : t("chat.question.answerLabel")}
                </span>
                {reviewed.answer}
              </div>
              <div className="text-xs text-muted-foreground">{t("chat.question.reviewHint")}</div>
            </div>
          ) : (
          <>
          {request.method === "confirm" && (
            <div className="text-sm leading-[1.6]">
              <MarkdownBody>{stripAnsi(request.message)}</MarkdownBody>
            </div>
          )}
          {request.method === "select" && (
            <div
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-extension-option]"));
                const index = buttons.indexOf(event.target as HTMLElement);
                if (index < 0) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0
                  : event.key === "End" ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus({ preventScroll: true });
                buttons[next].scrollIntoView({ block: "nearest" });
              }}
              className="grid gap-1.5"
            >
              {request.options.map((option, index) => {
                const tone = extensionOptionTone(option);
                const selected = selectedOption === option;
                return (
                <div
                  key={option}
                  role="button"
                  tabIndex={0}
                  data-extension-option
                  className={cn(
                    "extension-option w-full cursor-pointer rounded-md border px-2.5 py-1.5 text-left text-xs wrap-anywhere",
                    // Match the scroller's padding so keyboard navigation never parks the
                    // option flush against the edge, where whole-pixel scroll snapping and
                    // overflow clipping cut off its focus ring.
                    "scroll-m-[14px]",
                    selected ? "border-ring bg-accent" : cn(
                      "border-border",
                      // Permission-style tints stay readable through hover; the
                      // selected option keeps its accent surface instead.
                      tone === "affirmative" ? "bg-success/[0.12] hover:bg-success/[0.22] text-success"
                        : tone === "negative" ? "bg-destructive/10 hover:bg-destructive/20 text-destructive"
                          : "bg-sidebar hover:bg-secondary text-foreground",
                    ),
                    tone !== "neutral" && "font-semibold",
                  )}
                  aria-label={stripAnsi(option)}
                  aria-pressed={selected}
                  ref={index === 0 ? focusFirstOption : undefined}
                  onClick={() => setSelectedOption((current) => current === option ? null : option)}
                  onDoubleClick={() => {
                    setSelectedOption(option);
                    onRespond(request, { value: option });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedOption((current) => current === option ? null : option);
                  }}
                >
                  <div inert>
                    <MarkdownBody>{stripAnsi(option)}</MarkdownBody>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          {request.method === "input" && (multiSelect ? (
            <div className="grid gap-1.5">
              {multiSelect.options.map((option, index) => {
                const checked = checkedIds.includes(option.id);
                return (
                  // The official Checkbox carries the semantics and the Space
                  // key; the palette card stays the label wrapping it.
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer select-none items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs wrap-anywhere scroll-m-[14px]",
                      "border-border hover:bg-secondary has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-accent",
                      "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleMultiOption(option.id)}
                      aria-label={option.label}
                      ref={index === 0 ? focusFirstOption : undefined}
                      className="mt-[1px] size-[15px] shrink-0 rounded-[4px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="mr-1.5 font-semibold">{option.id}.</span>
                      {option.label}
                    </span>
                  </label>
                );
              })}
              <Input
                value={customAnswer}
                placeholder={t("chat.extensionCustomAnswer")}
                onChange={(e) => setCustomAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
                }}
                className="rounded-sm border-border bg-card px-2.5"
              />
            </div>
          ) : (
            <Input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
              }}
              className="rounded-sm border-border bg-card px-2.5"
            />
          ))}
          {request.method === "editor" && (
            <Textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
              }}
              className="min-h-[220px] rounded-sm border-border bg-card p-2.5 leading-[1.55] font-mono"
            />
          )}
          </>
          )}
        </div>

        {reviewed ? (
          <div className="flex shrink-0 justify-end gap-2 bg-card px-3.5 py-2.5">
            <Button type="button" onClick={() => setReviewIndex(null)}>
              {t("chat.question.backToCurrent")}
            </Button>
          </div>
        ) : (
        <div className="flex shrink-0 justify-end gap-2 bg-card px-3.5 py-2.5">
          <Button
            type="button"
            variant="outline"
            autoFocus={request.method === "confirm" || (request.method === "select" && request.options.length === 0)}
            onClick={() => onRespond(request, { cancelled: true })}
            className="text-muted-foreground"
          >
             {t("chat.cancel")}
          </Button>
          {request.method === "confirm" ? (
            <Button type="button" onClick={submitValue}>
               {t("chat.confirm")}
            </Button>
          ) : request.method === "select" ? (
            <Button
              type="button"
              onClick={submitValue}
              disabled={selectedOption === null}
              autoFocus={request.options.length === 0}
            >
               {t("chat.confirm")}
            </Button>
          ) : (
            <Button type="button" onClick={submitValue}>
               {t("chat.submit")}
            </Button>
          )}
        </div>
        )}
      </DialogContent>
      </Dialog>
      )}
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function ExtensionCustomPanel({
  request,
  waitingCount,
  onInput,
}: {
  request: ExtensionCustomRequest;
  /** Further custom panels queued behind this one; each opens after this one closes. */
  waitingCount: number;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Same panel-anchored official Dialog as the request drawer.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const dialogMaxHeight = useDialogMaxHeight(wrapperRef);
  const displayLines = normalizeCustomPanelLines(request.lines);
  const summary = displayLines.map(stripAnsi).find((line) => line.trim())?.trim();

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus();
  }, [collapsed]);

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        setPortalHost(node);
      }}
      className={cn("absolute inset-0 z-[95] flex justify-center p-5 pointer-events-none", collapsed ? "items-start" : "items-center")}
    >
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          className="pointer-events-auto flex h-auto w-full max-w-[min(920px,100%)] cursor-pointer items-center justify-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-left font-normal text-foreground shadow-lg hover:bg-background hover:text-foreground"
        >
          <span className="shrink-0 text-xs font-[650] text-primary">
            {t("chat.extensionPending")}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("chat.extensionPanel")}
          </span>
          {summary && (
            <span className="max-w-[34%] shrink truncate text-xs text-muted-foreground">
              {summary}
            </span>
          )}
          <ExtensionWaitingCount count={waitingCount} />
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("chat.extensionExpand")}
          </span>
        </Button>
      ) : (
      <Dialog open modal={false}>
      <DialogContent
        container={portalHost}
        showCloseButton={false}
        overlayClassName="hidden"
        aria-label={t("chat.extensionPanel")}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        // The extension already wrapped its lines to the width it asked for; show them
        // whole when that is wider than the usual 920px instead of scrolling sideways.
        className="pointer-events-auto static top-auto left-auto mx-auto translate-x-0 translate-y-0 flex w-max min-w-[min(920px,100%)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background shadow-2xl outline-none"
        style={{
          // Bounded by the panel that holds it, so a tall editor cannot push the
          // drawer past the chat area and clip its header.
          maxHeight: dialogMaxHeight,
        }}
      >
        <Textarea
          ref={inputRef}
           aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          className="absolute h-px min-h-0 w-px border-0 p-0 opacity-0 shadow-none pointer-events-none"
        />
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2.5">
           <div className="text-sm font-[650] text-foreground">{t("chat.extensionPanel")}</div>
          <div className="flex items-center gap-2">
            <ExtensionWaitingCount count={waitingCount} />
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              title={t("chat.extensionCollapse")}
              aria-label={t("chat.extensionCollapse")}
              className="size-7 shrink-0 rounded-md"
            >
              <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onInput(request, "\x03")}
              className="text-muted-foreground"
            >
               {t("chat.close")}
            </Button>
          </div>
        </div>
        <pre className="m-0 min-h-0 overflow-auto bg-card p-3.5 text-sm leading-[1.45] text-foreground font-mono whitespace-pre">
          <AnsiText text={displayLines.join("\n")} />
        </pre>
      </DialogContent>
      </Dialog>
      )}
    </div>
  );
}
