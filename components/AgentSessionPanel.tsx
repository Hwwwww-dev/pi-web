"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { countRunningSubagents, sideChatTitle } from "@/lib/session-family";
import {
  BotIcon,
  CircleCheckIcon,
  CircleStopIcon,
  CircleXIcon,
  ClockIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  PanelRightIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import type { SessionUsageSummary } from "@/lib/session-stats";
import { formatActiveDuration, formatCompactCount, formatCostShort } from "@/lib/session-stats-format";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DeleteConfirm } from "./SessionTree";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
  /** Subagents with a viewer tab in the open right panel. */
  openSubagentTabIds: ReadonlySet<string>;
  /** Opens a subagent's read-only viewer tab in the right panel (the `Agent` card's button), or closes it when open. */
  onToggleSubagentTab: (sessionId: string, label: string, side?: boolean) => void;
  /** Forks the main agent into a side chat and opens its tab; answers the refusal to show, or null. */
  onNewSideChat: () => Promise<string | null>;
  /** Deletes one side chat and its tab; answers the failure to show, or null. */
  onDeleteSideChat: (sessionId: string) => Promise<string | null>;
}

const STATS_POLL_MS = 3000;

/**
 * Usage of every agent in the family, as the toolbar's stats popover counts
 * it. Read on open and whenever a run starts or ends; polled while one runs,
 * on a visible page, one request at a time.
 */
function useAgentUsage(ids: readonly string[], runningKey: string): Record<string, SessionUsageSummary> {
  const [usage, setUsage] = useState<Record<string, SessionUsageSummary>>({});
  const idsKey = ids.join(",");
  useEffect(() => {
    const requested = idsKey ? idsKey.split(",") : [];
    if (requested.length === 0) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/sessions/stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: requested }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json() as { stats?: Record<string, SessionUsageSummary> };
        if (!controller.signal.aborted && data.stats) setUsage(data.stats);
      } catch {
        /* best-effort: rows keep their last numbers */
      } finally {
        inFlight = false;
      }
    };
    void load();
    if (!runningKey) return () => controller.abort();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, STATS_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [idsKey, runningKey]);
  return usage;
}

function usageTooltip(usage: SessionUsageSummary, t: (key: string) => string, locale: string): string {
  const { tokens } = usage;
  return [
    `${t("session.totalActive")}: ${formatActiveDuration(usage.totalActiveMs)}`,
    `${t("session.input")}: ${tokens.input.toLocaleString(locale)}`,
    `${t("session.output")}: ${tokens.output.toLocaleString(locale)}`,
    ...(tokens.cacheRead > 0 ? [`${t("session.cacheRead")}: ${tokens.cacheRead.toLocaleString(locale)}`] : []),
    ...(tokens.cacheWrite > 0 ? [`${t("session.cacheWrite")}: ${tokens.cacheWrite.toLocaleString(locale)}`] : []),
    `${t("session.total")}: ${tokens.total.toLocaleString(locale)}`,
    ...(usage.cost > 0 ? [`${t("session.cost")}: $${usage.cost.toFixed(4)}`] : []),
    `${t("session.toolCalls")}: ${usage.toolCalls.toLocaleString(locale)}`,
  ].join("\n");
}

function UsageLine({ usage, className }: { usage: SessionUsageSummary; className?: string }) {
  const { locale, t } = useI18n();
  const cost = formatCostShort(usage.cost);
  return (
    <span
      title={usageTooltip(usage, t, locale)}
      className={cn("flex min-w-0 items-center gap-2.5 whitespace-nowrap text-xs text-dim tabular-nums", className)}
    >
      {usage.totalActiveMs > 0 && (
        <span className="flex items-center gap-[3px]">
          <ClockIcon size={13} strokeWidth={1.8} />
          {formatActiveDuration(usage.totalActiveMs)}
        </span>
      )}
      {usage.tokens.total > 0 && (
        <span>{t("agentSwitcher.tokens", { count: formatCompactCount(usage.tokens.total) })}</span>
      )}
      {cost && <span className="text-muted-foreground">{cost}</span>}
    </span>
  );
}

function hasUsage(usage: SessionUsageSummary | undefined): usage is SessionUsageSummary {
  return Boolean(usage && (usage.tokens.total > 0 || usage.totalActiveMs > 0));
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

/** Run status → token classes (was hardcoded #16a34a / #dc2626 / #d97706 hex). */
function statusTextClass(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "text-primary";
  if (status === "completed") return "text-success";
  if (status === "failed") return "text-destructive";
  if (status === "aborted") return "text-warning";
  return "text-dim";
}

export function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "running" || status === "starting") {
    return <LoaderCircleIcon className="size-[13px] animate-spin motion-reduce:animate-none" strokeWidth={1.8} />;
  }
  if (status === "failed") {
    return <CircleXIcon size={13} strokeWidth={1.8} />;
  }
  if (status === "aborted" || status === "interrupted") {
    return <CircleStopIcon size={13} strokeWidth={1.8} />;
  }
  return <CircleCheckIcon size={13} strokeWidth={1.8} />;
}

function AgentRow({
  session,
  main,
  selected,
  running,
  usage,
  onSelect,
  tabShown,
  onToggleTab,
  onNewSideChat,
  newSideChatPending,
  onDelete,
  confirming,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  usage?: SessionUsageSummary;
  onSelect: () => void;
  tabShown?: boolean;
  onToggleTab?: () => void;
  onNewSideChat?: () => void;
  newSideChatPending?: boolean;
  onDelete?: () => void;
  confirming?: boolean;
  onDeleteConfirm?: () => void;
  onDeleteCancel?: () => void;
}) {
  const { locale, t } = useI18n();
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const side = session.relation?.kind === "side";
  const status: SubagentSessionStatus = running ? "running" : relation?.status ?? "completed";
  const primary = main ? t("agentSwitcher.main") : side ? sideChatTitle(session, t("agentSwitcher.sideChat")) : relation?.description || sessionTitle(session);
  const profile = side ? t("agentSwitcher.sideChat") : relation?.profile ?? t("agentSwitcher.subagent");
  const modelId = usage?.model?.modelId;
  const thinkingLevel = usage?.thinkingLevel && usage.thinkingLevel !== "off" ? usage.thinkingLevel : undefined;
  // Every side chat has the same name: when it last ran tells two rows apart.
  const secondary = main ? sessionTitle(session) : side ? formatRelativeTime(session.modified, locale) : profile;
  const secondaryTitle = main ? secondary : [
    profile,
    usage?.model ? `${usage.model.provider}/${usage.model.modelId}` : undefined,
    thinkingLevel,
    formatRelativeTime(session.modified, locale),
  ].filter(Boolean).join(" · ");
  const rowRef = useRef<HTMLDivElement>(null);
  // The row's height when Delete was clicked: a usage line makes it taller
  // than 56px, and the confirmation in its place keeps the list still.
  const [confirmHeight, setConfirmHeight] = useState<number>();

  if (confirming && onDeleteConfirm && onDeleteCancel) {
    return (
      // The sidebar's confirmation, in a row as tall as the one it replaces.
      <div
        className="flex min-h-14 items-center gap-[5px] border-b border-border bg-destructive/[0.06] px-3 py-[7px] shadow-[inset_0_0_0_1px_var(--danger-border)]"
        style={{ height: confirmHeight /* 测量值：Delete 时记录的行高，确认框与被替换行等高，列表不跳动 */ }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onDeleteCancel();
        }}
      >
        <DeleteConfirm
          label={t("sidebar.deleteSession", { title: primary })}
          deleteLabel={t("sidebar.delete")}
          cancelLabel={t("sidebar.cancel")}
          onConfirm={onDeleteConfirm}
          onCancel={onDeleteCancel}
        />
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex border-b border-l-2 border-border",
        selected ? "border-l-primary bg-accent" : "border-l-transparent",
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={cn(
          "grid min-h-14 min-w-0 flex-1 cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-[9px] px-3 py-[7px] text-left text-foreground",
          !selected && "hover:bg-secondary",
        )}
      >
        <span className={cn("grid size-7 place-items-center", main ? "text-muted-foreground" : "text-primary")}>
          {main ? (
            <UserIcon size={17} strokeWidth={1.8} />
          ) : side ? (
            <MessagesSquareIcon size={17} strokeWidth={1.8} />
          ) : (
            <BotIcon size={17} strokeWidth={1.8} />
          )}
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-xs", selected ? "font-semibold" : "font-medium")} title={primary}>
            {primary}
          </span>
          <span className="mt-0.5 flex min-w-0 items-baseline gap-1 whitespace-nowrap text-xs text-dim" title={secondaryTitle}>
            <span className={cn("truncate", modelId && !main && "max-w-[40%] shrink-0")}>{secondary}</span>
            {!main && modelId && <>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate">{modelId}</span>
            </>}
            {!main && thinkingLevel && <span className="shrink-0">· {thinkingLevel}</span>}
          </span>
          {hasUsage(usage) && <UsageLine usage={usage} className="mt-[3px]" />}
        </span>
        <span className={cn("flex items-center gap-1.5 whitespace-nowrap text-xs", (main || side) && !running ? "text-dim" : statusTextClass(status))}>
          {(main || side) && !running ? (
            selected ? t("agentSwitcher.current") : null
          ) : (
            <>
              <StatusIcon status={status} />
              <span>{t(`agentSwitcher.status.${status}`)}</span>
            </>
          )}
        </span>
      </button>
      {onNewSideChat && (
        <RowSideButton title={t("sideChat.new")} disabled={newSideChatPending} onClick={onNewSideChat}>
          <MessageSquarePlusIcon size={17} strokeWidth={1.8} />
        </RowSideButton>
      )}
      {onToggleTab && (
        // Greyed, not gone: the row open in the main chat has no tab (one session, one chat),
        // and the rows keep their layout.
        <RowSideButton
          title={selected ? t("agentSwitcher.openInMainChat") : t(tabShown ? (side ? "sideChat.closeTab" : "subagent.closeTab") : side ? "sideChat.openTab" : "subagent.openTab")}
          pressed={tabShown}
          disabled={selected}
          onClick={onToggleTab}
        >
          {/* Filled right pane while the panel shows this row (side-sessions.md). */}
          <PanelRightIcon size={14} strokeWidth={1.8} aria-hidden="true">
            {tabShown ? <rect x="15" y="4" width="5.5" height="16" rx="1.5" fill="currentColor" stroke="none" /> : null}
          </PanelRightIcon>
        </RowSideButton>
      )}
      {onDelete && (
        <RowSideButton
          title={t("sidebar.delete")}
          danger
          onClick={() => {
            setConfirmHeight(rowRef.current?.offsetHeight);
            onDelete();
          }}
        >
          <Trash2Icon size={14} />
        </RowSideButton>
      )}
    </div>
  );
}

function RowSideButton({ title, pressed, danger, disabled, onClick, children }: {
  title: string;
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const state = disabled
    ? "cursor-not-allowed text-dim opacity-40"
    : danger
      ? "cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
      : pressed
        ? "cursor-pointer text-primary hover:bg-secondary"
        : "cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn("grid w-9 shrink-0 place-items-center border-l border-border bg-transparent", state)}
    >
      {children}
    </button>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession, openSubagentTabIds, onToggleSubagentTab, onNewSideChat, onDeleteSideChat }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [newSideChatPending, setNewSideChatPending] = useState(false);
  const [newSideChatError, setNewSideChatError] = useState<string | null>(null);
  const [confirmDeleteSideChatId, setConfirmDeleteSideChatId] = useState<string | null>(null);
  const [deleteSideChatError, setDeleteSideChatError] = useState<string | null>(null);
  const handleNewSideChat = async () => {
    setNewSideChatPending(true);
    setNewSideChatError(null);
    try {
      setNewSideChatError(await onNewSideChat());
    } catch (error) {
      setNewSideChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setNewSideChatPending(false);
    }
  };
  // As the sidebar's: the confirmation goes at once, a failure shows above the rows.
  const handleDeleteSideChat = async (sessionId: string) => {
    setConfirmDeleteSideChatId(null);
    setDeleteSideChatError(null);
    let error: string | null;
    try {
      error = await onDeleteSideChat(sessionId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    if (error) setDeleteSideChatError(t("sidebar.deleteFailed", { error }));
  };
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        const sideLabel = session.relation?.kind === "side" ? t("agentSwitcher.sideChat") : null;
        return [relation?.description, relation?.profile, sideLabel, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  const runningCount = countRunningSubagents(subagents, runningSessionIds);
  const familyIds = useMemo(() => [rootSession.id, ...subagents.map((session) => session.id)], [rootSession.id, subagents]);
  const runningKey = familyIds.filter((id) => runningSessionIds.has(id)).join(",");
  const usage = useAgentUsage(familyIds, runningKey);
  const familyUsage = useMemo(() => {
    const listed = familyIds.map((id) => usage[id]).filter(hasUsage);
    if (listed.length === 0) return null;
    const total: SessionUsageSummary = {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      toolCalls: 0,
      totalActiveMs: 0,
    };
    for (const item of listed) {
      total.tokens.input += item.tokens.input;
      total.tokens.output += item.tokens.output;
      total.tokens.cacheRead += item.tokens.cacheRead;
      total.tokens.cacheWrite += item.tokens.cacheWrite;
      total.tokens.total += item.tokens.total;
      total.cost += item.cost;
      total.toolCalls += item.toolCalls;
      total.totalActiveMs += item.totalActiveMs;
    }
    return total;
  }, [familyIds, usage]);

  return (
    <div
      role="listbox"
      aria-label={t("agentSwitcher.title")}
      className="overflow-hidden rounded-b-sm border-x border-b border-border bg-card shadow-md"
    >
      <div>
        <div className="flex min-h-11 items-center gap-2 border-b border-border px-3 py-[7px]">
          <strong className="text-xs font-semibold">{t("agentSwitcher.title")}</strong>
          {subagents.length > 0 && (
            <span className="text-xs text-dim">
              {subagents.length === 1
                ? t("agentSwitcher.countOne", { count: subagents.length })
                : t("agentSwitcher.count", { count: subagents.length })}
            </span>
          )}
          <span className="ms-auto flex min-w-0 items-center gap-2.5">
            {familyUsage && (
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <span className="whitespace-nowrap text-xs text-dim" title={t("agentSwitcher.totalUsageHint")}>{t("agentSwitcher.totalUsage")}</span>
                <UsageLine usage={familyUsage} />
              </span>
            )}
            {runningCount > 0 && (
              <span className="whitespace-nowrap text-xs text-primary">
                {t("agentSwitcher.runningCount", { count: runningCount })}
              </span>
            )}
          </span>
        </div>
        {subagents.length > 8 && (
          <div className="border-b border-border p-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agentSwitcher.search")}
              aria-label={t("agentSwitcher.search")}
              className="h-8 w-full rounded-sm border border-border bg-background px-2.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        )}
        <div className="max-h-[min(58dvh,480px)] overflow-y-auto">
          <AgentRow
            session={rootSession}
            main
            selected={rootSession.id === selectedSessionId}
            running={runningSessionIds.has(rootSession.id)}
            usage={usage[rootSession.id]}
            onSelect={() => onSelectSession(rootSession)}
            onNewSideChat={handleNewSideChat}
            newSideChatPending={newSideChatPending}
          />
          {(newSideChatError || deleteSideChatError) && (
            <div role="alert" className="border-b border-border px-3 py-1.5 text-xs text-destructive [overflow-wrap:anywhere]">
              {newSideChatError ?? deleteSideChatError}
            </div>
          )}
          {visibleSubagents.map((session) => (
            <AgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={runningSessionIds.has(session.id)}
              usage={usage[session.id]}
              onSelect={() => onSelectSession(session)}
              tabShown={openSubagentTabIds.has(session.id)}
              onToggleTab={() => {
                const relation = session.relation?.kind === "subagent" ? session.relation : null;
                if (session.relation?.kind === "side") {
                  onToggleSubagentTab(session.id, t("sideChat.title"), true);
                  return;
                }
                onToggleSubagentTab(session.id, relation?.description || relation?.profile || sessionTitle(session));
              }}
              onDelete={session.relation?.kind === "side" ? () => setConfirmDeleteSideChatId(session.id) : undefined}
              confirming={confirmDeleteSideChatId === session.id}
              onDeleteConfirm={() => { void handleDeleteSideChat(session.id); }}
              onDeleteCancel={() => setConfirmDeleteSideChatId(null)}
            />
          ))}
          {subagents.length > 0 && visibleSubagents.length === 0 && (
            <div className="px-3 py-[22px] text-center text-xs text-dim">
              {t("agentSwitcher.noMatches")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
