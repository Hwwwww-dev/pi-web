"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  BotIcon,
  BugIcon,
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  FileTextIcon,
  GitBranchIcon,
  HistoryIcon,
  LoaderCircleIcon,
  MenuIcon,
  MoonIcon,
  PanelRightIcon,
  PenLineIcon,
  ShieldAlertIcon,
  SunIcon,
  WrenchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "@/lib/utils";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar, type SelectSessionOptions, type SessionSidebarControl } from "./SessionSidebar";
import { KeepAliveDock } from "./KeepAliveDock";
import { ChatWindow } from "./ChatWindow";
import { NewSessionContextBar, type NewSessionContextControl } from "./NewSessionContextBar";
import type { ChatScrollPosition } from "@/lib/chat-scroll-position";
import { FileViewer } from "./FileViewer";
import { GitPanel } from "./GitPanel";
import { TabBar, type Tab } from "./TabBar";
import { openFileTab, saveFileViewerState, saveParkedFileViewerState, switchFileWorkspace, type ParkedFileWorkspace } from "./file-tab-state";
import { SettingsPanel, SettingsSectionIcon } from "./SettingsPanel";
import { Toaster } from "./ui/sonner";
import { ProjectTrustDialog, type ProjectTrustFailure } from "./ProjectTrustDialog";
import { BranchNavigator, hasSessionBranches } from "./BranchNavigator";
import { SystemPromptPanel } from "./SystemPromptPanel";
import { ToolDefinitionsPanel } from "./ToolDefinitionsPanel";
import { AgentSessionPanel } from "./AgentSessionPanel";
import { DebugPanel, DebugPanelBoundary } from "./DebugPanel";
import { SessionChatPanel } from "./SessionChatPanel";
import { TerminalPanel } from "./TerminalPanel";
import { newTerminalTab, restoreTerminalTabs, TERMINAL_TABS_KEY, type TerminalTab } from "./terminal-tab-state";
import { useTheme } from "@/hooks/useTheme";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile, useIsNarrowMobile } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useAudio } from "@/hooks/useAudio";
import { copyText } from "@/lib/clipboard";
import { sendAgentCommand } from "@/lib/agent-client";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import {
  claimExtensionAttentionNotification,
  shouldShowBrowserNotification,
  showBrowserNotification,
} from "@/lib/browser-notifications";
import { setupPushSubscription } from "@/lib/push-client";
import { startPageVisibilityTracking } from "@/lib/page-debug";
import type { DebugClientSession } from "@/lib/debug-types";
import { getInitialNavigation, linkedSessionId, withTabOpen } from "@/lib/initial-navigation";
import { clearTabOpenSession, getTabOpen, setTabOpenNewSession, setTabOpenSession } from "@/lib/tab-session";
import { mergeCatalogRow } from "./session-catalog-helpers";
import { getDraft, parkedNewSessionDraftKey, rekeyDraft } from "@/lib/draft-store";
import {
  contextForCwd,
  type NewSessionContext,
  type NewSessionMove,
  type NewSessionOptions,
  type NewSessionTarget,
  type ProjectChoice,
} from "@/lib/new-session-context";
import {
  DEFAULT_KEEP_ALIVE_CONFIG,
  DORMANT_AFTER_MS,
  loadKeepAliveConfig,
  loadKeepAliveSlotRecords,
  saveKeepAliveConfig,
  saveKeepAliveSlots,
  upsertKeepAliveSlot,
  type ChatKeepAliveConfig,
  type KeepAliveSlot,
} from "@/lib/chat-keepalive";
import { clearLastOpen, getLastOpenSession, setLastOpenSession, workspaceKeyOf } from "@/lib/workspace-memory";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import { skillExpansionToCommand } from "@/lib/slash-display";
import type { BlockingExtensionUiRequest, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { McpErrorResponse, ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { AgentEndInfo, NewSessionChoices } from "@/hooks/useAgentSession";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { formatActiveDuration, formatCompactCount } from "@/lib/session-stats-format";
import type { FileViewerState } from "@/lib/file-viewer-state";
import { PRESET_READ_ONLY, type ToolEntry } from "@/lib/tool-presets";
import { createSideChat, deleteSideChat } from "@/lib/side-chat-client";
import { getAgentsBadge, getSessionFamily, isHiddenRelation, sideChatNameFrom, sideChatTitle } from "@/lib/session-family";
import { getLastSettingsSection, type SettingsSection } from "@/lib/settings-navigation";
import { focusIfLost } from "@/lib/stacked-dialog";

type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";
type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

// 顶栏控件统一为 shadcn ghost Button：面板开着时以 bg-accent 文字色浮起，
// 不再有描边胶囊/联排底座。
const HEADER_CONTROL_OPEN = "bg-accent text-foreground";

/** Right-panel Git tab id; closing it removes the tab, the sidebar entry reopens it. It owns no FileViewer. */
const GIT_TAB_ID = "git";
const GIT_PANEL_TAB: Tab = { id: GIT_TAB_ID, label: "", filePath: "", kind: "git" };
const AGENT_PANEL_WIDTH = 420;
// The footer's version readout (the draft's mono version at the row's end).
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const PI_VERSION = process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0";
// pi's built-in tools that never change a file; any other tool may (#1144).
const READ_ONLY_TOOL_NAMES = new Set(PRESET_READ_ONLY);
const TOOL_END_REFRESH_MS = 1000;

/** Panel tab id of the last sub-agent tab, or null when there is none. */
function lastAgentTabId(tabs: readonly { sessionId: string }[]): string | null {
  const last = tabs.at(-1);
  return last ? `agent:${last.sessionId}` : null;
}

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation, setInitialNavigation] = useState(() => getInitialNavigation(searchParams));
  // The system-theme subscription stays mounted for the app's lifetime; the
  // header's light/dark pill writes through the same hook.
  const { theme, setThemePreference } = useTheme();
  // Restore fonts even when Settings and the chat composer have not been opened.
  useFontPreferences();
  const { locale, t: translate } = useI18n();
  const isMobile = useIsMobile();
  const isNarrowMobile = useIsNarrowMobile();
  useViewportHeight();

  // Once the user has granted notification permission, register a Web Push
  // subscription so the server can notify backgrounded PWAs (notably iOS,
  // which suspends page JS and never receives the SSE completion event).
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    void setupPushSubscription(locale);
  }, [locale]);
  // Audio ownership lives here (not in ChatWindow) so the completion tone can
  // also fire for tasks finishing in a non-active workspace whose ChatWindow
  // is not mounted. ChatWindow receives the audio callbacks as props.
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio, holdAudio, soundEnabledRef } = useAudio();
  const [quoteSelectionEnabled, setQuoteSelectionEnabled] = useState(false);
  useEffect(() => {
    try {
      setQuoteSelectionEnabled(localStorage.getItem("pi-quote-selection-enabled") === "true");
    } catch {
      // Browser storage is best-effort.
    }
  }, []);
  const handleQuoteSelectionChange = useCallback((enabled: boolean) => {
    setQuoteSelectionEnabled(enabled);
    try {
      localStorage.setItem("pi-quote-selection-enabled", String(enabled));
    } catch {
      // Keep the current page usable when storage is unavailable.
    }
  }, []);
  const handleKeepAliveConfigChange = useCallback((config: ChatKeepAliveConfig) => {
    setKeepAliveConfig(saveKeepAliveConfig(config));
  }, []);
  const notifiedAttentionRequestIdsRef = useRef(new Set<string>());
  // Sessions that finished while the tab was out of sight (#1484): the browser
  // Notification fires for the selected session, which the sidebar's unread
  // markers exclude ("already looking" — false while hidden). The favicon keeps
  // their badge until the tab is opened again; never persisted, never dotted.
  const [hiddenFinishedSessionIds, setHiddenFinishedSessionIds] = useState<Set<string>>(new Set());
  const handleBackgroundTaskDone = useCallback(() => {
    if (soundEnabledRef.current) playDoneSound();
  }, [playDoneSound, soundEnabledRef]);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // Latest selection readable from async callbacks whose captured state is
  // stale (e.g. a delete that completes after the user navigated away).
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
  const [sessionCatalog, setSessionCatalog] = useState<SessionInfo[]>([]);
  const handleSessionsChange = useCallback((sessions: SessionInfo[]) => {
    setSessionCatalog(sessions);
    // The sidebar hydrates metadata after the selected session has already
    // mounted. Merge that update into the active session without changing the
    // ChatWindow key or restarting its history load.
    setSelectedSession((current) => {
      if (!current) return current;
      const refreshed = sessions.find((session) => session.id === current.id);
      return refreshed ? mergeCatalogRow(current, refreshed) : current;
    });
  }, []);
  const sessionsWithSelection = useMemo(() => {
    if (!selectedSession) return sessionCatalog;
    return [
      ...sessionCatalog.filter((session) => session.id !== selectedSession.id),
      selectedSession,
    ];
  }, [selectedSession, sessionCatalog]);

  // Completion notifications must name the session that finished, which can be
  // a keep-alive background window while another session is selected. The list
  // is read through a latest-ref so handleAgentEnd stays referentially stable.
  const latestSessionsRef = useRef(sessionsWithSelection);
  latestSessionsRef.current = sessionsWithSelection;
  const activeSessionFamily = useMemo(
    () => getSessionFamily(sessionsWithSelection, selectedSession?.id),
    [selectedSession?.id, sessionsWithSelection],
  );
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  // Dormant keep-alive slots: hidden beyond the window drop their message DOM and reload on reactivation.
  const [dormantSlotIds, setDormantSlotIds] = useState<Set<string>>(() => new Set());
  const handleRunningSessionIdsChange = useCallback((ids: Set<string>) => {
    setRunningSessionIds((previous) => {
      if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) return previous;
      return ids;
    });
  }, []);
  // Source of truth stays in the sidebar's poll; the keep-alive dock reads the
  // reported set for its unread dots.
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => new Set());
  const handleUnreadSessionIdsChange = useCallback((ids: Set<string>) => {
    setUnreadSessionIds((previous) => {
      if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) return previous;
      return ids;
    });
  }, []);
  const agentsBadge = activeSessionFamily ? getAgentsBadge(activeSessionFamily.subagents, runningSessionIds) : null;
  const agentsButtonLabel = agentsBadge?.running
    ? translate("agentSwitcher.titleRunning", { count: agentsBadge.count })
    : translate("agentSwitcher.title");
  // The temporary id distinguishes consecutive fresh composers in one cwd.
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [newSessionDraftId, setNewSessionDraftId] = useState("initial");
  const activeNewSessionDraftKeyRef = useRef<string | null>(null);
  // The bar above a fresh composer (NewSessionContextBar): the sidebar reports
  // what it shows and carries out its moves, which remount the composer. Its
  // model and reasoning picks, as it last reported them, go along with the
  // draft to the composer that replaces it, which takes them once.
  const sidebarControlRef = useRef<SessionSidebarControl | null>(null);
  const [sidebarNewSessionContext, setSidebarNewSessionContext] = useState<NewSessionContext | null>(null);
  // The bar's last move until the sidebar reports that cwd (a commit later),
  // so the bar of the new composer shows the target's project, and a worktree
  // it just created, from its first frame.
  const newSessionMoveRef = useRef<NewSessionMove | null>(null);
  const handleSidebarNewSessionContext = useCallback((context: NewSessionContext | null) => {
    if (context && context.cwd === newSessionMoveRef.current?.cwd) newSessionMoveRef.current = null;
    setSidebarNewSessionContext(context);
  }, []);
  const newSessionBarFocusRef = useRef<NewSessionContextControl | null>(null);
  const newSessionChoicesRef = useRef<NewSessionChoices | null>(null);
  const [carriedNewSessionChoices, setCarriedNewSessionChoices] = useState<NewSessionChoices | null>(null);
  const handleNewSessionChoicesChange = useCallback((choices: NewSessionChoices) => {
    newSessionChoicesRef.current = choices;
    setCarriedNewSessionChoices(null);
  }, []);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  // Keep-alive chat slots: previously selected sessions stay mounted hidden so
  // switching back is instant and their runs keep updating in the background.
  const [keepAliveSlots, setKeepAliveSlots] = useState<KeepAliveSlot[]>([]);
  const [keepAliveConfig, setKeepAliveConfig] = useState<ChatKeepAliveConfig>(DEFAULT_KEEP_ALIVE_CONFIG);
  useEffect(() => {
    setKeepAliveConfig(loadKeepAliveConfig());
  }, []);
  // Slots are browser-tab memory otherwise; persist the identities so a page
  // refresh (or PWA relaunch) restores the dock instead of dropping it.
  const keepAliveSlotsRestoredRef = useRef(false);
  useEffect(() => {
    if (keepAliveSlotsRestoredRef.current || sessionCatalog.length === 0) return;
    keepAliveSlotsRestoredRef.current = true;
    const records = loadKeepAliveSlotRecords();
    if (records.length === 0) return;
    const cutoff = Date.now() - keepAliveConfig.idleTimeoutMinutes * 60_000;
    setKeepAliveSlots((slots) => {
      const known = new Set(slots.map((slot) => slot.session.id));
      const additions = records
        .filter((record) => !known.has(record.id) && record.lastActiveAt >= cutoff)
        .map((record) => {
          const session = sessionCatalog.find((candidate) => candidate.id === record.id);
          return session ? { session, lastActiveAt: record.lastActiveAt, epoch: record.epoch } : null;
        })
        .filter((slot): slot is KeepAliveSlot => slot !== null);
      if (additions.length === 0) return slots;
      const merged = [...slots, ...additions];
      if (merged.length <= keepAliveConfig.maxSessions) return merged;
      return [...merged].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, keepAliveConfig.maxSessions);
    });
  }, [sessionCatalog, keepAliveConfig.idleTimeoutMinutes, keepAliveConfig.maxSessions]);
  useEffect(() => {
    if (!keepAliveSlotsRestoredRef.current) return;
    saveKeepAliveSlots(keepAliveSlots);
  }, [keepAliveSlots]);
  /** Forces a keep-alive slot's ChatWindow to remount (trust change, session reload). */
  const bumpKeepAliveSlot = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId) return;
    setKeepAliveSlots((slots) => slots.map((slot) => (slot.session.id === sessionId ? { ...slot, epoch: slot.epoch + 1, lastActiveAt: Date.now() } : slot)));
  }, []);
  // Evict keep-alive slots after the idle timeout; the visible session is immune.
  useEffect(() => {
    const timer = setInterval(() => {
      setKeepAliveSlots((slots) => {
        const cutoff = Date.now() - keepAliveConfig.idleTimeoutMinutes * 60_000;
        const next = slots.filter((slot) => slot.session.id === selectedSession?.id || slot.lastActiveAt >= cutoff);
        return next.length === slots.length ? slots : next;
      });
    }, 30_000);
    return () => clearInterval(timer);
  }, [keepAliveConfig.idleTimeoutMinutes, selectedSession?.id]);
  // Apply a reduced maxSessions setting immediately (keep most-recent slots).
  useEffect(() => {
    setKeepAliveSlots((slots) => {
      if (slots.length <= keepAliveConfig.maxSessions) return slots;
      return [...slots].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, keepAliveConfig.maxSessions);
    });
  }, [keepAliveConfig.maxSessions]);
  const sessionScrollPositionsRef = useRef(new Map<string, ChatScrollPosition>());
  const handleSessionScrollPositionChange = useCallback((sessionId: string, position: ChatScrollPosition) => {
    sessionScrollPositionsRef.current.set(sessionId, position);
  }, []);
  const [searchTarget, setSearchTarget] = useState<{ sessionId: string; entryId: string; blockIndex?: number } | null>(null);
  const handleSearchTargetHandled = useCallback((target: { sessionId: string; entryId: string }) => {
    setSearchTarget((current) => current === target ? null : current);
  }, []);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  // The plain Settings button opens a phone's Settings on its list of sections; shortcuts open theirs.
  const [settingsOpenAtHome, setSettingsOpenAtHome] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<ProjectTrustFailure | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !initialNavigation.sidebarCollapsed);
  const desktopSidebarOpenRef = useRef(!initialNavigation.sidebarCollapsed);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const rightPanelFullWidth = rightPanelOpen && rightPanelExpanded && !isMobile;
  useEffect(() => {
    if (!rightPanelOpen || isMobile) setRightPanelExpanded(false);
  }, [rightPanelOpen, isMobile]);
  const [mobileToolbarMoreOpen, setMobileToolbarMoreOpen] = useState(false);
  const moreControlsLabel = mobileToolbarMoreOpen ? translate("chat.close") : translate("chat.moreControls");
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
      }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
      }),
    [sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  // Mobile drawer actions must not change the remembered desktop preference.
  useEffect(() => {
    setSidebarOpen(isMobile ? false : desktopSidebarOpenRef.current);
  }, [isMobile]);
  // The sidebar's toast is sonner's, fixed to the viewport (outside this
  // drawer): on a phone, closing the drawer dismisses it, where the old
  // in-sidebar toast slid away with the drawer.
  useEffect(() => {
    if (isMobile && !sidebarOpen) toast.dismiss();
  }, [isMobile, sidebarOpen]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  // `/side <prompt>`: the text that seeds the side chat's composer, until its panel consumes it.
  const [pendingQuotePrompt, setPendingQuotePrompt] = useState<{ sessionId: string; text: string } | null>(null);
  const [sideChatPrompts, setSideChatPrompts] = useState<Record<string, string>>({});
  const topBarRef = useRef<HTMLDivElement>(null);
  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const [branchSwitchLocked, setBranchSwitchLocked] = useState(false);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);
  const sessionHasBranches = hasSessionBranches(branchTree);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void, locked: boolean) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    setBranchSwitchLocked(locked);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [systemTools, setSystemTools] = useState<ToolEntry[] | null>(null);
  const [mcpServers, setMcpServers] = useState<{ total: number; ready: number; needsAuth: number } | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);
  const systemInfoLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const systemInfoLoadIdRef = useRef(0);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
    setSystemInfoLoading(false);
  }, []);

  const handleSystemToolsChange = useCallback((tools: ToolEntry[] | null) => {
    setSystemTools(tools);
  }, []);

  const handleMcpServersChange = useCallback((summary: { total: number; ready: number; needsAuth: number } | null) => {
    setMcpServers(summary);
  }, []);

  const handleSystemInfoLoaderChange = useCallback((loader: (() => Promise<void>) | null) => {
    systemInfoLoadIdRef.current += 1;
    systemInfoLoaderRef.current = loader;
    setSystemInfoLoading(false);
  }, []);

  // The debug panel's reader of the chat's own state: kept in a ref, so registering renders
  // nothing, and read only by the open panel (DebugPanel), never on AppShell's renders.
  const debugSnapshotReaderRef = useRef<(() => DebugClientSession) | null>(null);
  const handleDebugSnapshotReaderChange = useCallback((reader: (() => DebugClientSession) | null) => {
    debugSnapshotReaderRef.current = reader;
  }, []);
  // The panel reports the page's visibility history from the first mount on, opened or not.
  useEffect(() => {
    startPageVisibilityTracking();
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"agents" | "branches" | "system" | "tools" | "session" | "debug" | null>(null);

  useEffect(() => {
    if (!sessionHasBranches) {
      setActiveTopPanel((panel) => panel === "branches" ? null : panel);
    }
  }, [sessionHasBranches]);

  useEffect(() => {
    if (!activeSessionFamily) {
      setActiveTopPanel((panel) => panel === "agents" ? null : panel);
    }
  }, [activeSessionFamily]);

  useEffect(() => {
    if (rightPanelFullWidth) setActiveTopPanel(null);
  }, [rightPanelFullWidth]);

  const toggleTopPanel = useCallback((
    panel: "agents" | "branches" | "system" | "tools" | "session" | "debug",
    keepMobileToolbarOpen = false,
  ) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
    if (isMobile && isNarrowMobile && keepMobileToolbarOpen) setMobileToolbarMoreOpen(true);
  }, [isMobile, isNarrowMobile]);

  // The Debug button on screen (one of its three places at a time); Escape gives focus back to it.
  const debugButtonRef = useRef<HTMLButtonElement | null>(null);

  // Escape inside the debug panel; it never closes another panel that took its place. With focus
  // in the panel, that focus leaves the page with it: once the panel is gone (the next frame), the
  // Debug button gets it back, unless the user moved it meanwhile (focusIfLost).
  const closeDebugPanel = useCallback((restoreFocus: boolean) => {
    setActiveTopPanel((panel) => panel === "debug" ? null : panel);
    if (restoreFocus) requestAnimationFrame(() => focusIfLost(document, debugButtonRef.current));
  }, []);

  const handleSystemInfoToggle = useCallback((
    panel: "system" | "tools",
    keepMobileToolbarOpen = false,
  ) => {
    const opening = activeTopPanel !== panel;
    toggleTopPanel(panel, keepMobileToolbarOpen);
    if (!opening || systemInfoLoading) return;

    const load = systemInfoLoaderRef.current;
    if (!load) return;
    const loadId = ++systemInfoLoadIdRef.current;
    setSystemInfoLoading(true);
    void load().catch((error) => {
      console.error("Failed to load system information:", error);
    }).finally(() => {
      if (systemInfoLoadIdRef.current === loadId) {
        setSystemInfoLoading(false);
      }
    });
  }, [activeTopPanel, systemInfoLoading, toggleTopPanel]);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setMobileToolbarMoreOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  // The composer opens Settings too: a bare /mcp opens Settings › MCP (useAgentSession).
  const openSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsOpenAtHome(false);
    setSettingsSection(section);
  }, []);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    setSidebarOpen((open) => {
      const next = !open;
      if (!isMobile) desktopSidebarOpenRef.current = next;
      return next;
    });
  }, [isMobile]);

  // The ⋯ toolbar menu (Radix DropdownMenu) reports its next state here; the
  // drawer folds only on phones and only when the menu is opening, and no top
  // panel may stay open under it.
  const handleMobileToolbarMoreOpenChange = useCallback((open: boolean) => {
    if (isMobile && open) setSidebarOpen(false);
    // 不在这里清 top panel：Debug/系统/工具定义的开关就在本菜单里，菜单打开
    // 先杀面板、选中再 toggle，等于永远关不掉；互斥由 toggleTopPanel 保证。
    setMobileToolbarMoreOpen(open);
  }, [isMobile]);

  const handleRightPanelToggle = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setActiveTopPanel(null);
      setMobileToolbarMoreOpen(false);
    }
    setRightPanelOpen((open) => !open);
  }, [isMobile]);

  const handleRightPanelExpandToggle = useCallback(() => {
    setActiveTopPanel(null);
    setRightPanelExpanded((expanded) => !expanded);
  }, []);

  useEffect(() => {
    setMobileToolbarMoreOpen(false);
  }, [isMobile, isNarrowMobile, selectedSession?.id, newSessionDraftId]);

  // Files unmount when inactive; workspace terminals stay mounted until closed.
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  // One-shot line target for the next mount of a file tab's viewer; cleared as
  // soon as it has been rendered so switching tabs away and back does not replay it.
  const fileLineTargetRef = useRef<{ tabId: string; line: number } | null>(null);
  const fileWorkspaceStatesRef = useRef(new Map<string, ParkedFileWorkspace>());
  // Bumped on every workspace switch. The active viewer reports its state as
  // it unmounts, tagged with the generation it rendered in, so the report of a
  // tab just parked goes to its workspace, not to a same-path tab restored.
  const [fileWorkspaceGeneration, setFileWorkspaceGeneration] = useState(0);
  const fileWorkspaceGenerationRef = useRef(0);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [terminalsRestored, setTerminalsRestored] = useState(false);
  // The Git tab is opened from the sidebar entry and removed by its × like any other tab.
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  // Subagent work tabs are session-scoped and transient: no persistence, and
  // they are dropped when the project changes (they belong to its sessions).
  const [agentTabs, setAgentTabs] = useState<{ sessionId: string; label: string; side?: boolean }[]>([]);
  const panelTabs: Tab[] = [...(gitPanelOpen ? [GIT_PANEL_TAB] : []), ...fileTabs, ...terminalTabs.map((tab) => ({
    id: tab.id,
    label: getFileName(tab.cwd) || tab.cwd,
    filePath: tab.cwd,
    kind: "terminal" as const,
    closing: Boolean(tab.closing),
  })), ...agentTabs.map((tab) => {
    const session = tab.side ? sessionCatalog.find((item) => item.id === tab.sessionId) : undefined;
    const label = session ? sideChatTitle(session, tab.label) : tab.label;
    return {
      id: `agent:${tab.sessionId}`,
      label,
      filePath: label,
      kind: (tab.side ? "side" : "agent") as "agent" | "side",
    };
  })];

  useEffect(() => {
    try {
      const saved = restoreTerminalTabs(window.sessionStorage.getItem(TERMINAL_TABS_KEY));
      setTerminalTabs(saved.tabs);
      // activeId namespaces: "git" → git tab; 32-hex → a restored terminal tab.
      // Anything else (e.g. "file:" ids — file tabs are not persisted) is dropped.
      if (saved.activeId === GIT_TAB_ID) {
        setActiveFileTabId(saved.activeId);
        setRightPanelOpen(saved.open);
        setGitPanelOpen(true);
      } else if (saved.activeId && saved.tabs.some((tab) => tab.id === saved.activeId)) {
        setActiveFileTabId(saved.activeId);
        setRightPanelOpen(saved.open);
      }
    } catch { /* storage is optional */ }
    setTerminalsRestored(true);
  }, []);

  useEffect(() => {
    if (!terminalsRestored) return;
    try {
      window.sessionStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify({
        tabs: terminalTabs.map(({ id, cwd }) => ({ id, cwd })),
        activeId: activeFileTabId,
        open: rightPanelOpen,
      }));
    } catch { /* storage is optional */ }
  }, [terminalTabs, activeFileTabId, rightPanelOpen, terminalsRestored]);

  const handleFileViewerStateChange = useCallback((
    generation: number,
    tabId: string,
    viewerRevision: number,
    viewerState: FileViewerState,
  ) => {
    if (generation !== fileWorkspaceGenerationRef.current) {
      saveParkedFileViewerState(fileWorkspaceStatesRef.current, generation, tabId, viewerRevision, viewerState);
      return;
    }
    setFileTabs((prev) => saveFileViewerState(prev, tabId, viewerRevision, viewerState));
  }, []);

  const changeFileWorkspace = useCallback((currentKey: string | null, nextKey: string) => {
    if (currentKey === nextKey) return;
    const activeFileId = activeFileTabId?.startsWith("file:") ? activeFileTabId : null;
    const next = switchFileWorkspace(fileWorkspaceStatesRef.current, currentKey, nextKey, {
      tabs: fileTabs,
      activeTabId: activeFileId,
      open: rightPanelOpen && Boolean(activeFileId),
    }, fileWorkspaceGenerationRef.current);
    fileWorkspaceGenerationRef.current += 1;
    setFileWorkspaceGeneration(fileWorkspaceGenerationRef.current);
    setFileTabs(next.tabs);
    // Subagent tabs belong to the previous project's sessions: dropped, not parked.
    setAgentTabs([]);
    // Terminal tabs span workspaces and keep control of the panel while active.
    if (!activeFileTabId || activeFileId || activeFileTabId.startsWith("agent:")) {
      setActiveFileTabId(next.activeTabId);
      setRightPanelOpen(next.open);
    }
  }, [activeFileTabId, fileTabs, rightPanelOpen]);

  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const initialSessionId = initialNavigation.sessionId;
  const initialLinkedSessionId = linkedSessionId(initialNavigation);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectKeyRef = useRef<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // sessionStorage is empty during SSR. Applying the tab's remembered session
  // in the useState initializer made the first client tree differ from the
  // server HTML (sidebar "select project" vs ""). Restore after mount instead.
  useLayoutEffect(() => {
    const next = withTabOpen(initialNavigation, getTabOpen());
    if (next === initialNavigation) return;
    setInitialNavigation(next);
    if (next.sessionId) setInitialSessionRestored(false);
  }, [initialNavigation]);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  // Set when the session the URL linked to is gone: the project the sidebar
  // adopts next keeps a fresh composer instead of restoring its last session.
  const skipWorkspaceRestoreRef = useRef(false);
  // Guards the async workspace restore so a slow response from an earlier
  // switch cannot resurrect a session into a project the user already left.
  const workspaceRestoreTokenRef = useRef(0);

  const invalidateWorkspaceRestore = useCallback(() => {
    workspaceRestoreTokenRef.current += 1;
  }, []);

  // Persist every active-session transition, including new and forked sessions
  // that bypass the sidebar selection handler. The memory is per tab (session
  // storage), so a reload keeps this tab's own session instead of following
  // another tab's last pick. New session is a selection too: remember the
  // composer cwd so reload stays on that UI instead of resurrecting the
  // previous chat.
  useEffect(() => {
    if (selectedSession) {
      const projectKey = selectedSession.projectKey
        ?? activeProjectKeyRef.current
        ?? workspaceKeyOf(selectedSession);
      setLastOpenSession(projectKey, selectedSession.id);
      setTabOpenSession(selectedSession.id);
      return;
    }
    if (newSessionCwd) setTabOpenNewSession(newSessionCwd);
  }, [newSessionCwd, selectedSession]);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        const draftId = `initial:${requestedCwd}`;
        setNewSessionDraftId(draftId);
        activeNewSessionDraftKeyRef.current = `new:${draftId}:${data.cwd}`;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
        if (!new URLSearchParams(window.location.search).get("cwd")) {
          router.replace(`?cwd=${encodeURIComponent(data.cwd)}`, { scroll: false });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation, router]);

  // Restore the workspace's last open session after switching to it. Called
  // from handleCwdChange once the outgoing context has been reset. The session
  // is looked up against the live list so a deleted or drifted session falls
  // back to the default welcome page instead of erroring.
  const restoreWorkspaceContext = useCallback((projectKey: string, cwd: string) => {
    const token = ++workspaceRestoreTokenRef.current;
    const lastOpenSessionId = getLastOpenSession(projectKey);
    if (!lastOpenSessionId) return;
    const adopt = (d: { sessions: SessionInfo[] } | null) => {
      if (token !== workspaceRestoreTokenRef.current) return; // stale switch
      const s = d?.sessions.find((x) => x.id === lastOpenSessionId);
      if (!s) {
        // The list loaded but the remembered session is gone — forget it.
        // When the list itself failed (d === null) keep the memory so a
        // later switch retries the restore.
        if (d) clearLastOpen(projectKey);
        return;
      }
      if (workspaceKeyOf(s) !== projectKey) {
        // Defensive: the remembered session drifted out of this workspace.
        clearLastOpen(projectKey);
        return;
      }
      // Keep the temporary composer's draft in its cwd, even when the
      // remembered session belongs to another worktree of this project.
      const activeDraftKey = activeNewSessionDraftKeyRef.current;
      if (activeDraftKey) {
        rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(cwd));
      }
      activeNewSessionDraftKeyRef.current = null;
      // Selecting the session must remount the chat with the session
      // present: useAgentSession loads content in a mount-only effect, so
      // the null-session welcome mount from the switch would never load
      // the restored session's messages.
      setSelectedSession(s);
      setSessionKey((k) => k + 1);
      if (new URLSearchParams(window.location.search).get("session") !== s.id) {
        router.replace(`?session=${encodeURIComponent(s.id)}`, { scroll: false });
      }
    };
    // Fast path: the sidebar already delivered the catalogue — restore
    // without waiting on a fresh /api/sessions round trip.
    if (sessionCatalog.length > 0) {
      adopt({ sessions: sessionCatalog });
      return;
    }
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then(adopt)
      .catch(() => {
        // Network hiccup: keep the remembered session for a later retry.
      });
  }, [router, sessionCatalog]);

  const handleCwdChange = useCallback((
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => {
    invalidateWorkspaceRestore();
    const currentFreshCwd = newSessionCwd ?? activeCwd;
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount).
    if (!cwd) return;
    const skipWorkspaceRestore = skipWorkspaceRestoreRef.current;
    skipWorkspaceRestoreRef.current = false;
    const newProject = projectKey ?? projectRoot ?? cwd;
    const currentProject = activeProjectKeyRef.current
      ?? (selectedSession ? workspaceKeyOf(selectedSession) : null);
    activeProjectKeyRef.current = newProject;

    // Keep the project identity in sync during the initial URL restore without
    // remounting the just-created or restored chat.
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // The server may hydrate a normalized key after a custom cwd is already
    // active. Updating identity for the exact same cwd is not a user switch.
    if (currentFreshCwd === cwd && currentProject !== newProject) return;
    // Existing sessions stay open when the worktree selector moves within the
    // same project. A fresh composer must remount when its effective cwd moves,
    // otherwise its already-created runtime would keep sending to the old cwd.
    if (
      currentProject === newProject
      && (selectedSession !== null || currentFreshCwd === cwd)
    ) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    const previousDraftKey = activeNewSessionDraftKeyRef.current;
    if (previousDraftKey && currentFreshCwd) {
      rekeyDraft(previousDraftKey, parkedNewSessionDraftKey(currentFreshCwd));
    }
    const draftId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const draftKey = `new:${draftId}:${cwd}`;
    rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    setNewSessionDraftId(draftId);
    activeNewSessionDraftKeyRef.current = draftKey;
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setBranchSwitchLocked(false);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    // The debug panel stays open across the switch: it follows whichever session is shown.
    setActiveTopPanel((panel) => panel === "debug" ? panel : null);
    if (currentProject !== newProject) {
      // Keep #281's project isolation, but park each workspace's file tabs
      // instead of discarding them so they return when the user switches back.
      changeFileWorkspace(currentProject, newProject);
      // Restore the workspace we switched to: its last open session, or keep
      // the default welcome page when none is remembered.
      if (!skipWorkspaceRestore) restoreWorkspaceContext(newProject, cwd);
    }
    router.replace(typeof window !== "undefined" ? window.location.pathname : "/", { scroll: false });
  }, [activeCwd, changeFileWorkspace, invalidateWorkspaceRestore, newSessionCwd, router, selectedSession, restoreWorkspaceContext]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false, entryId?: string, blockIndex?: number, options?: SelectSessionOptions) => {
    invalidateWorkspaceRestore();
    setSearchTarget(entryId ? { sessionId: session.id, entryId, blockIndex } : null);
    const activeDraftKey = activeNewSessionDraftKeyRef.current;
    const activeDraftCwd = newSessionCwd ?? (selectedSession === null ? activeCwd : null);
    if (activeDraftKey && activeDraftCwd) {
      rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(activeDraftCwd));
    }
    activeNewSessionDraftKeyRef.current = null;
    // Adopt an explicitly selected session before the sidebar reports its cwd.
    const projectKey = workspaceKeyOf(session);
    if (activeProjectKeyRef.current !== projectKey) {
      changeFileWorkspace(activeProjectKeyRef.current, projectKey);
      setActiveTopPanel((panel) => panel === "debug" ? panel : null);
    }
    activeProjectKeyRef.current = projectKey;
    // Re-clicking the already-open session must not remount the chat and
    // re-run the full load/positioning cycle. Only skip when the effective
    // cwd context already matches — otherwise a pending cwd move still needs
    // the full re-select flow.
    if (!isRestore && selectedSession) {
      const sameProject =
        workspaceKeyOf(selectedSession) === workspaceKeyOf(session);
      if (selectedSession.id === session.id && sameProject) {
        if (isMobile) setSidebarOpen(false);
        return;
      }
    }
    setNewSessionCwd(null);
    setSelectedSession(session);
    // Keep-alive: switching sessions must not remount the chat. The selected
    // session gets/keeps a slot; a remount epoch is only bumped for paths that
    // must reload from disk (URL restore flow, cwd move on the same session).
    const now = Date.now();
    const needsRemount = isRestore || selectedSession?.id === session.id;
    setKeepAliveSlots((slots) => {
      const touched = slots.map((slot) => (slot.session.id === selectedSession?.id ? { ...slot, lastActiveAt: now } : slot));
      return upsertKeepAliveSlot(touched, session, now, keepAliveConfig.maxSessions, needsRemount);
    });
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setBranchSwitchLocked(false);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick
    // (unless the sidebar still has something to show: a fork's row and toast).
    if (isMobile && !isRestore && !options?.keepSidebarOpen) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when the URL already has this session — calling
    // replace in production Next.js triggers a Suspense remount loop.
    // Tab-memory restore lands on `/` and must write `?session=` so reload
    // and copy-link keep this session.
    if (!isRestore || new URLSearchParams(window.location.search).get("session") !== session.id) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [activeCwd, changeFileWorkspace, invalidateWorkspaceRestore, router, isMobile, newSessionCwd, selectedSession, keepAliveConfig.maxSessions]);

  const handleNewSession = useCallback((sessionId: string, cwd: string, projectKey?: string | null, options?: NewSessionOptions) => {
    invalidateWorkspaceRestore();
    const draftKey = `new:${sessionId}:${cwd}`;
    // Leaving a fresh composer for another cwd parks its draft there, as a
    // workspace switch does; New in the same cwd still starts empty. The bar
    // above the composer moves the composer instead: its draft (the live
    // text, as promoteNewSession takes it) and its model picks go along.
    const activeDraftKey = activeNewSessionDraftKeyRef.current;
    const activeDraftCwd = newSessionCwd ?? (selectedSession === null ? activeCwd : null);
    if (options?.carryComposer && selectedSession === null && activeDraftKey) {
      const input = chatInputRef.current;
      if (input) input.rekeyDraft(activeDraftKey, draftKey);
      else rekeyDraft(activeDraftKey, draftKey);
      setCarriedNewSessionChoices(newSessionChoicesRef.current);
    } else if (activeDraftKey && activeDraftCwd && activeDraftCwd !== cwd) {
      rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(activeDraftCwd));
    }
    // Adopt the target project before the sidebar reports its cwd, as an
    // explicit session pick does. Without a key (Ctrl+Alt+N) the current cwd
    // keeps its project.
    const targetProject = projectKey ?? (cwd === activeCwd ? activeProjectKeyRef.current : null) ?? cwd;
    if (activeProjectKeyRef.current !== targetProject) {
      changeFileWorkspace(activeProjectKeyRef.current, targetProject);
    }
    activeProjectKeyRef.current = targetProject;
    // A draft parked in this cwd comes back, unless one was carried here: it
    // stays parked for the next time, never merged into what was carried.
    if (!getDraft(draftKey)) rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    activeNewSessionDraftKeyRef.current = draftKey;
    setNewSessionDraftId(sessionId);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setBranchSwitchLocked(false);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel((panel) => panel === "debug" ? panel : null);
    if (isMobile) setSidebarOpen(false);
    router.replace(`?cwd=${encodeURIComponent(cwd)}`, { scroll: false });
    // The fresh composer takes the caret once it renders (#1313), unless the
    // move came from the new-session bar, whose control keeps focus instead
    // (newSessionBarFocusRef), or a phone would raise the keyboard for it.
    // A dialog still open over the page (Ctrl+Alt+N under Settings) keeps it.
    if (!isMobile && !newSessionBarFocusRef.current) {
      requestAnimationFrame(() => {
        if (document.activeElement?.closest("[aria-modal='true']")) return;
        chatInputRef.current?.focus();
      });
    }
  }, [activeCwd, changeFileWorkspace, invalidateWorkspaceRestore, isMobile, newSessionCwd, router, selectedSession]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectKey, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (
          prev?.id === sessionId
            ? { ...prev, ...full, transient: full.transient ?? false }
            : prev
        ));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo, sourceDraftKey: string) => {
    setRefreshKey((k) => k + 1);
    if (activeNewSessionDraftKeyRef.current !== sourceDraftKey) return;
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setNewSessionCwd(null);
    setSelectedSession(session);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession, invalidateWorkspaceRestore]);

  const deliverSessionNotification = useCallback(({
    targetSession,
    title,
    body,
    tag,
  }: {
    targetSession: SessionInfo | null;
    title: string;
    body: string;
    tag?: string;
  }) => {
    if (!("Notification" in window)) return;

    const fire = () => {
      const sessionUrl = targetSession ? `/?session=${encodeURIComponent(targetSession.id)}` : "/";
      void showBrowserNotification({
        title,
        body,
        sessionUrl,
        tag,
        onClick: () => {
          window.focus();
          if (targetSession) handleSelectSession(targetSession);
        },
      });
    };

    if (Notification.permission === "granted") {
      fire();
      void setupPushSubscription(locale);
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") {
          fire();
          void setupPushSubscription(locale);
        }
      });
    }
  }, [handleSelectSession, locale]);

  const handleAgentEnd = useCallback((end: AgentEndInfo) => {
    // The sidebar's reload merges the selected session's new row into it
    // (handleSessionsChange), so no list fetch of its own here.
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    if (selectedSession) hydrateSelectedSession(selectedSession.id);

    if (end.aborted || end.subagentsActive || isHiddenRelation(selectedSession?.relation)) return;
    if (!shouldShowBrowserNotification()) return;
    const targetSession = end.sessionId
      ? latestSessionsRef.current.find((session) => session.id === end.sessionId) ?? selectedSession
      : selectedSession;
    if (targetSession?.relation?.kind === "subagent") return;
    if (targetSession) {
      setHiddenFinishedSessionIds((prev) => {
        if (prev.has(targetSession.id)) return prev;
        const next = new Set(prev);
        next.add(targetSession.id);
        return next;
      });
    }
    deliverSessionNotification({
      targetSession,
      title: targetSession?.name ?? translate("i18n.sessionComplete"),
      body: translate("i18n.taskFinished"),
      tag: targetSession ? `pi-session-complete:${targetSession.id}` : "pi-session-complete",
    });
  }, [deliverSessionNotification, hydrateSelectedSession, selectedSession, translate]);

  // The badge is for an unseen tab: opening it puts the finished chat on screen.
  useEffect(() => {
    const clearIfSeen = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      setHiddenFinishedSessionIds((prev) => (prev.size === 0 ? prev : new Set()));
    };
    clearIfSeen();
    document.addEventListener("visibilitychange", clearIfSeen);
    window.addEventListener("focus", clearIfSeen);
    return () => {
      document.removeEventListener("visibilitychange", clearIfSeen);
      window.removeEventListener("focus", clearIfSeen);
    };
  }, []);

  const handleAttentionNeeded = useCallback((request: BlockingExtensionUiRequest) => {
    if (isHiddenRelation(selectedSession?.relation)) return;
    if (!shouldShowBrowserNotification()) return;
    if (!claimExtensionAttentionNotification(request, notifiedAttentionRequestIdsRef.current)) return;

    deliverSessionNotification({
      targetSession: selectedSession,
      title: translate("i18n.attentionNeeded"),
      body: request.method === "custom"
        ? translate("i18n.extensionInputNeeded")
        : request.title,
      tag: `pi-extension-ui:${request.id}`,
    });
  }, [deliverSessionNotification, selectedSession, translate]);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  // A run's writes show in the file tree as they happen, not only when it ends
  // (#1144): at most one refresh a second, after any tool but the read-only ones.
  const toolEndRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleToolEnd = useCallback((toolName: string) => {
    if (READ_ONLY_TOOL_NAMES.has(toolName) || toolEndRefreshTimerRef.current) return;
    toolEndRefreshTimerRef.current = setTimeout(() => {
      toolEndRefreshTimerRef.current = null;
      setExplorerRefreshKey((k) => k + 1);
    }, TOOL_END_REFRESH_MS);
  }, []);
  useEffect(() => () => {
    if (toolEndRefreshTimerRef.current) clearTimeout(toolEndRefreshTimerRef.current);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
      transient: false,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession, invalidateWorkspaceRestore]);

  const handleAskInNewChat = useCallback(async (
    prompt: string,
    sourceSessionId: string,
    sourceEntryId: string,
  ) => {
    const result = await sendAgentCommand<{ newSessionId?: string }>(sourceSessionId, {
      type: "fork_branch",
      entryId: sourceEntryId,
    });
    if (!result?.newSessionId) throw new Error(translate("chat.quoteForkFailed"));
    setPendingQuotePrompt({ sessionId: result.newSessionId, text: prompt });
    handleSessionForked(result.newSessionId);
  }, [handleSessionForked, translate]);

  // Shared fallback: replace the on-screen session with a fresh new-chat draft
  // for the same cwd.
  const openNewSessionDraftForCwd = useCallback((cwd: string | null) => {
    const draftId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setNewSessionDraftId(draftId);
    activeNewSessionDraftKeyRef.current = cwd ? `new:${draftId}:${cwd}` : null;
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel(null);
    router.replace(cwd ? `?cwd=${encodeURIComponent(cwd)}` : (typeof window !== "undefined" ? window.location.pathname : "/"), { scroll: false });
  }, [router]);

  // Dismissing a keep-alive slot must leave nothing behind: the ChatWindow
  // unmounts with the slot, and its parked scroll position goes too, so the
  // next open is a full reload instead of a half-restored session. Closing
  // the on-screen slot advances to its dock neighbor, or falls back to a
  // fresh new-chat draft when no slot remains.
  const handleKeepAliveDismiss = useCallback((sessionId: string) => {
    sessionScrollPositionsRef.current.delete(sessionId);
    const closedIndex = keepAliveSlots.findIndex((slot) => slot.session.id === sessionId);
    const remaining = keepAliveSlots.filter((slot) => slot.session.id !== sessionId);
    setKeepAliveSlots(remaining);
    if (selectedSession?.id !== sessionId) return;
    if (remaining.length > 0) {
      // Advance like a browser tab: the next slot in dock order, wrapping to
      // the last one when the closed slot was at the end.
      handleSelectSession(remaining[Math.min(closedIndex, remaining.length - 1)].session);
      return;
    }
    clearTabOpenSession(sessionId);
    openNewSessionDraftForCwd(selectedSession.cwd ?? null);
  }, [keepAliveSlots, selectedSession, handleSelectSession, openNewSessionDraftForCwd]);

  // Remove every keep-alive slot except the session currently on screen.
  const handleKeepAliveDismissAll = useCallback(() => {
    setKeepAliveSlots((slots) => {
      const selectedId = selectedSession?.id;
      for (const slot of slots) {
        if (slot.session.id !== selectedId) sessionScrollPositionsRef.current.delete(slot.session.id);
      }
      return slots.filter((slot) => slot.session.id === selectedId);
    });
  }, [selectedSession?.id]);

  // The sidebar calls this when the initial session is not in its list.
  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
    if (initialLinkedSessionId) skipWorkspaceRestoreRef.current = true;
  }, [initialLinkedSessionId]);

  // Stable for the memoized ChatWindow: only clears the one-shot quote prompt.
  const handleInitialPromptConsumed = useCallback(() => {
    setPendingQuotePrompt(null);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    invalidateWorkspaceRestore();
    setRefreshKey((k) => k + 1);
    sessionScrollPositionsRef.current.delete(sessionId);
    // The DELETE can outlive a session switch: this callback's captured
    // selectedSession is from the delete click. Read the latest selection
    // and only fall back to the empty composer when the user is still on
    // the deleted session at the moment removal completes.
    const active = selectedSessionRef.current;
    setKeepAliveSlots((slots) => slots.filter((slot) => slot.session.id !== sessionId));
    if (active?.id === sessionId) {
      clearTabOpenSession(sessionId);
      const cwd = active.cwd;
      const draftId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      setNewSessionDraftId(draftId);
      activeNewSessionDraftKeyRef.current = cwd ? `new:${draftId}:${cwd}` : null;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setBranchSwitchLocked(false);
      setSystemPrompt(null);
      setSystemTools(null);
      setSystemInfoLoading(false);
      setActiveTopPanel((panel) => panel === "debug" ? panel : null);
      router.replace(cwd ? `?cwd=${encodeURIComponent(cwd)}` : (typeof window !== "undefined" ? window.location.pathname : "/"), { scroll: false });
    }
  }, [invalidateWorkspaceRestore, router]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff"; page?: number; line?: number },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const page = options?.page;
    const line = options?.line;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => openFileTab(prev, {
      fileName,
      filePath,
      modeHint,
      page,
      line,
      sourceSessionId,
      tabId,
    }));
    if (line !== undefined) fileLineTargetRef.current = { tabId, line };
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string, options?: { page?: number; line?: number }) => {
    handleOpenFile(filePath, getFileName(filePath), {
      sourceSessionId: selectedSession?.id ?? null,
      page: options?.page,
      line: options?.line,
    });
  }, [handleOpenFile, selectedSession?.id]);

  const handleOpenTerminal = useCallback((cwd: string) => {
    const existing = terminalTabs.find((tab) => tab.cwd === cwd);
    const tab = existing ?? newTerminalTab(cwd);
    if (!existing) setTerminalTabs((tabs) => [...tabs, tab]);
    setActiveFileTabId(tab.id);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [terminalTabs, isMobile]);

  const handleOpenGitPanel = useCallback(() => {
    setGitPanelOpen(true);
    setActiveFileTabId(GIT_TAB_ID);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Subagent work opens in a right-panel tab instead of hijacking the main chat.
  const handleOpenSubagentTab = useCallback((sessionId: string, label: string, side?: boolean) => {
    setAgentTabs((prev) => {
      if (prev.some((tab) => tab.sessionId === sessionId)) return prev;
      // Every side chat has the same name, and `/side` can be used again and
      // again: the lowest number no open tab shows tells them apart.
      let numbered = label;
      for (let number = 2; side && prev.some((tab) => tab.label === numbered); number += 1) numbered = `${label} ${number}`;
      return [...prev, { sessionId, label: numbered, ...(side ? { side: true } : {}) }];
    });
    setActiveFileTabId(`agent:${sessionId}`);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // The agent switcher's side-panel button: opens a subagent's tab, or closes
  // it when the open panel already has it (the panel closes with its last tab).
  // The switcher stays open beside the panel, except on phones, where the
  // panel covers the chat.
  const openSubagentTabIds = useMemo(
    () => new Set(rightPanelOpen ? agentTabs.map((tab) => tab.sessionId) : []),
    [agentTabs, rightPanelOpen],
  );
  const handleToggleSubagentTab = (sessionId: string, label: string, side?: boolean) => {
    if (openSubagentTabIds.has(sessionId)) {
      handleCloseFileTab(`agent:${sessionId}`);
      return;
    }
    if (isMobile) setActiveTopPanel(null);
    handleOpenSubagentTab(sessionId, label, side);
  };

  // `/side` landed (hooks/useAgentSession): open the forked chat's tab, seed
  // its composer when the command carried a prompt, and refresh the list so
  // the family's badge folds the new member in.
  const handleSideSession = useCallback((session: SessionInfo, prompt: string | null) => {
    if (prompt) setSideChatPrompts((prev) => ({ ...prev, [session.id]: prompt }));
    handleOpenSubagentTab(session.id, sideChatTitle(session, (prompt && sideChatNameFrom(prompt)) || translate("sideChat.title")), true);
    setRefreshKey((key) => key + 1);
  }, [handleOpenSubagentTab, translate]);

  // The switcher's New side chat, on the main agent's row, whichever family member the main chat shows.
  const handleNewSideChat = useCallback(async (rootSessionId: string) => {
    const result = await createSideChat(rootSessionId, translate);
    if ("error" in result) return result.error;
    if (isMobile) setActiveTopPanel(null);
    handleSideSession(result.session, null);
    return null;
  }, [handleSideSession, isMobile, translate]);

  // A side chat's first prompt names it: read the name when a run in an open tab starts or ends.
  const runningSideTabs = agentTabs.filter((tab) => tab.side && runningSessionIds.has(tab.sessionId)).map((tab) => tab.sessionId).join();
  useEffect(() => {
    if (runningSideTabs) setRefreshKey((key) => key + 1);
  }, [runningSideTabs]);

  const handleTerminalClosed = (tab: TerminalTab) => {
    const replacement = tab.closing === "restart" ? newTerminalTab(tab.cwd) : null;
    const remaining = terminalTabs.filter((item) => item.id !== tab.id);
    setTerminalTabs((tabs) => tabs.flatMap((item) => item.id !== tab.id ? [item] : replacement ? [replacement] : []));
    setActiveFileTabId((current) => current !== tab.id ? current : replacement?.id ?? remaining.at(-1)?.id ?? fileTabs.at(-1)?.id ?? lastAgentTabId(agentTabs));
    if (!replacement && !remaining.length && !fileTabs.length && !agentTabs.length) setRightPanelOpen(false);
  };

  const handleCloseFileTab = useCallback((tabId: string) => {
    if (tabId === GIT_TAB_ID) {
      setGitPanelOpen(false);
      setActiveFileTabId((current) => current === GIT_TAB_ID ? null : current);
      if (!fileTabs.length && !terminalTabs.length) setRightPanelOpen(false);
      return;
    }
    if (terminalTabs.some((tab) => tab.id === tabId)) {
      setTerminalTabs((tabs) => tabs.map((tab) => tab.id === tabId && !tab.closing ? { ...tab, closing: "close" } : tab));
      return;
    }
    if (tabId.startsWith("agent:")) {
      const remainingAgents = agentTabs.filter((tab) => `agent:${tab.sessionId}` !== tabId);
      setAgentTabs(remainingAgents);
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        return fileTabs.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? lastAgentTabId(remainingAgents);
      });
      if (fileTabs.length === 0 && terminalTabs.length === 0 && remainingAgents.length === 0) setRightPanelOpen(false);
      return;
    }
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0 && terminalTabs.length === 0 && agentTabs.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.at(-1)?.id ?? terminalTabs.at(-1)?.id ?? lastAgentTabId(agentTabs);
    });
  }, [fileTabs, terminalTabs, agentTabs]);

  // The Agents switcher's Delete on a side chat: its tab goes with it, and the
  // main chat showing it goes back to the parent, as the Main agent row does
  // (`handleSessionDeleted` would leave the family for a fresh composer).
  const handleDeleteSideChat = useCallback(async (sessionId: string, root: SessionInfo): Promise<string | null> => {
    const result = await deleteSideChat(sessionId);
    if (result) return result.error;
    handleCloseFileTab(`agent:${sessionId}`);
    if (selectedSessionRef.current?.id === sessionId) {
      handleSelectSession(root);
      setRefreshKey((key) => key + 1);
    } else {
      handleSessionDeleted(sessionId);
    }
    return null;
  }, [handleCloseFileTab, handleSelectSession, handleSessionDeleted]);

  // One session, one chat: opening a subagent or side chat in the main chat closes its tab.
  const selectedSessionId = selectedSession?.id;
  useEffect(() => {
    if (agentTabs.some((tab) => tab.sessionId === selectedSessionId)) handleCloseFileTab(`agent:${selectedSessionId}`);
  }, [agentTabs, handleCloseFileTab, selectedSessionId]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    // selectedSession.id is a server-generated uuid; enforce the internal
    // export route so the redirect target can never leave this origin.
    const id = encodeURIComponent(selectedSession.id);
    if (!/^[A-Za-z0-9-]+$/.test(id)) return;
    const url = `/api/sessions/${id}/export?inline=1`;
    if (!url.startsWith("/api/sessions/")) return;
    // pi-lens-ignore: no-open-redirect
    window.open(url, "_blank", "noopener,noreferrer");
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const newSessionDraftKey = selectedSession === null && effectiveNewSessionCwd
    ? `new:${newSessionDraftId}:${effectiveNewSessionCwd}`
    : null;
  useLayoutEffect(() => {
    activeNewSessionDraftKeyRef.current = newSessionDraftKey;
  }, [newSessionDraftKey]);

  // The bar above a fresh composer. Only a fresh composer moves, and only
  // somewhere else: the folder in use would remount it for nothing. The
  // control the move came from takes focus in the bar of the new composer.
  const handlePickNewSessionContext = useCallback((target: NewSessionTarget, from: NewSessionContextControl) => {
    if (selectedSession !== null || !effectiveNewSessionCwd || target.cwd === effectiveNewSessionCwd) return;
    newSessionBarFocusRef.current = from;
    // A worktree just created already left its move, with the branch.
    if (target.projectKey && target.projectRoot && newSessionMoveRef.current?.cwd !== target.cwd) {
      newSessionMoveRef.current = { cwd: target.cwd, project: { key: target.projectKey, root: target.projectRoot }, branch: null };
    }
    sidebarControlRef.current?.startNewSessionIn({ ...target, carryComposer: true });
  }, [effectiveNewSessionCwd, selectedSession]);
  // The folder picker answers later: its pick runs the newest closure, guard included.
  const pickNewSessionContextRef = useRef(handlePickNewSessionContext);
  pickNewSessionContextRef.current = handlePickNewSessionContext;
  const handleOpenFolderForNewSession = useCallback((opener: HTMLElement | null) => {
    sidebarControlRef.current?.openFolderForNewSession((target) => pickNewSessionContextRef.current(target, "project"), opener);
  }, []);
  const handleDefaultDirectoryForNewSession = useCallback(() => {
    sidebarControlRef.current?.openDefaultDirectoryForNewSession((target) => pickNewSessionContextRef.current(target, "project"));
  }, []);
  const handleRefreshNewSessionWorktrees = useCallback(() => {
    sidebarControlRef.current?.refreshWorktrees();
  }, []);
  const handleCreateNewSessionWorktree = useCallback(async (project: ProjectChoice, branch: string) => {
    const control = sidebarControlRef.current;
    if (!control) throw new Error("The session sidebar is not mounted");
    const result = await control.createWorktree(project, branch);
    // The bar moves there next, before any report lists it.
    if ("path" in result) newSessionMoveRef.current = { cwd: result.path, project, branch };
    return result;
  }, []);
  const handleNewSessionBarFocusDone = useCallback(() => {
    newSessionBarFocusRef.current = null;
  }, []);
  const newSessionContextBar = selectedSession === null && effectiveNewSessionCwd ? (
    <NewSessionContextBar
      context={contextForCwd(sidebarNewSessionContext, effectiveNewSessionCwd, newSessionMoveRef.current)}
      mobile={isMobile}
      initialFocus={newSessionBarFocusRef.current}
      onInitialFocusDone={handleNewSessionBarFocusDone}
      onPick={handlePickNewSessionContext}
      onUseDefaultDirectory={handleDefaultDirectoryForNewSession}
      onOpenFolder={handleOpenFolderForNewSession}
      onRefreshWorktrees={handleRefreshNewSessionWorktrees}
      onCreateWorktree={handleCreateNewSessionWorktree}
    />
  ) : null;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // The visible session renders from its keep-alive slot when it has one; the
  // slot keeps the instance mounted across switches so re-selecting is instant.
  const activeSlot = selectedSession
    ? keepAliveSlots.find((slot) => slot.session.id === selectedSession.id) ?? null
    : null;
  // Recompute dormancy on a slow interval and whenever slots/running sets move;
  // dormant slots keep their instance (drafts, identity) but lose the message list.
  useEffect(() => {
    const recompute = () => {
      const now = Date.now();
      const next = new Set<string>();
      for (const slot of keepAliveSlots) {
        if (slot.session.id === activeSlot?.session.id) continue;
        if (runningSessionIds.has(slot.session.id)) continue;
        if (now - slot.lastActiveAt <= DORMANT_AFTER_MS) continue;
        next.add(slot.session.id);
      }
      setDormantSlotIds((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id))) ? prev : next);
    };
    recompute();
    const timer = setInterval(recompute, 60_000);
    return () => clearInterval(timer);
  }, [keepAliveSlots, runningSessionIds, activeSlot]);
  const activeChatSession = activeSlot ? activeSlot.session : selectedSession;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  // The Debug button shows with a chat only: without one, its panel would have nothing to close it.
  useEffect(() => {
    if (!showChat) setActiveTopPanel((panel) => panel === "debug" ? null : panel);
  }, [showChat]);

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    // The answer also lists the project's MCP servers (`mcpFile`, `mcpServers`), unused here: the
    // trust dialog fetches the listing again when it opens, since the file can change in between.
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & Partial<McpErrorResponse>;
      if (!response.ok || data.error) {
        // The dialog translates the reason; the English error is only its diagnostic.
        setProjectTrustError({ error: data.error ?? `HTTP ${response.status}`, ...(data.reason ? { reason: data.reason } : {}) });
        return;
      }
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
      bumpKeepAliveSlot(selectedSession?.id);
    } catch (error) {
      setProjectTrustError({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd, bumpKeepAliveSlot, selectedSession?.id]);

  // The restricted-mode banner and Settings › MCP's trust notice open the same dialog.
  const openProjectTrustDialog = useCallback(() => {
    setProjectTrustError(null);
    setProjectTrustDialogOpen(true);
  }, []);

  // Settings › MCP added a project server: `.pi/mcp.json` alone makes a folder require trust, and a
  // fresh folder was trusted in the same step. Every mounted section reloads in place on the new
  // status (projectTrustReloadKey); nothing was rebuilt, so the chat needs no new session key.
  const handleProjectTrustChanged = useCallback((cwd: string, status: ProjectTrustStatus) => {
    if (cwd === projectTrustCwd) setProjectTrust(status);
  }, [projectTrustCwd]);

  const activeFileTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;

  // The viewer consumed the line target as a prop during this render; drop it so
  // later remounts (tab switches) restore the saved scroll position instead.
  useEffect(() => {
    fileLineTargetRef.current = null;
  }, [activeFileTabId, activeFileTab?.viewerRevision]);

  // Subagent work tabs: like files, only the active one is mounted.
  const activeAgentTab = agentTabs.find((tab) => `agent:${tab.sessionId}` === activeFileTabId) ?? null;

// Tab title truncation: budget measured in CJK character widths (1 per full-width
// char, 0.5 per half-width char like letters and digits).

function truncateSessionTitle(title: string, maxWidth = 20): string {
  let width = 0;
  let result = "";
  for (const char of Array.from(title)) {
    const charWidth = (char.codePointAt(0) ?? 0) > 0xff ? 1 : 0.5;
    if (width + charWidth > maxWidth) return `${result}…`;
    width += charWidth;
    result += char;
  }
  return result;
}
  const activeSessionTitle = selectedSession
    ? (selectedSession.name
        || skillExpansionToCommand(selectedSession.firstMessage)
        || selectedSession.firstMessage
        || selectedSession.id.slice(0, 12)).trim()
    : null;
  const windowTitle = activeSessionTitle ? truncateSessionTitle(activeSessionTitle) : "Pi Web";

  useEffect(() => {
    // A head-wide observer writing document.title synchronously in its
    // callback self-fed on foreign head churn (extension content scripts)
    // into an endless microtask loop that froze the tab. Keep the write in a
    // macrotask and only watch the <title> element itself; direct head
    // children are watched solely to re-attach when that element is replaced.
    let titleEl = document.head?.querySelector("title") ?? null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;

    const syncWindowTitle = () => {
      if (resyncTimer === null && document.title !== windowTitle) {
        resyncTimer = setTimeout(() => {
          resyncTimer = null;
          if (document.title !== windowTitle) document.title = windowTitle;
        }, 0);
      }
    };

    const observer = new MutationObserver(() => {
      if (!titleEl?.isConnected) {
        titleEl = document.head?.querySelector("title") ?? null;
        if (titleEl) observer.observe(titleEl, { childList: true, subtree: true, characterData: true });
      }
      syncWindowTitle();
    });
    if (titleEl) observer.observe(titleEl, { childList: true, subtree: true, characterData: true });
    if (document.head) observer.observe(document.head, { childList: true });

    syncWindowTitle();
    return () => {
      if (resyncTimer !== null) clearTimeout(resyncTimer);
      observer.disconnect();
    };
  }, [windowTitle]);

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        controlRef={sidebarControlRef}
        onNewSessionContextChange={handleSidebarNewSessionContext}
        initialSessionId={initialSessionId}
        initialSessionLinked={initialLinkedSessionId !== null}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        onOpenTerminal={handleOpenTerminal}
        onOpenGitPanel={handleOpenGitPanel}
        explorerRefreshKey={explorerRefreshKey}
        onExplorerRefresh={handleExplorerRefresh}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        onBackgroundTaskDone={handleBackgroundTaskDone}
        hiddenFinishedSessionIds={hiddenFinishedSessionIds}
        onRunningSessionIdsChange={handleRunningSessionIdsChange}
        onSessionsChange={handleSessionsChange}
        onUnreadSessionIdsChange={handleUnreadSessionIdsChange}
      />
      {/* The draft's footer: one settings row, the version at the row's end.
          Models and skills live in Settings alone. */}
      <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-2.5 pb-2.5 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSettingsOpenAtHome(true);
            setSettingsSection(getLastSettingsSection(projectTrustCwd));
          }}
          title={translate("common.settings")}
          aria-label={translate("common.settings")}
          className="min-w-0 shrink justify-start gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground"
        >
          <SettingsSectionIcon section="general" size={14} strokeWidth={2} />
          <span className="truncate">{translate("common.settings")}</span>
        </Button>
        <span
          className="ml-auto shrink-0 font-mono text-[11px] leading-none tabular-nums text-muted-foreground opacity-70"
          title={`pi-web ${APP_VERSION} · pi ${PI_VERSION}`}
        >
          v{APP_VERSION}
        </span>
      </div>
    </>
  );

  const renderProjectTrustWarning = (mobileBanner: boolean) => {
    if (!showChat || !projectTrust?.requiresTrust || projectTrust.trusted) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={openProjectTrustDialog}
        aria-label={translate("trust.resourcesNotLoaded")}
        className={cn(
          "shrink-0 gap-1.5 text-left text-[11px] font-normal leading-[1.35] text-warning hover:bg-warning/10 hover:text-warning",
          mobileBanner
            ? "h-auto min-h-8 w-full justify-start rounded-none border-b border-border bg-warning/10 px-3 py-1.5"
            : "self-center justify-center rounded-full bg-warning/10 px-3",
        )}
        data-mobile-trust-banner={mobileBanner ? "true" : undefined}
      >
        <ShieldAlertIcon className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="min-w-0">{translate("trust.resourcesNotLoaded")}</span>
      </Button>
    );
  };

  // The Agents count badge (the draft's green-tinted mono count); a run
  // lights the 5px breathing dot inside it.
  const renderAgentsBadge = (badge: { count: number; running: boolean }) => (
    <span
      aria-hidden="true"
      className="flex h-4 min-w-4 shrink-0 items-center justify-center gap-0.5 rounded-full bg-success/15 px-1 font-mono text-[10.5px] font-semibold leading-none tabular-nums text-success"
    >
      {badge.count}
      {badge.running && <span className="size-[5px] shrink-0 rounded-full bg-success motion-safe:animate-pulse" />}
    </span>
  );

  // The Agents switcher (Popover): a ghost control that raises onto the bar
  // (bg-accent) while its panel is open. A narrow phone shows it beside the
  // More menu instead of folding it into that menu: the bar has the room, and
  // the badge stays in sight. A run lights the 5px breathing dot.
  const renderAgentsButton = (mobile: boolean) => (
    <Popover
      open={activeTopPanel === "agents" && Boolean(activeSessionFamily)}
      onOpenChange={() => toggleTopPanel("agents", mobile && !isNarrowMobile)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeSessionFamily}
              aria-label={agentsButtonLabel}
              aria-pressed={activeTopPanel === "agents"}
              className={cn(
                "gap-1.5 rounded-md font-medium text-muted-foreground",
                activeTopPanel === "agents" && HEADER_CONTROL_OPEN,
              )}
              data-mobile-toolbar-action={mobile ? "agents" : undefined}
            >
              <BotIcon data-icon className="size-3.5" strokeWidth={1.9} />
              {agentsBadge && agentsBadge.count > 0 && renderAgentsBadge(agentsBadge)}
              <span className="hidden min-[1240px]:inline">{translate("agentSwitcher.title")}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{agentsButtonLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent
        // 标准弹层本体（bg-popover + border + shadow-md）；清单由 AgentSessionPanel
        // 给出，这里只负责定位（贴触发钮右缘）、宽度（AGENT_PANEL_WIDTH）与
        // z-500（高于引用工具栏的层序）。
        align="end"
        className="z-[500] w-[var(--agent-panel-width)] max-w-[calc(100vw-1.5rem)] overflow-hidden p-1"
        style={{ "--agent-panel-width": `${AGENT_PANEL_WIDTH}px` } as React.CSSProperties}
      >
        {activeSessionFamily && selectedSession && (
          <AgentSessionPanel
            rootSession={activeSessionFamily.root}
            subagents={activeSessionFamily.subagents}
            selectedSessionId={selectedSession.id}
            runningSessionIds={runningSessionIds}
            onSelectSession={handleSelectSession}
            openSubagentTabIds={openSubagentTabIds}
            onToggleSubagentTab={handleToggleSubagentTab}
            onNewSideChat={() => handleNewSideChat(activeSessionFamily.root.id)}
            onDeleteSideChat={(sessionId) => handleDeleteSideChat(sessionId, activeSessionFamily.root)}
          />
        )}
      </PopoverContent>
    </Popover>
  );

  // Branch / history / ⋯: plain ghost controls. The BranchNavigator dropdown
  // hangs under the whole bar (containerRef), so the branch control only
  // toggles it.
  const renderToolbarBGroup = (mobile: boolean) => (
    <div className="flex shrink-0 items-center gap-0.5" role="group">
      {/* A narrow phone keeps only the ⋯ control: branch and history live in
          its menu there. */}
      <DropdownMenu open={mobileToolbarMoreOpen} onOpenChange={handleMobileToolbarMoreOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={debugButtonRef}
                variant="ghost"
                size="icon-sm"
                aria-label={moreControlsLabel}
                aria-expanded={mobileToolbarMoreOpen}
                data-mobile-toolbar-more="true"
                className={cn(
                  "rounded-md text-muted-foreground",
                  mobileToolbarMoreOpen && HEADER_CONTROL_OPEN,
                )}
              >
                <EllipsisIcon data-icon strokeWidth={2} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{moreControlsLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          id="mobile-toolbar-actions"
          className="w-64 p-1.5"
          data-mobile-toolbar-actions="true"
        >
          {(() => {
            // 上下文压缩后当前消息可能不再包含 user 消息，需同时参考会话文件的消息总数。
            const hasMessages = Boolean(
              selectedSession
              && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
            );
            const disabled = !selectedSession || selectedSession.transient || !hasMessages || autoNameStatus.kind === "naming";
            const isSuccess = autoNameStatus.kind === "success";
            const isError = autoNameStatus.kind === "error";
            const label = autoNameStatus.kind === "naming"
              ? translate("title.generating")
              : isSuccess
                ? translate("title.updated")
                : isError
                  ? translate("title.failed")
                  : translate("title.generate");
            const title = !selectedSession || selectedSession.transient
              ? translate("title.unsaved")
              : !hasMessages
                ? translate("title.noMessages")
                : isError
                  ? autoNameStatus.message
                  : translate("title.generateSession");
            return (
              <DropdownMenuItem
                // Generating keeps its feedback visible in the menu: the select
                // is cancelled so Radix leaves the menu open while it runs.
                onSelect={(event) => {
                  event.preventDefault();
                  void handleAutoName();
                }}
                disabled={disabled}
                title={title}
                className="gap-2"
                data-mobile-toolbar-action={mobile ? "name" : undefined}
              >
                {autoNameStatus.kind === "naming" ? (
                  <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" strokeWidth={2} />
                ) : isSuccess ? (
                  <CheckIcon className="size-3.5 shrink-0" strokeWidth={2} />
                ) : (
                  <PenLineIcon className="size-3.5 shrink-0" strokeWidth={2} />
                )}
                <span className="min-w-0 flex-1">{label}</span>
                {isError && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-destructive" />}
              </DropdownMenuItem>
            );
          })()}
          <DropdownMenuItem
            onSelect={() => handleSystemInfoToggle("system")}
            disabled={mobile && !showChat}
            title={translate("system.prompt")}
            className="gap-2"
            data-mobile-toolbar-action={mobile ? "system" : undefined}
          >
            <FileTextIcon
              className={cn("size-3.5 shrink-0", systemPrompt ? "text-primary" : "text-dim")}
              strokeWidth={2}
            />
            <span className="min-w-0 flex-1">{translate("system.label")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleSystemInfoToggle("tools")}
            disabled={mobile && !showChat}
            title={translate("tools.title")}
            className="gap-2"
            data-mobile-toolbar-action={mobile ? "tools" : undefined}
          >
            <WrenchIcon
              className={cn(
                "size-3.5 shrink-0",
                systemTools?.some((tool) => tool.active) ? "text-primary" : "text-dim",
              )}
              strokeWidth={2}
            />
            <span className="min-w-0 flex-1">{translate("tools.label")}</span>
            {mcpServers && mcpServers.total > 0 && (
              <span
                title={translate("tools.mcpTooltip", { ready: mcpServers.ready, total: mcpServers.total })}
                className={cn(
                  "shrink-0 font-mono text-[10px] font-semibold tabular-nums",
                  mcpServers.needsAuth > 0 ? "text-warning" : mcpServers.ready > 0 ? "text-primary" : "text-dim",
                )}
              >
                MCP {mcpServers.ready}/{mcpServers.total}
              </span>
            )}
          </DropdownMenuItem>
          {/* The dashboard-header rule: the bar holds only the quiet stats and
              the Agents control; history, branches, Debug and the theme flip
              live in this menu on every width. */}
          <>
            <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleViewFullHistory}
                disabled={!selectedSession}
                title={selectedSession ? translate("history.full") : translate("history.unsaved")}
                className="gap-2"
                data-mobile-toolbar-action="history"
              >
                <HistoryIcon className="size-3.5 shrink-0" strokeWidth={2} />
                <span className="min-w-0 flex-1">{translate("history.label")}</span>
              </DropdownMenuItem>
              {sessionHasBranches && (
                <DropdownMenuItem
                  onSelect={() => toggleTopPanel("branches", true)}
                  title={translate("i18n.branches")}
                  className="gap-2"
                  data-mobile-toolbar-action="branches"
                >
                  <GitBranchIcon
                    className={cn("size-3.5 shrink-0", branchTree.length > 0 ? "text-primary" : "text-dim")}
                    strokeWidth={2}
                  />
                  <span className="min-w-0 flex-1">{translate("i18n.branches")}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => toggleTopPanel("debug", mobile)}
                disabled={!showChat}
                title={translate("debug.title")}
                className="gap-2"
                data-mobile-toolbar-action={mobile ? "debug" : undefined}
              >
                <BugIcon className={cn("size-3.5 shrink-0", activeTopPanel === "debug" ? "text-primary" : "text-dim")} strokeWidth={2} />
                <span className="min-w-0 flex-1">{translate("debug.title")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setThemePreference(theme === "dark" ? "light" : "dark")}
                title={translate("settings.appearance")}
                className="gap-2"
              >
                {theme === "dark"
                  ? <SunIcon className="size-3.5 shrink-0" strokeWidth={2} />
                  : <MoonIcon className="size-3.5 shrink-0" strokeWidth={2} />}
                <span className="min-w-0 flex-1">{translate("settings.appearance")}</span>
              </DropdownMenuItem>
            </>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // Session stats: on a phone the two glanceable values in one chip; on the
  // desktop the draft's badge row (tokens, cost, context with its meter) —
  // the whole group folds away under 1240px. The ctx badge opens the
  // session-info popover, where the full breakdown lives.
  const renderSessionStats = (mobile: boolean) => {
    if (!mobile && (!showChat || (!sessionStats && !contextUsage))) return null;

    const tokens = sessionStats?.tokens;
    const cost = sessionStats?.cost ?? 0;

    // Same thresholds as the old contextColor, as tone classes.
    const contextTone = contextUsage?.contextWindow && contextUsage.percent !== null
      ? (contextUsage.percent > 90
        ? "text-destructive"
        : contextUsage.percent > 70 ? "text-warning" : "text-muted-foreground")
      : "text-muted-foreground";

    const tooltipParts: string[] = [];
    if (tokens) {
      tooltipParts.push(`${translate("session.input")}: ${tokens.input.toLocaleString(locale)}`);
      tooltipParts.push(`${translate("session.output")}: ${tokens.output.toLocaleString(locale)}`);
      tooltipParts.push(`${translate("session.cacheRead")}: ${tokens.cacheRead.toLocaleString(locale)}`);
      tooltipParts.push(`${translate("session.cacheWrite")}: ${tokens.cacheWrite.toLocaleString(locale)}`);
      if (cost > 0) tooltipParts.push(`${translate("session.cost")}: $${cost.toFixed(4)}`);
    }
    if (contextUsage?.contextWindow) {
      const percent = contextUsage.percent;
      tooltipParts.push(`${translate("session.context")}: ${percent !== null ? `${percent.toFixed(1)}%` : "?"} / ${contextUsage.contextWindow.toLocaleString(locale)}`);
    }
    const tooltip = tooltipParts.join("  |  ");

    if (mobile) {
      return (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleTopPanel("session")}
          disabled={!showChat}
          title={tooltip || translate("session.title")}
          aria-label={translate("session.title")}
          aria-pressed={activeTopPanel === "session"}
          className={cn(
            "min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap rounded-md px-2 text-xs font-normal text-muted-foreground",
            !showChat && "cursor-default",
            activeTopPanel === "session" && HEADER_CONTROL_OPEN,
            "enabled:hover:bg-accent enabled:hover:text-foreground",
            "mobile-session-stats",
          )}
          data-mobile-toolbar-stats="true"
        >
          {/* Fixed content: no width-driven reflow. */}
          <span className="inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap">
            {contextUsage?.contextWindow && contextUsage.percent !== null && (
              <span className={cn("text-[11.5px]", contextTone)}>
                <span className="opacity-75">ctx</span> {contextUsage.percent.toFixed(1)}%
              </span>
            )}
            {cost > 0 && (
              <span className="font-mono text-[11.5px] font-medium text-foreground">{cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`}</span>
            )}
          </span>
        </Button>
      );
    }

    const meterPercent = contextUsage?.contextWindow && contextUsage.percent !== null
      ? Math.max(2, Math.min(100, contextUsage.percent))
      : 0;
    return (
      // Plain mono text, the dashboard-header form: no chips, one quiet click
      // target for the per-turn details.
      <Button
        variant="ghost"
        size="sm"
        onClick={() => toggleTopPanel("session")}
        title={tooltip || translate("session.title")}
        aria-label={translate("session.title")}
        aria-pressed={activeTopPanel === "session"}
        className={cn(
          "hidden h-8 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-xs font-normal tabular-nums text-muted-foreground min-[1240px]:inline-flex",
          activeTopPanel === "session" && HEADER_CONTROL_OPEN,
        )}
      >
        {tokens && (
          <span className="inline-flex items-center gap-1">
            <ArrowUpIcon className="size-3" strokeWidth={2} />
            {formatCompactCount(tokens.total)}
          </span>
        )}
        {cost > 0 && <span>{`$${cost >= 0.01 ? cost.toFixed(2) : cost.toFixed(4)}`}</span>}
        {contextUsage?.contextWindow && (
          <span className="inline-flex items-center gap-1">
            <span className={contextTone}>{contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : "?"}</span>
            <span aria-hidden="true" className="text-dim">/</span>
            <span>{formatCompactCount(contextUsage.contextWindow)}</span>
            <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-foreground/15">
              <span
                style={{ width: `${meterPercent}%` }}
                className={cn(
                  "block h-full rounded-full",
                  contextUsage.percent !== null && contextUsage.percent > 90
                    ? "bg-destructive/70"
                    : contextUsage.percent !== null && contextUsage.percent > 70 ? "bg-warning/70" : "bg-foreground/70",
                )}
              />
            </span>
          </span>
        )}
      </Button>
    );
  };

  const renderMainFileToggle = (mobile: boolean) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRightPanelToggle}
          aria-controls="file-panel"
          aria-expanded={rightPanelOpen}
          aria-label={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
          data-mobile-toolbar-file={mobile ? "true" : undefined}
          className={cn(
            "shrink-0 rounded-full text-muted-foreground",
            !mobile && !showChat && "ml-auto",
            rightPanelOpen && HEADER_CONTROL_OPEN,
          )}
        >
          <PanelRightIcon data-icon strokeWidth={2} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}</TooltipContent>
    </Tooltip>
  );

  return (
    <>
    {/* The sidebar's toast (SessionSidebar's showToast): sonner portals it to
        the body, at the viewport's bottom-right, outside the drawer's
        transform below. */}
    <Toaster />
    {/* dashboard-01 的壳层组合：官方 SidebarProvider 供 SidebarTrigger 使用，
        开关状态仍受控于本组件；可拖拽宽度照旧经 --sidebar-width 注入。 */}
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarResizer.width}px`, "--header-height": "3.25rem" } as React.CSSProperties}
      open={sidebarOpen}
      onOpenChange={(next: boolean) => { if (next !== sidebarOpen) handleSidebarToggle(); }}
    >
    <div className="flex h-[var(--app-viewport-height,100dvh)] w-full overflow-hidden bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* Mobile overlay backdrop */}
      <div
        className={cn(
          `sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`,
          "fixed inset-0 z-[199] bg-black/40 transition-opacity duration-[250ms]",
          sidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        inert={rightPanelFullWidth}
        className={cn(
          `sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`,
          "z-[200] flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        )}
        // 可拖拽宽度经 CSS 变量注入（useResizablePanel 写 --sidebar-width），保留 inline。
        style={{ "--sidebar-width": `${sidebarResizer.width}px` } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          inert={rightPanelFullWidth}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Center: chat */}
      <div inert={rightPanelFullWidth} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar with sidebar toggle */}
        {/* Verified 2026-09-23: without a sticky top bar iOS reinstates the
            scroll-edge progressive blur even with an opaque black status bar
            (statusBarStyle: "black"). GRPace's finding from r/iOSBeta: Safari
            treats a sticky/fixed top bar as "the app has its own top bar" and
            skips the blur entirely. Visually a no-op: the bar is already the
            first element. */}
        <div ref={topBarRef} className="sticky top-0 z-[5] shrink-0 bg-background">
        {/* The draft's header: 52px, title + crumb left, the pills right. On a
            phone it folds into two rows — the title row, then the controls. */}
        <header className="flex min-h-(--header-height) shrink-0 items-center gap-2 border-b pt-[env(safe-area-inset-top)] transition-[width,height] ease-linear">
        <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
          {isMobile ? (
            // 手机：两行结构显式成树——标题行（☰ 同行）与控件行各占一行，
            // 不依赖 flex-wrap 断行（basis-full / 断行元素都会被算序挤变形）。
            <div className="flex min-w-0 flex-1 flex-col items-stretch">
              <div className="flex h-10 min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleSidebarToggle}
                  title={translate("sidebar.show")}
                  aria-label={translate("sidebar.show")}
                  className="shrink-0 rounded-md text-muted-foreground"
                >
                  <MenuIcon className="size-4.5" strokeWidth={2} />
                </Button>
                <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                  {activeSessionTitle ?? "Pi Web"}
                </span>
              </div>
              <div
                data-mobile-toolbar="true"
                className="flex h-10 min-w-0 flex-wrap items-center gap-1.5 pb-1"
              >
                {renderSessionStats(true)}
                {renderAgentsButton(true)}
                {renderToolbarBGroup(true)}
                {renderMainFileToggle(true)}
              </div>
            </div>
          ) : (
            <>
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5">
                <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
                  {activeSessionTitle ?? "Pi Web"}
                </h1>
                {selectedSession && (
                  <span className="hidden min-[1240px]:inline-flex shrink-0 items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    <GitBranchIcon className="size-[11px] shrink-0" strokeWidth={2} />
                    {[
                      getFileName(selectedSession.projectRoot ?? selectedSession.cwd),
                      selectedSession.branch,
                    ].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            </>
          )}
          {!isMobile && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {renderProjectTrustWarning(false)}
              {renderSessionStats(false)}
              <Separator orientation="vertical" className="mx-1 h-4 self-center" />
              {renderAgentsButton(false)}
              {renderToolbarBGroup(false)}
              {renderMainFileToggle(false)}
            </div>
          )}
          {sessionHasBranches && (
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={handleBranchLeafChange}
              locked={branchSwitchLocked}
              inline
              compact
              containerRef={topBarRef}
              open={activeTopPanel === "branches"}
              onToggle={() => toggleTopPanel("branches")}
              hasSession={showChat}
              hideInlineButton
            />
          )}
        </div>
        </header>
          {/* Top panels — anchored under the header (the draft's sheet); only
              one open at a time. z-[240] stays below the quote toolbar's 260
              (ChatWindow). */}
          {activeTopPanel === "system" && (
            <div className="absolute inset-x-0 top-full z-[240]">
              <SystemPromptPanel
                loading={systemInfoLoading}
                prompt={systemPrompt}
                translate={translate}
              />
            </div>
          )}
          {activeTopPanel === "tools" && (
            <div className="absolute inset-x-0 top-full z-[240]">
              <ToolDefinitionsPanel
                loading={systemInfoLoading}
                tools={systemTools}
                translate={translate}
              />
            </div>
          )}
          {activeTopPanel === "session" && (
            // 会话信息浮层：标准弹层观感（bg-popover + border + shadow-md）。
            // 开关仍由 toggleTopPanel 驱动，非 Radix Popover；类名保留作 e2e 定位锚。
            <div
              className="session-info-popover absolute top-full right-0 z-[240] max-h-[min(70dvh,560px)] w-[min(360px,calc(100vw-1rem))] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
            >
              {sessionStats ? (() => {
                const totalActiveMs = sessionStats.totalActiveMs ?? 0;
                const ws = selectedSession;
                const sessionRows = [
                   ...(sessionStats.sessionName ? [{ label: translate("session.name"), value: sessionStats.sessionName, copyField: null }] : []),
                   { label: translate("session.file"), value: sessionStats.sessionFile ?? translate("session.inMemory"), copyField: "file" as const },
                   { label: translate("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
                   ...(totalActiveMs > 0 ? [{ label: translate("session.totalActive"), value: formatActiveDuration(totalActiveMs), copyField: null }] : []),
                ];
                const projectRows = [
                  ...(ws ? [{ label: translate("session.projectDir"), value: ws.projectRoot ?? ws.cwd, copyField: "projectDir" as const }] : []),
                  ...(ws?.branch ? [{ label: translate("session.gitBranch"), value: ws.branch, copyField: "gitBranch" as const }] : []),
                  ...(ws?.isWorktree ? [{ label: translate("session.gitWorktree"), value: ws.cwd, copyField: "gitWorktree" as const }] : []),
                ];
                const messageRows = [
                   [translate("session.user"), sessionStats.userMessages.toLocaleString(locale)],
                   [translate("session.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
                   [translate("session.toolCalls"), sessionStats.toolCalls.toLocaleString(locale)],
                   [translate("session.toolResults"), sessionStats.toolResults.toLocaleString(locale)],
                   [translate("session.total"), sessionStats.totalMessages.toLocaleString(locale)],
                ];
                const tokenRows = [
                   [translate("session.input"), sessionStats.tokens.input.toLocaleString(locale)],
                   [translate("session.output"), sessionStats.tokens.output.toLocaleString(locale)],
                   ...(sessionStats.tokens.cacheRead > 0 ? [[translate("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString(locale)]] : []),
                   ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("session.cacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString(locale)]] : []),
                   [translate("session.total"), sessionStats.tokens.total.toLocaleString(locale)],
                ];
                const ctx = contextUsage ?? sessionStats.contextUsage;
                const extraTokenRows = [
                   ...(sessionStats.cost > 0 ? [[translate("session.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                   ...(ctx?.contextWindow ? [[translate("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompactCount(ctx.contextWindow)}`]] : []),
                   // Cache hit rate = cache reads / (input + cache writes + cache reads) — the denominator covers all input-class tokens.
                   ...(sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite > 0 && sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite + sessionStats.tokens.input > 0
                     ? [[translate("session.cacheHitRate"), `${(sessionStats.tokens.cacheRead / (sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite + sessionStats.tokens.input) * 100).toFixed(1)}%`]]
                     : []),
                ];
                const copyTitleKey: Record<SessionCopyField, string> = {
                  file: "session.copyFile",
                  id: "session.copyId",
                  projectDir: "session.copyProjectDir",
                  gitBranch: "session.copyGitBranch",
                  gitWorktree: "session.copyGitWorktree",
                };
                const copyButton = (field: SessionCopyField, value: string) => {
                  const copied = copiedSessionField === field;
                  return (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={copied ? translate("session.copied") : translate(copyTitleKey[field])}
                      onClick={() => handleCopySessionField(field, value)}
                      className={cn(
                        "-mt-0.5 self-start",
                        copied ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {copied ? (
                        <CheckIcon className="size-3" strokeWidth={2} />
                      ) : (
                        <CopyIcon className="size-3" strokeWidth={2} />
                      )}
                    </Button>
                  );
                };
                // The draft's pop rows: label left, mono value right, the copy
                // button at the row's end.
                const section = (
                  title: string,
                  sectionRows: { label: string; value: string; copyField?: SessionCopyField | null }[],
                  valueAlign: "left" | "right" = "left",
                ) => (
                    <div className="min-w-0">
                      <div className="mb-1.5 text-[11px] font-bold text-foreground">{title}</div>
                      <div className="grid grid-cols-[max-content_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5">
                        {sectionRows.map((row) => (
                          <div key={`${title}:${row.label}`} className="contents">
                            <div className="whitespace-nowrap text-[11px] text-dim">{row.label}</div>
                            <div className={cn(
                              "min-w-0 font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]",
                              valueAlign === "right" ? "whitespace-nowrap text-right" : "whitespace-normal text-left",
                            )}>{row.value}</div>
                            <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                return (
                  <div className="flex flex-col gap-4 p-3.5 font-mono text-xs leading-normal">
                    {section(translate("session.infoSection"), sessionRows)}
                    {projectRows.length > 0 && section(translate("session.projectSection"), projectRows)}
                    {section(translate("session.messages"), messageRows.map(([label, value]) => ({ label, value })))}
                    {section(
                      translate("session.tokens"),
                      [...tokenRows, ...extraTokenRows].map(([label, value]) => ({ label, value })),
                      "right",
                    )}
                  </div>
                );
              })() : (
                <div className="p-3.5 text-xs italic text-muted-foreground">
                   {translate("session.load")}
                </div>
              )}
            </div>
          )}
          {activeTopPanel === "debug" && (
            <div className="absolute inset-x-0 top-full z-[240]">
              <DebugPanelBoundary fallback={translate("debug.failed")}>
                <DebugPanel
                  readerRef={debugSnapshotReaderRef}
                  selectedSessionId={selectedSession?.id ?? null}
                  sessions={sessionsWithSelection}
                  onClose={closeDebugPanel}
                />
              </DebugPanelBoundary>
            </div>
          )}

        {isMobile && renderProjectTrustWarning(true)}
        </div>

        {/* Chat content */}
        <div className="relative flex-1 overflow-hidden">
          {showChat ? (
            <>
              {/* All keep-alive slots (including the selected one) live in the
                  same position list so switching only toggles visibility —
                  remounting here would drop the warm instance and reload. */}
              {keepAliveSlots.map((slot) => {
                const isActive = activeSlot?.session.id === slot.session.id;
                return (
                  <div
                    key={slot.session.id}
                    className="chat-slot"
                    data-slot-state={isActive ? "active" : "hidden"}
                    inert={!isActive}
                  >
                    <ChatWindow
                      key={`${slot.session.id}:${slot.epoch}`}
                      session={slot.session}
                      background={!isActive}
                      dormant={dormantSlotIds.has(slot.session.id)}
                      sessionRunning={runningSessionIds.has(slot.session.id)}
                      searchTarget={isActive && searchTarget?.sessionId === slot.session.id ? searchTarget : null}
                      onSearchTargetHandled={handleSearchTargetHandled}
                      initialScrollPosition={isActive ? sessionScrollPositionsRef.current.get(slot.session.id) ?? null : null}
                      onScrollPositionChange={handleSessionScrollPositionChange}
                      newSessionCwd={null}
                      newSessionDraftKey={null}
                      onAgentEnd={handleAgentEnd}
                      onAttentionNeeded={handleAttentionNeeded}
                      onSessionCreated={handleSessionCreated}
                      onSessionForked={handleSessionForked}
                      modelsRefreshKey={modelsRefreshKey}
                      chatInputRef={isActive ? chatInputRef : undefined}
                      onBranchDataChange={isActive ? handleBranchDataChange : undefined}
                      onSystemPromptChange={isActive ? handleSystemPromptChange : undefined}
                      onSystemToolsChange={isActive ? handleSystemToolsChange : undefined}
                      onMcpServersChange={isActive ? handleMcpServersChange : undefined}
                      onSystemInfoLoaderChange={isActive ? handleSystemInfoLoaderChange : undefined}
                      onDebugSnapshotReaderChange={isActive ? handleDebugSnapshotReaderChange : undefined}
                      onSessionStatsChange={isActive ? handleSessionStatsChange : undefined}
                      onSessionStatsPanelOpen={isActive ? openSessionStatsPanel : undefined}
                      onContextUsageChange={isActive ? handleContextUsageChange : undefined}
                      onOpenFile={handleOpenLinkedFile}
                      onFilesUploaded={handleExplorerRefresh}
                      onToolEnd={handleToolEnd}
                      onOpenSubagent={handleOpenSubagentTab}
                    onSideSession={handleSideSession}
                      onAskInNewChat={handleAskInNewChat}
                      quoteSelectionEnabled={quoteSelectionEnabled}
                      initialPrompt={isActive && pendingQuotePrompt?.sessionId === slot.session.id ? pendingQuotePrompt?.text : undefined}
                      onInitialPromptConsumed={() => setPendingQuotePrompt(null)}
                      soundEnabled={soundEnabled}
                      holdAudio={holdAudio}
                      playDoneSound={playDoneSound}
                      unlockAudio={unlockAudio}
                    />
                  </div>
                );
              })}
              {/* Selected session without a slot yet (transient/restore) or
                  the new-session composer. */}
              {!activeSlot && (
                <div className="h-full w-full">
                  <ChatWindow
                    key={sessionKey}
                    session={activeChatSession}
                    searchTarget={searchTarget?.sessionId === activeChatSession?.id ? searchTarget : null}
                    onSearchTargetHandled={handleSearchTargetHandled}
                    initialScrollPosition={activeChatSession ? sessionScrollPositionsRef.current.get(activeChatSession.id) ?? null : null}
                    onScrollPositionChange={handleSessionScrollPositionChange}
                    sessionRunning={Boolean(activeChatSession && runningSessionIds.has(activeChatSession.id))}
                    newSessionCwd={effectiveNewSessionCwd}
                    newSessionDraftKey={newSessionDraftKey}
                    newSessionContextBar={newSessionContextBar}
                    initialNewSessionChoices={activeChatSession === null ? carriedNewSessionChoices : null}
                    onNewSessionChoicesChange={handleNewSessionChoicesChange}
                    onAgentEnd={handleAgentEnd}
                    onAttentionNeeded={handleAttentionNeeded}
                    onSessionCreated={handleSessionCreated}
                    onSessionForked={handleSessionForked}
                    modelsRefreshKey={modelsRefreshKey}
                    chatInputRef={chatInputRef}
                    onBranchDataChange={handleBranchDataChange}
                    onSystemPromptChange={handleSystemPromptChange}
                    onSystemToolsChange={handleSystemToolsChange}
                    onMcpServersChange={handleMcpServersChange}
                    onSystemInfoLoaderChange={handleSystemInfoLoaderChange}
                    onDebugSnapshotReaderChange={handleDebugSnapshotReaderChange}
                    onSessionStatsChange={handleSessionStatsChange}
                    onSessionStatsPanelOpen={openSessionStatsPanel}
                    onOpenSettings={openSettingsSection}
                    onContextUsageChange={handleContextUsageChange}
                    onOpenFile={handleOpenLinkedFile}
                    onFilesUploaded={handleExplorerRefresh}
                    onToolEnd={handleToolEnd}
                    onOpenSubagent={handleOpenSubagentTab}
                    onSideSession={handleSideSession}
                    onAskInNewChat={handleAskInNewChat}
                    quoteSelectionEnabled={quoteSelectionEnabled}
                    initialPrompt={pendingQuotePrompt?.sessionId === activeChatSession?.id ? pendingQuotePrompt?.text : undefined}
                    onInitialPromptConsumed={handleInitialPromptConsumed}
                    soundEnabled={soundEnabled}
                    holdAudio={holdAudio}
                    onSoundToggle={onSoundToggle}
                    playDoneSound={playDoneSound}
                    unlockAudio={unlockAudio}
                  />
                </div>
              )}
              <KeepAliveDock
                slots={keepAliveSlots}
                sessions={sessionCatalog}
                selectedSessionId={selectedSession?.id ?? null}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                onSelect={handleSelectSession}
                onDismiss={handleKeepAliveDismiss}
                onDismissAll={handleKeepAliveDismissAll}
              />
            </>

          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground"
            >
               <div className="text-sm text-foreground">{translate("workspace.opening")}</div>
              <div className="max-w-[min(720px,100%)] [overflow-wrap:anywhere] font-mono text-xs">
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground"
            >
               <div className="text-sm text-destructive">{translate("workspace.unable")}</div>
              <div className="max-w-[min(720px,100%)] [overflow-wrap:anywhere] font-mono text-xs">
                {initialNavigation.requestedCwd}
              </div>
              <div className="max-w-[720px] text-xs">{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div className="flex h-full items-center justify-center text-[15px] text-muted-foreground">
                 {translate("workspace.selectSession")}
              </div>
            ) : (
              <div className="pointer-events-none absolute top-3 left-3 flex select-none items-start gap-2">
                <ArrowLeftIcon className="size-11 shrink-0 text-primary opacity-70" strokeWidth={1.5} />
                <div>
                   <div className="mb-2 text-lg font-semibold text-foreground">{translate("workspace.getStarted")}</div>
                  <div className="text-xs leading-[1.8] text-muted-foreground">
                     <span className="mr-1.5 text-dim">1.</span>{translate("workspace.selectProject")}<br />
                     <span className="mr-1.5 text-dim">2.</span>{translate("workspace.addModels")}
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={`right-panel-overlay-backdrop${rightPanelOpen ? " is-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
      />
      {rightPanelOpen && (
        <div
          {...rightPanelResizer.separatorProps}
          inert={rightPanelFullWidth}
          aria-controls="file-panel"
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        className={cn(
          `right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelFullWidth ? " right-panel-full-width" : ""}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`,
          "flex flex-col border-l border-border bg-background",
        )}
        // 可拖拽宽度经 CSS 变量注入（useResizablePanel 写 --right-panel-width），保留 inline。
        style={{ "--right-panel-width": `${rightPanelResizer.width}px` } as React.CSSProperties}
      >
        {/* Right panel tab bar — the draft's 46px bar with pill tabs. */}
        <div className="flex h-[calc(46px_+_env(safe-area-inset-top))] shrink-0 items-center border-b border-border bg-background pt-[env(safe-area-inset-top)]">
          <div className="min-w-0 flex-1 overflow-hidden">
            <TabBar
              tabs={panelTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRightPanelExpandToggle}
                aria-controls="file-panel"
                aria-pressed={rightPanelFullWidth}
                aria-label={translate(rightPanelFullWidth ? "files.restorePanelWidth" : "files.expandPanel")}
                className={cn(
                  "mr-1 hidden shrink-0 rounded-full text-muted-foreground sm:flex",
                  rightPanelFullWidth && "text-primary",
                )}
              >
                {/* 动态 path（随 rightPanelFullWidth 切换展开/收起箭头）无 lucide 等价四角图形，按例外保留。 */}
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={rightPanelFullWidth
                    ? "M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"
                    : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"} />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate(rightPanelFullWidth ? "files.restorePanelWidth" : "files.expandPanel")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRightPanelOpen(false)}
                aria-controls="file-panel"
                aria-expanded={rightPanelOpen}
                aria-label={translate("files.hidePanel")}
                className="mr-1.5 shrink-0 rounded-full text-muted-foreground"
              >
                <PanelRightIcon data-icon strokeWidth={2} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate("files.hidePanel")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Only the active viewer is mounted. Lightweight per-tab state is restored on activation. */}
        <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
          {activeFileTabId === GIT_TAB_ID ? (
            <GitPanel
              cwd={selectedSession?.cwd ?? newSessionCwd ?? null}
              fullWidth={rightPanelFullWidth}
              onAtMention={handleAtMention}
            />
          ) : activeFileTab?.filePath ? (
            <FileViewer
              key={`${fileWorkspaceGeneration}:${activeFileTab.id}:${activeFileTab.viewerRevision ?? 0}`}
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              gitRefreshKey={explorerRefreshKey}
              initialDisplayMode={activeFileTab.initialDisplayMode}
              initialPage={activeFileTab.page}
              initialState={activeFileTab.viewerState}
              initialLine={fileLineTargetRef.current?.tabId === activeFileTab.id
                ? fileLineTargetRef.current.line
                : undefined}
              watchEnabled={rightPanelOpen}
              onStateChange={(viewerState) => handleFileViewerStateChange(
                fileWorkspaceGeneration,
                activeFileTab.id,
                activeFileTab.viewerRevision ?? 0,
                viewerState,
              )}
              onMentionLines={rightPanelOpen ? handleFileLineMention : undefined}
              onAtMention={handleAtMention}
              onOpenFile={(filePath, options) => handleOpenFile(
                filePath,
                getFileName(filePath),
                {
                  sourceSessionId: activeFileTab.sourceSessionId,
                  page: options?.page,
                  line: options?.line,
                },
              )}
            />
          ) : !terminalTabs.some((tab) => tab.id === activeFileTabId) && !activeAgentTab ? (
            <div className="flex h-full items-center justify-center text-xs text-dim">
               {translate("files.noneOpen")}
            </div>
          ) : null}
          {terminalTabs.map((tab) => (
            <div key={tab.id} hidden={tab.id !== activeFileTabId} className="h-full w-full">
              <TerminalPanel
                tab={tab}
                active={rightPanelOpen && tab.id === activeFileTabId}
                onRestart={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: "restart" } : item))}
                onClosed={() => handleTerminalClosed(tab)}
                onCloseError={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: undefined } : item))}
              />
            </div>
          ))}
          {activeAgentTab && (
            <SessionChatPanel
              key={activeAgentTab.sessionId}
              sessionId={activeAgentTab.sessionId}
              running={runningSessionIds.has(activeAgentTab.sessionId)}
              initialPrompt={sideChatPrompts[activeAgentTab.sessionId]}
              onInitialPromptConsumed={() => setSideChatPrompts((prev) => {
                if (!(activeAgentTab.sessionId in prev)) return prev;
                const next = { ...prev };
                delete next[activeAgentTab.sessionId];
                return next;
              })}
              modelsRefreshKey={modelsRefreshKey}
              quoteSelectionEnabled={quoteSelectionEnabled}
              onOpenFile={handleOpenLinkedFile}
              onOpenSubagent={handleOpenSubagentTab}
              onSessionForked={(newSessionId) => {
                if (isMobile) setRightPanelOpen(false);
                handleSessionForked(newSessionId);
              }}
              onOpenSettings={openSettingsSection}
              onToolEnd={handleToolEnd}
              onFilesUploaded={handleExplorerRefresh}
              soundEnabled={soundEnabled}
              onSoundToggle={onSoundToggle}
              playDoneSound={playDoneSound}
              unlockAudio={unlockAudio}
              holdAudio={holdAudio}
            />
          )}
        </div>
      </div>
    </div>
    </SidebarProvider>
    {settingsSection && (
      <SettingsPanel
        cwd={projectTrustCwd}
        sessionId={selectedSession?.id ?? null}
        initialSection={settingsSection}
        openAtHome={settingsOpenAtHome}
        quoteSelectionEnabled={quoteSelectionEnabled}
        onQuoteSelectionChange={handleQuoteSelectionChange}
        soundEnabled={soundEnabled}
        onSoundToggle={onSoundToggle}
        keepAliveConfig={keepAliveConfig}
        onKeepAliveConfigChange={handleKeepAliveConfigChange}
        onClose={() => {
          setSettingsSection(null);
          setModelsRefreshKey((key) => key + 1);
        }}
        onSessionReloaded={() => { setSessionKey((key) => key + 1); bumpKeepAliveSlot(selectedSession?.id); }}
        projectTrust={projectTrust}
        onOpenTrustDialog={openProjectTrustDialog}
        onProjectTrustChanged={handleProjectTrustChanged}
      />
    )}
    {/* After Settings, so it opens above it (z-index 1100 over 1000) when Settings › MCP asks for it. */}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
        onStatus={setProjectTrust}
      />
    )}
    </>
  );
}
