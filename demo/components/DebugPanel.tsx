"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { DebugClientSession, DebugEventConnectionSnapshot, DebugSessionDetail, DebugSessionSummary, DebugSnapshotResponse } from "@/lib/debug-types";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { StatusIcon } from "./AgentSessionPanel";
import { MCP_SESSION_STATE_KEYS } from "./mcp-config-helpers";
import { sessionRowTitle } from "./SessionTree";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Field, FieldDescription, FieldGroup, FieldTitle } from "./ui/field";
import { Item, ItemActions, ItemContent, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";
import { Progress } from "./ui/progress";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";
import { cn } from "@/lib/utils";
import {
  CircleDashedIcon,
  CircleIcon,
  CircleOffIcon,
  CircleXIcon,
  FolderIcon,
  LoaderCircleIcon,
  ServerIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  DEBUG_CLOSE_REASON_KEYS,
  DEBUG_LEASE_OUTCOME_KEYS,
  DEBUG_POLL_MS,
  DEBUG_REATTACH_REASON_KEYS,
  DEBUG_RUN_STATUS_KEYS,
  DEBUG_SOURCE_KIND_KEYS,
  DEBUG_SAMPLE_COUNT,
  DEBUG_STATUS_KEYS,
  DEBUG_STREAM_ERROR_KEYS,
  DEBUG_STREAM_STATE_KEYS,
  DEBUG_TICK_MS,
  EMPTY_DEBUG_SAMPLES,
  EMPTY_DEBUG_SERVER_READING,
  barFraction,
  createDebugPanelEscapeListener,
  createDebugPoller,
  debugHolderLabel,
  debugHolderTone,
  debugIssues,
  debugPollSample,
  debugPoolKindCounts,
  debugServerClock,
  debugSessionTitle,
  debugSlotTitle,
  debugStatusState,
  debugTargetSessionId,
  debugVerdict,
  formatAgo,
  formatBytes,
  formatCountdown,
  formatDebugDuration,
  formatDebugSeconds,
  formatSecondsCountdown,
  freshnessTone,
  groupDebugSessions,
  holderGroupLabel,
  joinParts as join,
  mcpServerTone,
  nextLeaseRenewalAt,
  pageAgentStreamCount,
  poolSlots,
  pushDebugSample,
  readClientSession,
  readDebugPage,
  runningPollSample,
  shortDebugId,
  sparkHeight,
  sparkStats,
  streamFreshness,
  thisPageFirst,
  translateDebugCode,
  type DebugIssue,
  type DebugPageReading,
  type DebugPool,
  type DebugPoolSlot,
  type DebugPoller,
  type DebugSample,
  type DebugSamples,
  type DebugServerClock,
  type DebugServerReading,
  type DebugSessionGroup,
  type DebugSessionRow,
  type DebugStatusState,
  type DebugTitleOf,
  type DebugTone,
  type DebugVerdict,
  type Translate,
} from "./debug-panel-state";

/**
 * The top bar's Debug panel: how this page talks to the server (its event stream, its lease, the
 * other streams it holds) and what the server holds for the selected session and overall. It only
 * reads: the chat's snapshot through a reader that reads refs, page-level bookkeeping
 * (lib/page-debug.ts), and `GET /api/agent/debug` every 2 s, which starts, renews and reconnects
 * nothing. Its clocks live here, not in AppShell, so a tick renders the panel alone. The sidebar
 * shows nothing: the panel lists the server's sessions itself.
 */

interface Props {
  /** The chat's snapshot reader, registered by ChatWindow; read in the tick, never in render. */
  readerRef: RefObject<(() => DebugClientSession) | null>;
  selectedSessionId: string | null;
  /** AppShell's session catalog: names and projects for the sessions the server lists. */
  sessions: readonly SessionInfo[];
  /** Escape; `restoreFocus`: focus was inside the panel, so it goes back to the Debug button. */
  onClose(restoreFocus: boolean): void;
}

/** Keeps a render error in the panel from taking the page down with it. */
export class DebugPanelBoundary extends Component<{ fallback: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Debug panel failed:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="status" className="px-4 py-2 text-sm text-muted-foreground">
        {this.props.fallback}
      </div>
    );
  }
}

export function DebugPanel({ readerRef, selectedSessionId, sessions, onClose }: Props) {
  const { t } = useI18n();
  const selectedRef = useRef(selectedSessionId);
  selectedRef.current = selectedSessionId;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pollerRef = useRef<DebugPoller | null>(null);
  const disposedRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  // The running poll's last record seen, so each poll is one sample.
  const lastRunningAtRef = useRef<number | null>(null);
  const [page, setPage] = useState<DebugPageReading | null>(null);
  const [server, setServer] = useState<DebugServerReading>(EMPTY_DEBUG_SERVER_READING);
  const [samples, setSamples] = useState<DebugSamples>(EMPTY_DEBUG_SAMPLES);
  const [copied, setCopied] = useState(false);
  // What the view shows while the mouse rests on something with a tooltip: each tick would rewrite
  // the title under it, and the browser hides and shows again a tooltip whose text changed, so it
  // flickered every second. Readings go on underneath; the view catches up as the mouse moves off.
  const [held, setHeld] = useState<HeldView | null>(null);
  const liveRef = useRef<HeldView>({ page, server, samples });
  liveRef.current = { page, server, samples };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let heldOn: Element | null = null;
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const titled = event.target instanceof Element ? event.target.closest("[title]") : null;
      const target = titled && section.contains(titled) ? titled : null;
      if (target === heldOn) return;
      heldOn = target;
      // Another tooltip: the view as it is now, held from here.
      setHeld(target ? liveRef.current : null);
    };
    const onPointerLeave = () => {
      heldOn = null;
      setHeld(null);
    };
    section.addEventListener("pointerover", onPointerOver);
    section.addEventListener("pointerleave", onPointerLeave);
    return () => {
      section.removeEventListener("pointerover", onPointerOver);
      section.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    const poller = createDebugPoller({
      fetch: (url, init) => fetch(url, init),
      sessionId: () => debugTargetSessionId(readClientSession(readerRef.current).client, selectedRef.current),
      isVisible: () => document.visibilityState === "visible",
      onReading: (reading) => {
        setServer(reading);
        const sample = debugPollSample(reading);
        if (sample) setSamples((current) => ({ ...current, poll: pushDebugSample(current.poll, sample) }));
      },
    });
    pollerRef.current = poller;
    const read = () => {
      const reading = readDebugPage(readerRef.current, poller.inFlightSince());
      setPage(reading);
      const last = reading.runningPoll?.last ?? null;
      if (last && last.at !== lastRunningAtRef.current) {
        lastRunningAtRef.current = last.at;
        const sample = runningPollSample(last);
        if (sample) setSamples((current) => ({ ...current, running: pushDebugSample(current.running, sample) }));
      }
    };
    read();
    poller.poll();
    const tick = window.setInterval(() => {
      // A hidden page shows nothing: no render each second for it, as the poll pauses too.
      if (document.visibilityState !== "visible") return;
      read();
      // A session picked in the sidebar: ask about it now, not at the next poll.
      poller.sync();
    }, DEBUG_TICK_MS);
    const pollTimer = window.setInterval(() => poller.poll(), DEBUG_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      read();
      poller.poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      // Disposed first: an answer still on its way never reaches the state.
      disposedRef.current = true;
      poller.dispose();
      pollerRef.current = null;
      window.clearInterval(tick);
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [readerRef]);

  useEffect(() => {
    pollerRef.current?.sync();
  }, [selectedSessionId]);

  // Escape closes the panel. On `document`, so it runs after whatever is nearer (a menu, ChatInput
  // stopping a run, React's own handlers, which run from `document` first) and before the window's
  // Stop shortcut, which a handled Escape skips.
  useEffect(() => {
    const handleKeyDown = createDebugPanelEscapeListener(
      document,
      () => sectionRef.current,
      (restoreFocus) => onCloseRef.current(restoreFocus),
    );
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCopy = () => {
    const payload = { client: page, server: server.reply };
    void copyText(JSON.stringify(payload, null, 2)).then((copied) => {
      if (!copied) return;
      if (disposedRef.current) return;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    });
  };

  const shown = held ?? { page, server, samples };
  // No shell of its own: the AppShell popover (the same top drawer the
  // system/tools panels use) owns open/close and the frame. The old right
  // sheet inside that popover presented a second, competing drawer.
  return (
    <DebugPanelView
      page={shown.page}
      server={shown.server}
      samples={shown.samples}
      selectedSessionId={selectedSessionId}
      sessions={sessions}
      copied={copied}
      onCopy={handleCopy}
      t={t}
      sectionRef={sectionRef}
    />
  );
}

interface HeldView {
  page: DebugPageReading | null;
  server: DebugServerReading;
  samples: DebugSamples;
}

interface ViewProps {
  page: DebugPageReading | null;
  server: DebugServerReading;
  /** Round trips of the panel's poll and the sidebar's running poll, newest last. */
  samples?: DebugSamples;
  selectedSessionId: string | null;
  sessions: readonly SessionInfo[];
  copied: boolean;
  onCopy(): void;
  t: Translate;
  /** The panel's element, for the Escape that closes it to tell whether focus was inside. */
  sectionRef?: Ref<HTMLElement>;
}

/** What every part of the view reads. */
interface Ctx {
  t: Translate;
  /** The browser's clock when the page was read: the page's own times count from it. */
  now: number;
  /** Server times, on the server's clock; null before an answer. */
  clock: DebugServerClock | null;
  /** This page's id: its streams are the filled ones. */
  myHolder: string | null;
  titleOf: DebugTitleOf;
}

/** The panel itself, from what DebugPanel read; pure, so tests render it from fixtures. */
export function DebugPanelView({ page, server, samples = EMPTY_DEBUG_SAMPLES, selectedSessionId, sessions, copied, onCopy, t, sectionRef }: ViewProps) {
  const now = page?.at ?? server.receivedAt ?? 0;
  const client = page?.client ?? null;
  const targetSessionId = debugTargetSessionId(client, selectedSessionId);
  const reply = server.reply;
  const clock = reply && server.receivedAt !== null ? debugServerClock(reply.now, server.receivedAt, now) : null;
  // An answer about the session the panel shows: the poll drops the others, but one may still be
  // on screen for a second after the chat moved on.
  const detail = reply?.session && reply.session.sessionId === targetSessionId ? reply.session : null;
  const myHolder = client?.pageId ?? null;
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const titleOf = useMemo<DebugTitleOf>(() => (id) => {
    const info = byId.get(id);
    return info ? sessionRowTitle(info) : null;
  }, [byId]);
  const groups = useMemo(() => (reply ? groupDebugSessions(reply.sessions, byId, targetSessionId) : null), [reply, byId, targetSessionId]);
  const issues = page ? debugIssues({ page, server, detail, t, titleOf }) : [];
  const verdict = debugVerdict(page, server, issues);
  const ctx: Ctx = { t, now, clock, myHolder, titleOf };

  return (
    // One container for the whole panel (the drawer's own frame): the three sections sit directly
    // in it, each a heading plus official components, never a card inside a card.
    <section
      ref={sectionRef}
      className="debug-panel flex h-[min(600px,50dvh)] min-h-0 flex-col bg-card text-foreground"
      aria-label={t("debug.panelLabel")}
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 px-4 py-2">
        <span className="debug-panel-heading shrink-0 cursor-help text-sm font-semibold text-foreground" title={t("debug.readOnly")}>{t("debug.title")}</span>
        {/* Plain text, no live region: a screen reader would read out every change. */}
        <VerdictView verdict={verdict} t={t} />
        <Button type="button" variant="outline" size="xs" className="debug-panel-copy ml-auto shrink-0" onClick={onCopy} title={t("debug.copyTitle")}>
          {copied ? t("debug.copied") : t("debug.copyJson")}
        </Button>
      </div>
      {page !== null && (
        // The panel's own width, not the window's, decides the columns: three when wide, the
        // sessions under the server's when narrower, one above the other on a phone.
        <div className="@container flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pb-3">
          {issues.length > 0 && <IssueList issues={issues} />}
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
            <PageColumn page={page} samples={samples} ctx={ctx} className="@2xl:row-span-2 @5xl:row-span-1" />
            <ServerColumn reply={reply} ctx={ctx} />
            <SessionColumn reply={reply} detail={detail} groups={groups} targetSessionId={targetSessionId} sources={page.sources} ctx={ctx} />
          </div>
        </div>
      )}
    </section>
  );
}

// ── Primitives ──

type GlyphKind = "server" | "warning" | "error";

const GLYPH_ICONS = { server: ServerIcon, warning: TriangleAlertIcon, error: CircleXIcon } as const;

/** One lucide glyph in `currentColor`; decorative, the text beside it says what it is. */
function Glyph({ kind }: { kind: GlyphKind }) {
  const Icon = GLYPH_ICONS[kind];
  return <Icon className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />;
}

interface BadgeItem {
  tone: DebugTone;
  /** This page's own stream: kept as the run's first, its tone says whose it is. */
  filled?: boolean;
  /** A stream still starting, a detached shell: a dashed outline. */
  dashed?: boolean;
  /** Lapsed, inactive or exited: drawn faint. */
  faded?: boolean;
  title: string;
  /** The badge's own word when it is not the run's: a liveness provider's name. */
  text?: string;
}

// The panel's tones as shadcn semantic tokens: Badge, Dot, Progress and the value texts read one map.
const TONE_TEXT: Record<DebugTone, string> = {
  ok: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  accent: "text-primary",
  muted: "text-muted-foreground",
  dim: "text-muted-foreground",
};

/**
 * A badge's tone classes. Every state is the official outline Badge (no filled box, no own pill):
 * the tone only tints its border and text, dashed says still starting, faint says gone.
 */
function toneClasses(item: Pick<BadgeItem, "tone" | "dashed" | "faded">, extra?: string): string {
  return cn(
    "font-normal",
    TONE_TEXT[item.tone],
    item.dashed && "border-dashed",
    item.faded && "opacity-55",
    extra,
  );
}

/** A boxed word's Badge: outlined in its tone, this page's own included. */
function BadgeWord({ item, children }: { item: BadgeItem; children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={toneClasses(item, item.text !== undefined ? "block max-w-24 truncate" : undefined)}
      title={item.title}
    >
      {item.text ?? children}
    </Badge>
  );
}

/**
 * One boxed word per item ("SSE", a provider's name), each with its own tooltip, up to
 * `cap`, then "+n". The run is an image named `label`; `plain` drops the role when an enclosing
 * group already names it. No items, nothing.
 */
function BadgeRun({ text, items, cap, label, plain = false }: {
  text: string;
  items: readonly BadgeItem[];
  cap: number;
  label: string;
  plain?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1 align-middle" title={label} {...(plain ? {} : { role: "img", "aria-label": label })}>
      {items.slice(0, cap).map((item, index) => (
        <BadgeWord key={index} item={item}>{text}</BadgeWord>
      ))}
      {items.length > cap && <span className="text-xs tabular-nums text-muted-foreground">{`+${items.length - cap}`}</span>}
    </span>
  );
}

// Small marks for a page's browser and system, 24-grid strokes in currentColor like Glyph, drawn
// to be told apart at 12px; the title says the words. The systems are filled shapes (Simple
// Icons, CC0), which read at that size where outlines blur. Brand marks, not UI icons: lucide has
// no Safari/Firefox/Edge equivalents, and its all-outline set is exactly what was replaced here,
// so these stay hand-drawn (docs/agents/sessions.md, Debug panel).
const CLIENT_GLYPHS: Record<string, ReactNode> = {
  Chrome: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="M21.17 8H12M3.95 6.06 8.54 14M10.88 21.94 15.46 14" />
    </>
  ),
  Safari: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z" />
    </>
  ),
  Firefox: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 17a3.5 3.5 0 0 0 3.5-3.5c0-2.5-2-3.5-2.5-6-1.5 1.5-1 3-2 3.5-.5-.5-1-1-1-2-1.5 1-1.5 2.5-1.5 4.5A3.5 3.5 0 0 0 12 17z" />
    </>
  ),
  Edge: (
    <>
      <path d="M21 12a9 9 0 1 0-4.5 7.8" />
      <path d="M7 13.5c0-3 2.5-5 5.5-5 2.5 0 4.5 1.5 4.5 3.5 0 1.3-1 2-2.5 2H10" />
    </>
  ),
  Opera: (
    <>
      <circle cx="12" cy="12" r="10" />
      <ellipse cx="12" cy="12" rx="4" ry="7" />
    </>
  ),
  macOS: <AppleMark />,
  iOS: <AppleMark />,
  Windows: <path fill="currentColor" stroke="none" d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z" />,
  Android: <path d="M4.5 18a7.5 7.5 0 0 1 15 0zM8 12 6.5 9.5M16 12l1.5-2.5M9.5 15h.01M14.5 15h.01" />,
  Linux: <path d="m4 17 6-5-6-5M12 19h8" />,
  ChromeOS: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </>
  ),
};

function AppleMark() {
  return (
    <path
      fill="currentColor"
      stroke="none"
      d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
    />
  );
}

/** The browser's and the system's marks, in that order; nothing for a label it does not know. */
function ClientIcons({ client }: { client: string | null | undefined }) {
  const parts = client ? client.split(" · ").filter((part) => part in CLIENT_GLYPHS) : [];
  if (parts.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {parts.map((part) => (
        <svg
          key={part}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {CLIENT_GLYPHS[part]}
        </svg>
      ))}
    </span>
  );
}

/** A status mark in its tone: a lucide circle, filled when solid, hollow when ringed. */
function Dot({ tone, ring = false }: { tone: DebugTone; ring?: boolean }) {
  return (
    <CircleIcon
      className={cn("size-2.5 shrink-0", TONE_TEXT[tone])}
      fill={ring ? "none" : "currentColor"}
      aria-hidden="true"
    />
  );
}

/** A state word in its tone's outline Badge: every state is the official outline, never a fill. */
function Chip({ tone, children, title }: { tone: DebugTone; children: ReactNode; title?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", TONE_TEXT[tone])} title={title}>
      {children}
    </Badge>
  );
}

/** The Progress fill's own color per tone: the official bar, tinted by the theme's token. */
const PROGRESS_TONE: Record<DebugTone, string> = {
  ok: "[&>[data-slot=progress-indicator]]:bg-success",
  warning: "[&>[data-slot=progress-indicator]]:bg-warning",
  error: "[&>[data-slot=progress-indicator]]:bg-destructive",
  accent: "[&>[data-slot=progress-indicator]]:bg-primary",
  muted: "[&>[data-slot=progress-indicator]]:bg-muted-foreground",
  dim: "[&>[data-slot=progress-indicator]]:bg-muted-foreground",
};

/**
 * A value against its scale: the official Progress, its width from the tailwind scale. Hidden
 * from screen readers, whose text is the label and value beside it.
 */
function Bar({ fraction, tone, width = "w-24", title, className }: {
  fraction: number;
  tone: DebugTone;
  width?: "w-24" | "w-20" | "w-8";
  title?: string;
  className?: string;
}) {
  const value = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <Progress
      value={value}
      aria-hidden="true"
      title={title}
      className={cn("h-1.5 shrink-0", width, PROGRESS_TONE[tone], className)}
    />
  );
}

/**
 * Round trips, newest on the right; the 5 s timeout is full height, a failure is a full bar. The
 * bars stand on a full-width baseline one pixel below them, so a few short answers read as a
 * chart, not as a dashed line.
 */
function Sparkline({ samples, label }: { samples: readonly DebugSample[]; label: string }) {
  const shown = samples.slice(-DEBUG_SAMPLE_COUNT);
  return (
    // A data chart (one rect per round trip on a baseline), not an icon: stays an svg.
    <span className="inline-flex w-30 shrink-0" role="img" aria-label={label} title={label}>
      <svg width="120" height="15" viewBox="0 0 120 15" aria-hidden="true">
        <rect x="0" y="14" width="120" height="1" className="fill-border" />
        {shown.map((sample, index) => {
          const height = sample.failed ? 14 : Math.max(1, Math.round(sparkHeight(sample.ms) * 14));
          return (
            <rect
              key={index}
              className={TONE_TEXT[sample.tone]}
              x={120 - (shown.length - index) * 4 + 1}
              y={14 - height}
              width="3"
              height={height}
              fill="currentColor"
            />
          );
        })}
      </svg>
    </span>
  );
}

/** The sidebar's status slot: spinner, awaiting dot, or the state's mark; the state is its name. */
function StatusSlot({ state, label }: { state: DebugStatusState; label: string }) {
  const slot = "inline-flex size-4 shrink-0 items-center justify-center";
  if (state === "awaiting") {
    return (
      <span className={slot}>
        <span className="session-tree-awaiting" role="img" aria-label={label} title={label} />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className={cn(slot, "text-primary")} title={label}>
        {/* sidebar-spin (the retired app/sidebar-menu.css, folded here). */}
        <LoaderCircleIcon size={12} strokeWidth={2.8} className="sidebar-spin shrink-0 animate-spin [animation-duration:0.9s] motion-reduce:animate-none" role="img" aria-label={label} aria-hidden={false} />
      </span>
    );
  }
  const Icon = state === "alive" ? CircleIcon : state === "none" ? CircleOffIcon : CircleDashedIcon;
  return (
    <span
      className={cn(slot, state === "closing" ? "text-warning" : "text-muted-foreground")}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

// ── A. Header and B. Issues ──

/** A column's bare state ("waiting", "no chat"): the Empty composition, kept dense for the panel. */
function DebugEmpty({ children }: { children: ReactNode }) {
  return (
    <Empty className="flex-none items-start gap-0 border-0 p-0 text-left md:p-0">
      <EmptyHeader className="items-start text-left">
        <EmptyTitle className="text-xs font-normal text-muted-foreground">{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function VerdictView({ verdict, t }: { verdict: DebugVerdict; t: Translate }) {
  const text = {
    reading: () => t("debug.reading"),
    hidden: () => t("debug.poll.hidden"),
    issues: () => t("debug.health.issues", { count: verdict.count }),
    waiting: () => t("debug.poll.waiting"),
    ok: () => t("debug.health.ok"),
  }[verdict.kind]();
  // The verdict is a state too: the official outline Badge, its tone tinting border and text.
  const tone = verdict.kind === "ok"
    ? TONE_TEXT.muted
    : verdict.kind === "issues"
      ? TONE_TEXT[verdict.tone === "error" ? "error" : "warning"]
      : TONE_TEXT.dim;
  return (
    <Badge variant="outline" className={cn("debug-panel-status min-w-0 gap-1 font-normal tabular-nums", tone)} title={text}>
      {verdict.kind === "issues" && <Glyph kind={verdict.tone === "error" ? "error" : "warning"} />}
      {verdict.kind === "ok" && <Dot tone="ok" />}
      {(verdict.kind === "hidden" || verdict.kind === "waiting") && <Dot tone="dim" ring />}
      <span className="debug-panel-status-text min-w-0 truncate">{text}</span>
    </Badge>
  );
}

/** One callout per fault (shadcn Alert): its tone's mark, then the sentence, which names what it is about. */
function IssueList({ issues }: { issues: readonly DebugIssue[] }) {
  return (
    <div className="flex flex-col gap-1">
      {issues.map((issue, index) => (
        <Alert
          key={`${issue.id}:${index}`}
          variant={issue.tone === "error" ? "destructive" : "warning"}
          className="gap-x-1.5 px-2.5 py-1.5"
          // role={undefined}: Alert's implicit live region would read the panel's 2 s re-renders out.
          role={undefined}
        >
          <Glyph kind={issue.tone === "error" ? "error" : "warning"} />
          <AlertDescription className="text-xs text-current [overflow-wrap:anywhere]">{issue.text}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

// ── C1. This page ──

function sparkLabel(samples: readonly DebugSample[], t: Translate): string {
  const stats = sparkStats(samples);
  if (stats.count === 0) return t("debug.notYet");
  return t("debug.spark.title", { count: stats.count, median: formatDebugDuration(stats.median, t), max: formatDebugDuration(stats.max, t) });
}

function SampleValue({ samples, t }: { samples: readonly DebugSample[]; t: Translate }) {
  const last = samples[samples.length - 1];
  if (!last) return <span className="text-xs tabular-nums text-muted-foreground">—</span>;
  return <span className={cn("text-xs tabular-nums", TONE_TEXT[last.tone])}>{last.failed ? "—" : formatDebugDuration(last.ms, t)}</span>;
}

/**
 * One measure of the page's field group: its name, then a value line and the details below it.
 * Field/FieldGroup/FieldTitle are the official key-value row; nothing here draws its own box.
 */
function Measure({ label, title, value, detail }: {
  label: ReactNode;
  title?: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Field orientation="horizontal" className="gap-3">
      <FieldTitle className="min-w-24 shrink-0 justify-start text-xs font-normal text-muted-foreground" title={title}>{label}</FieldTitle>
      <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{value}</div>
        {detail !== undefined && (
          <FieldDescription className="text-xs font-normal tabular-nums [overflow-wrap:anywhere]">{detail}</FieldDescription>
        )}
      </div>
    </Field>
  );
}

/**
 * The page's connections and timings in one column: the meter above its count, then one field per
 * measure (name, scale and value) for the two polls, the chat's stream and its lease.
 */
function PageColumn({ page, samples, ctx, className }: {
  page: DebugPageReading;
  samples: DebugSamples;
  ctx: Ctx;
  className?: string;
}) {
  const { t } = ctx;
  const pool = poolSlots(page.sources, page.protocol, page.client?.connection?.sessionId ?? null);
  const running = page.runningPoll;
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)} aria-labelledby="debug-section-page">
      <h3 id="debug-section-page" data-debug-section="page" className="text-sm leading-none font-semibold text-foreground">
        {t("debug.section.page")}
      </h3>
      <Meter pool={pool} ctx={ctx} />
      <FieldGroup className="gap-2">
        <Measure
          label={t("debug.page.debugPoll")}
          value={<><Sparkline samples={samples.poll} label={sparkLabel(samples.poll, t)} /><SampleValue samples={samples.poll} t={t} /></>}
        />
        <Measure
          label={t("debug.page.runningPoll")}
          value={(
            <>
              <Sparkline
                samples={samples.running}
                label={join([running && t("debug.page.pollCounts", { count: running.count, failures: running.failures }), sparkLabel(samples.running, t)])}
              />
              <SampleValue samples={samples.running} t={t} />
            </>
          )}
        />
        <StreamRows page={page} ctx={ctx} />
        <LeaseRows page={page} ctx={ctx} />
      </FieldGroup>
    </section>
  );
}

/**
 * This page's share of the browser's connections: the official Progress against the protocol's
 * cap, then one outline Badge per source it holds (the chat's own first, amber while connecting).
 */
function Meter({ pool, ctx }: { pool: DebugPool; ctx: Ctx }) {
  const { t, now, titleOf } = ctx;
  // The slots' own titles are not read inside an image: its name says what they count.
  const kindCounts = debugPoolKindCounts(pool, t);
  const label = pool.cap !== null
    ? join([`${t("debug.page.http1", { protocol: pool.protocol ?? "" })} · ${pool.mine}/${pool.cap}`, ...kindCounts])
    : join([t("debug.section.page"), ...kindCounts, pool.protocol ?? t("debug.unknown")]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {pool.cap !== null && (
        <div className="flex min-w-0 items-center gap-2">
          <Progress value={Math.round((pool.mine / pool.cap) * 100)} aria-hidden="true" className="h-1.5 w-24" />
          <span className="text-xs tabular-nums text-muted-foreground">{`${pool.mine}/${pool.cap}`}</span>
        </div>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-1" role="img" aria-label={label} title={label}>
        {pool.slots.map((slot) => (
          <Badge
            key={slot.id}
            variant="outline"
            className={toneClasses({ tone: slot.connecting ? "warning" : slot.chat ? "accent" : "muted", dashed: slot.connecting }, "min-w-8 justify-center")}
            title={debugSlotTitle(slot, now, t, titleOf)}
          >
            {slot.kind === "agent" ? "SSE" : t(SLOT_TEXT_KEYS[slot.kind])}
          </Badge>
        ))}
        {pool.overflow > 0 && <span className="text-xs tabular-nums text-destructive">{`+${pool.overflow}`}</span>}
        {pool.cap === null && pool.protocol !== null && <Chip tone="dim">{pool.protocol}</Chip>}
      </span>
    </div>
  );
}

/** A meter slot's word for what is not an agent stream ("SSE"). */
const SLOT_TEXT_KEYS: Record<Exclude<DebugPoolSlot["kind"], "agent">, string> = {
  "file-watch": "debug.box.file",
  terminal: "debug.box.terminal",
};

const STREAM_DOTS: Record<DebugEventConnectionSnapshot["state"], { tone: DebugTone; ring: boolean }> = {
  connected: { tone: "ok", ring: false },
  connecting: { tone: "warning", ring: true },
  retrying: { tone: "warning", ring: false },
  idle: { tone: "dim", ring: true },
};

/** The stream's history, one line each, only what is known: the state's tooltip. */
function streamStateTitle(client: DebugClientSession, connection: DebugEventConnectionSnapshot, page: DebugPageReading, t: Translate): string {
  const now = page.at;
  const ago = (at: number) => formatAgo(now - at, t);
  const lines: (string | false)[] = [
    connection.readyState !== null && t("debug.stream.readyState", { value: connection.readyState }),
    connection.openedAt !== null && `${t("debug.stream.opened")} ${ago(connection.openedAt)}`,
    connection.connectedAt !== null && `${t("debug.stream.connected")} ${ago(connection.connectedAt)}`,
    `${t("debug.stream.opens")} ${t("debug.stream.opensRetries", { opens: connection.opens, retries: connection.retries })}`,
    connection.lastError !== null && `${t("debug.stream.lastError")} ${join([
      translateDebugCode(connection.lastError.reason, DEBUG_STREAM_ERROR_KEYS, t),
      connection.lastError.message,
      ago(connection.lastError.at),
    ])}`,
    connection.lastClose !== null && `${t("debug.stream.lastClose")} ${join([
      connection.lastClose.reason ? translateDebugCode(connection.lastClose.reason, DEBUG_CLOSE_REASON_KEYS, t) : "—",
      ago(connection.lastClose.at),
    ])}`,
    `${t("debug.stream.wanted")} ${t(client.wantsStream ? "debug.yes" : "debug.no")}`,
  ];
  const visibility = page.visibility;
  if (visibility && visibility.hiddenCount > 0) {
    lines.push(join([
      t("debug.page.hiddenCount", { count: visibility.hiddenCount }),
      visibility.lastHiddenAt !== null && t("debug.page.lastHidden", { time: ago(visibility.lastHiddenAt) }),
    ]));
  }
  if (client.released.count > 0) {
    lines.push(`${t("debug.stream.released")} ${join([
      t("debug.times", { count: client.released.count }),
      client.released.lastAt !== null && ago(client.released.lastAt),
    ])}`);
  }
  if (client.reattached.count > 0) {
    lines.push(`${t("debug.stream.reattached")} ${join([
      t("debug.times", { count: client.reattached.count }),
      client.reattached.lastAt !== null && ago(client.reattached.lastAt),
      client.reattached.lastReason && t(DEBUG_REATTACH_REASON_KEYS[client.reattached.lastReason]),
    ])}`);
  }
  return lines.filter(Boolean).join("\n");
}

/** The chat's stream: the time since its last byte against the watchdog, then its state and counts. */
function StreamRows({ page, ctx }: { page: DebugPageReading; ctx: Ctx }) {
  const { t, now } = ctx;
  const client = page.client;
  const connection = client?.connection ?? null;
  if (!client || !connection) {
    return (
      <Measure
        label={t("debug.section.stream")}
        value={<span className="text-xs text-muted-foreground">{!client ? (page.clientFailed ? "—" : t("debug.stream.noChat")) : t("debug.stream.noConnection")}</span>}
      />
    );
  }
  const title = streamStateTitle(client, connection, page, t);
  const freshness = streamFreshness(connection, now);
  const dot = STREAM_DOTS[connection.state];
  const tone = freshness ? freshnessTone(freshness.ageMs, freshness.staleAfterMs) : "dim";
  // Time since the last byte: the watchdog's limit is the scale, its heartbeat the tooltip's word.
  const watchdogTitle = freshness ? join([
    `${t("debug.stream.lastData")} ${formatAgo(freshness.ageMs, t)}`,
    connection.lastHeartbeatAt !== null && t("debug.stream.heartbeat", { time: formatAgo(now - connection.lastHeartbeatAt, t) }),
    t("debug.stream.watchdogArmed", { time: formatDebugDuration(freshness.staleAfterMs, t) }),
  ]) : undefined;
  return (
    <Field orientation="horizontal" className="gap-3">
      <FieldTitle className="min-w-24 shrink-0 justify-start text-xs font-normal text-muted-foreground" title={title}>{t("debug.section.stream")}</FieldTitle>
      <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {freshness ? (
            <>
              <Bar fraction={barFraction(freshness.ageMs, freshness.staleAfterMs) ?? 0} tone={tone} title={watchdogTitle} />
              <span className={cn("text-xs tabular-nums", TONE_TEXT[tone])} title={watchdogTitle}>
                {t("debug.stream.dataAgo", { time: formatDebugSeconds(freshness.ageMs, t) })}
              </span>
            </>
          ) : (
            <span className="text-xs tabular-nums text-muted-foreground">—</span>
          )}
        </div>
        {/* The state leads its line with its mark, so the names stay in one column. */}
        <FieldDescription className="text-xs font-normal tabular-nums [overflow-wrap:anywhere]" title={title}>
          <span className="mr-1.5 inline-flex align-middle"><Dot tone={dot?.tone ?? "dim"} ring={dot?.ring ?? true} /></span>
          {join([
            t(DEBUG_STREAM_STATE_KEYS[connection.state] ?? "debug.unknown"),
            `${t("debug.stream.events")} ${connection.events}`,
            connection.retries > 0 && `${t("debug.stream.opens")} ${t("debug.stream.opensRetries", { opens: connection.opens, retries: connection.retries })}`,
          ])}
        </FieldDescription>
        {(client.released.active || client.graceDueAt !== null) && (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {client.released.active && <Chip tone="accent">{t("debug.stream.close.released")}</Chip>}
            {client.graceDueAt !== null && <Chip tone="accent">{`${t("debug.stream.grace")} ${formatSecondsCountdown(client.graceDueAt - now, t)}`}</Chip>}
          </div>
        )}
      </div>
    </Field>
  );
}

/** The lease: the time to the next renewal against its interval, then how the last one went. */
function LeaseRows({ page, ctx }: { page: DebugPageReading; ctx: Ctx }) {
  const { t, now } = ctx;
  const lease = page.client?.lease ?? null;
  const pageId = page.client?.pageId ?? null;
  if (!lease || lease.requests === 0) {
    return (
      <Measure
        label={t("debug.section.lease")}
        value={<span className="text-xs text-muted-foreground">{!lease ? (page.clientFailed ? "—" : t("debug.stream.noChat")) : t("debug.lease.noHolder")}</span>}
      />
    );
  }
  const last = lease.last;
  const next = nextLeaseRenewalAt(lease.renewStartedAt, lease.renewIntervalMs, now);
  const waiting = lease.inFlightSince !== null && now - lease.inFlightSince >= DEBUG_POLL_MS;
  const tone: DebugTone = waiting || last?.outcome === "unanswered" ? "warning" : last?.outcome === "error" ? "error" : "dim";
  const counts = t("debug.lease.countsValue", { requests: lease.requests, unanswered: lease.unanswered, errors: lease.errors });
  const title = join([
    next !== null && `${t("debug.lease.next")} ${formatSecondsCountdown(next - now, t)}`,
    t("debug.lease.every", { time: formatDebugDuration(lease.renewIntervalMs, t) }),
    counts,
    pageId !== null && `${t("debug.holder.thisPage")} ${shortDebugId(pageId)}`,
  ]);
  return (
    <Field orientation="horizontal" className="gap-3">
      <FieldTitle className="min-w-24 shrink-0 justify-start text-xs font-normal text-muted-foreground" title={title}>{t("debug.section.lease")}</FieldTitle>
      <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {next === null ? (
            <span className="text-xs tabular-nums text-muted-foreground">—</span>
          ) : (
            <>
              {/* Fills toward the renewal, as the stream's bar fills toward its watchdog; waiting for an
                  answer: full and amber until it comes. */}
              <Bar fraction={waiting ? 1 : 1 - (barFraction(next - now, lease.renewIntervalMs) ?? 1)} tone={tone} title={title} />
              {/* The value says what it counts: "renews in 18s", as the stream's says "data 21s ago". */}
              <span className={cn("text-xs tabular-nums", TONE_TEXT[tone])} title={title}>
                {next - now > 0 ? t("debug.lease.renewsIn", { time: formatDebugSeconds(next - now, t, "ceil") }) : t("debug.lease.renewing")}
              </span>
            </>
          )}
        </div>
        <FieldDescription className="text-xs font-normal tabular-nums [overflow-wrap:anywhere]">
          {`${t("debug.lease.last")} ${last
            ? join([
              t(DEBUG_LEASE_OUTCOME_KEYS[last.outcome] ?? "debug.unknown"),
              formatDebugDuration(last.durationMs, t),
              last.outcome === "error" && last.httpStatus !== null && `HTTP ${last.httpStatus}`,
              t("debug.time.ago", { time: formatDebugSeconds(now - last.at, t) }),
            ])
            : t("debug.notYet")}`}
        </FieldDescription>
        {(lease.unanswered > 0 || lease.errors > 0) && (
          <FieldDescription className="text-xs font-normal tabular-nums">{counts}</FieldDescription>
        )}
      </div>
    </Field>
  );
}

// ── C2. Server: totals in the head ──

/** The server's column: its own totals, then the pages holding its streams. */
function ServerColumn({ reply, ctx }: { reply: DebugSnapshotResponse | null; ctx: Ctx }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="debug-section-server">
      <h3 id="debug-section-server" data-debug-section="server" className="text-sm leading-none font-semibold text-foreground">
        {ctx.t("debug.section.server")}
      </h3>
      <ServerHead reply={reply} ctx={ctx} />
      <PageList reply={reply} ctx={ctx} />
    </section>
  );
}

function ServerHead({ reply, ctx }: { reply: DebugSnapshotResponse | null; ctx: Ctx }) {
  const { t, clock } = ctx;
  if (!reply || !clock) {
    return <p className="text-xs text-muted-foreground">{t("debug.poll.waiting")}</p>;
  }
  const global = reply.server;
  const wrappers = t("debug.global.wrappersValue", { ...global.wrappers });
  const timers = `${t("debug.global.timers")}: ${t("debug.global.timersValue", {
    idle: global.idleTimeoutMs > 0 ? formatDebugDuration(global.idleTimeoutMs, t) : t("debug.server.idleDisabled"),
    heartbeat: formatDebugDuration(global.heartbeatMs, t),
  })}\n${wrappers}`;
  const terminals = global.terminals;
  const terminalsLabel = join([
    `${t("debug.global.terminals")}: ${t("debug.global.terminalsValue", {
      count: terminals.count,
      listeners: terminals.listeners,
      detached: terminals.detached,
      exited: terminals.exited,
    })}`,
    terminals.nextCleanupAt !== null && t("debug.global.cleanup", { time: formatCountdown(clock.remaining(terminals.nextCleanupAt), t) }),
  ]);
  // Detached shells first (dashed), then exited ones (faint), then the rest.
  const terminalItems: BadgeItem[] = Array.from({ length: terminals.count }, (_, index) => {
    if (index < terminals.detached) return { tone: "dim", dashed: true, title: terminalsLabel };
    if (index < terminals.detached + terminals.exited) return { tone: "muted", faded: true, title: terminalsLabel };
    return { tone: "muted", title: terminalsLabel };
  });
  const watchesLabel = `${t("debug.global.fileWatches")}: ${global.fileWatches}`;
  const starting = global.wrappers.starting;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1" title={timers}>
        <Glyph kind="server" />
        <span>{`${t("debug.global.uptime")} ${formatDebugDuration(clock.age(global.startedAt), t)}`}</span>
      </span>
      {/* Wrappers still starting: a dashed outline Badge, the same mark the rows use. */}
      {starting > 0 && (
        <Badge
          variant="outline"
          className="gap-1 border-dashed font-normal text-muted-foreground tabular-nums"
          role="img"
          aria-label={wrappers}
          title={wrappers}
        >
          <LoaderCircleIcon className="size-3 shrink-0 motion-reduce:animate-none" aria-hidden="true" />
          {starting}
        </Badge>
      )}
      <BadgeRun
        text={t("debug.box.file")}
        items={Array.from({ length: global.fileWatches }, () => ({ tone: "muted" as const, title: watchesLabel }))}
        cap={4}
        label={watchesLabel}
      />
      <BadgeRun text={t("debug.box.terminal")} items={terminalItems} cap={4} label={terminalsLabel} />
    </div>
  );
}

/**
 * The pages holding the server's event streams, one row each: who it is (browser and system
 * marks and words, its reported address), which page, and how many SSE connections it holds of
 * every kind (the agent's, terminals', file watches'; each takes one of the browser's), with the
 * server's total in the head. This page first, on the current row's tint. What a page is lives
 * here once rather than in every badge of every session it holds.
 */
function PageList({ reply, ctx }: { reply: DebugSnapshotResponse | null; ctx: Ctx }) {
  const { t, myHolder } = ctx;
  if (!reply) return null;
  const { pages, sseTotal } = reply.server;
  if (sseTotal === 0 && pages.length === 0) return null;
  const holders = thisPageFirst(pages, myHolder);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{`${t("debug.pages.title")} ${holders.length}`}</span>
        <span className="tabular-nums text-muted-foreground">{`SSE ${t("debug.global.streamTotal", { count: sseTotal })}`}</span>
      </div>
      <Table>
        <TableBody>
          {holders.map((entry, index) => {
            const mine = entry.holder !== null && entry.holder === myHolder;
            const page = debugHolderLabel(entry.holder, myHolder, t);
            const count = entry.agent + entry.terminal + entry.fileWatch;
            // By kind, as the page's own meter counts them.
            const kinds = join([
              entry.agent > 0 && `${t(DEBUG_SOURCE_KIND_KEYS.agent)} ${entry.agent}`,
              entry.terminal > 0 && `${t(DEBUG_SOURCE_KIND_KEYS.terminal)} ${entry.terminal}`,
              entry.fileWatch > 0 && `${t(DEBUG_SOURCE_KIND_KEYS["file-watch"])} ${entry.fileWatch}`,
            ]);
            return (
              <TableRow
                key={`${entry.holder ?? ""}:${index}`}
                // The current row's tint is the official selected state, not a hand-painted box.
                data-state={mine ? "selected" : undefined}
                title={join([page, entry.client, entry.address, `SSE ${count}`, kinds])}
              >
                <TableCell className="text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><ClientIcons client={entry.client} /></span>
                    <span className={cn("min-w-0 truncate", entry.client ? "text-foreground" : "text-muted-foreground")}>
                      {entry.client ?? t("debug.pages.unknownClient")}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{entry.address ?? "—"}</TableCell>
                {/* "this page", or another page's short id: the row's title says the rest. */}
                <TableCell className="text-xs text-muted-foreground">
                  {mine ? t("debug.holder.thisPage") : entry.holder !== null ? <span className="font-mono tabular-nums">{shortDebugId(entry.holder)}</span> : t("debug.holder.none")}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{count}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── C3. Sessions on the server, the chat's details under its row ──

function SessionList({ reply, detail, groups, targetSessionId, sources, ctx }: {
  reply: DebugSnapshotResponse | null;
  /** The chat's session in full: its row shows the holders the summaries lack, its details below. */
  detail: DebugSessionDetail | null;
  groups: readonly DebugSessionGroup[] | null;
  targetSessionId: string | null;
  sources: DebugPageReading["sources"];
  ctx: Ctx;
}) {
  const { t, clock } = ctx;
  if (!reply || !clock || !groups) return <DebugEmpty>{t("debug.poll.waiting")}</DebugEmpty>;
  const listed = detail !== null && groups.some((group) => group.rows.some((row) => row.current && row.id === detail.sessionId));
  // Above the groups: no chat, an answer still about another one, or a chat the server holds
  // nothing for, which has no row to sit under.
  let lead: ReactNode = null;
  if (!targetSessionId) lead = <DebugEmpty>{t("debug.server.noSession")}</DebugEmpty>;
  else if (!detail) lead = <DebugEmpty>{t("debug.poll.waiting")}</DebugEmpty>;
  else if (!listed) lead = <UnlistedCurrent detail={detail} clock={clock} ctx={ctx} />;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {lead}
      {groups.length === 0 && !(detail && !listed) && <DebugEmpty>{t("debug.none")}</DebugEmpty>}
      {groups.map((group) => (
        <div key={group.key} className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {group.name !== null && <FolderIcon className="size-3 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate font-medium">{group.name ?? t("debug.sessions.unlisted")}</span>
            <span className="tabular-nums">{group.rows.filter((row) => row.summary !== null).length}</span>
          </div>
          <ItemGroup className="gap-0.5">
            {group.rows.map((row) => {
              const mine = row.current && detail?.sessionId === row.id ? detail : null;
              return (
                <SessionRow
                  key={row.id}
                  row={row}
                  sources={sources}
                  idleTimeoutMs={reply.server.idleTimeoutMs}
                  clock={clock}
                  ctx={ctx}
                  current={mine ? currentRowExtras(mine, clock, ctx) : undefined}
                  detail={mine ? <SessionDetail detail={mine} clock={clock} ctx={ctx} /> : null}
                />
              );
            })}
          </ItemGroup>
        </div>
      ))}
    </div>
  );
}

/** The sessions' column: the groups, with the chat's details under its own row. */
function SessionColumn(props: {
  reply: DebugSnapshotResponse | null;
  detail: DebugSessionDetail | null;
  groups: readonly DebugSessionGroup[] | null;
  targetSessionId: string | null;
  sources: DebugPageReading["sources"];
  ctx: Ctx;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="debug-section-sessions">
      <h3 id="debug-section-sessions" data-debug-section="sessions" className="text-sm leading-none font-semibold text-foreground">
        {props.ctx.t("debug.sessions.head.session")}
      </h3>
      <SessionList {...props} />
    </section>
  );
}

interface CurrentRowExtras {
  /** Its holders, which the other rows' summaries lack. */
  badges: ReactNode;
  /** The reap countdown to the second, with what moves it. */
  idleTitle?: string;
  /** When it last started and closed. */
  startsTitle?: string;
}

function currentRowExtras(detail: DebugSessionDetail, clock: DebugServerClock, ctx: Ctx): CurrentRowExtras {
  const { t } = ctx;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  const idle = detail.wrapper?.idle ?? null;
  const lifecycle = detail.lifecycle;
  return {
    badges: <DetailBadges detail={detail} clock={clock} ctx={ctx} />,
    idleTitle: idle && idle.nextCheckAt !== null ? join([
      `${t("debug.server.idle")} ${formatDebugDuration(clock.remaining(idle.nextCheckAt), t)}`,
      idle.timeoutMs > 0 && t("debug.server.idleTimeout", { time: formatDebugDuration(idle.timeoutMs, t) }),
      idle.lastResetAt !== null && t("debug.server.idleReset", { time: ago(idle.lastResetAt) }),
      t(idle.forcedByStop ? "debug.server.idleForced" : "debug.server.idleHint"),
    ]) : undefined,
    startsTitle: lifecycle && lifecycle.starts > 1 ? startsTitle(lifecycle, ago, t) : undefined,
  };
}

function startsTitle(lifecycle: NonNullable<DebugSessionDetail["lifecycle"]>, ago: (at: number) => string, t: Translate): string {
  return join([
    t("debug.overlay.starts", { count: lifecycle.starts }),
    t("debug.server.lastStart", { time: ago(lifecycle.lastStartedAt) }),
    lifecycle.lastClosedAt !== null && t("debug.server.lastClosed", { time: ago(lifecycle.lastClosedAt) }),
  ]);
}

/** The chat when the server holds no wrapper or stream for it: its row on its own, its state below. */
function UnlistedCurrent({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t, titleOf } = ctx;
  const name = titleOf(detail.sessionId) ?? shortDebugId(detail.sessionId);
  const status = detailStatus(detail);
  return (
    <ItemGroup className="gap-0.5">
      <Item size="xs" variant="muted" className="flex-wrap gap-x-2 gap-y-1" title={t("debug.sessions.current")}>
        <ItemMedia className="w-4">
          <StatusSlot state={status} label={t(DEBUG_STATUS_KEYS[status])} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="min-w-0 max-w-full text-xs font-medium text-muted-foreground">{name}</ItemTitle>
        </ItemContent>
        <ItemFooter className="min-w-0 flex-col items-stretch gap-1.5">
          <SessionDetail detail={detail} clock={clock} ctx={ctx} unlisted />
        </ItemFooter>
      </Item>
    </ItemGroup>
  );
}

function detailStatus(detail: DebugSessionDetail): DebugStatusState {
  const wrapper = detail.wrapper;
  if (wrapper) return debugStatusState({ awaitingInput: wrapper.awaitingInput, running: wrapper.run.running, state: wrapper.state });
  return detail.starting ? "starting" : "none";
}

/**
 * What the server holds for the chat beyond its row: its id and marks, the run's chips, its start
 * and last event and command, its subagents and MCP servers. The row above has its state, holders
 * and reap countdown.
 */
function SessionDetail({ detail, clock, ctx, unlisted = false }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx; unlisted?: boolean }) {
  const { t, titleOf } = ctx;
  const wrapper = detail.wrapper;
  const lifecycle = detail.lifecycle;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  const live = wrapper !== null && !wrapper.stale;
  const closing = wrapper?.state === "closing"
    ? wrapper.closingAt !== null ? t("debug.server.closingSince", { time: ago(wrapper.closingAt) }) : t("debug.state.closing")
    : null;
  const activity = wrapper && join([
    wrapper.startedAt != null && `${t("debug.server.started")} ${ago(wrapper.startedAt)}`,
    live && wrapper.lastEvent && `${t("debug.server.lastEvent")} ${wrapper.lastEvent.type} ${ago(wrapper.lastEvent.at)}`,
    live && wrapper.lastCommand && `${t("debug.server.lastCommand")} ${wrapper.lastCommand.type} ${ago(wrapper.lastCommand.at)}`,
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {titleOf(detail.sessionId) !== null && <span className="font-mono tabular-nums">{shortDebugId(detail.sessionId)}</span>}
        {!wrapper && <span className="text-xs text-muted-foreground">{t(detail.starting ? "debug.server.starting" : "debug.server.noWrapper")}</span>}
        {/* A listed row has its own ↻ count. */}
        {unlisted && lifecycle && lifecycle.starts > 1 && (
          <span className="font-mono tabular-nums" title={startsTitle(lifecycle, ago, t)}>{`↻${lifecycle.starts}`}</span>
        )}
        {closing && <Chip tone="warning">{closing}</Chip>}
        {wrapper?.chatOnly && <Chip tone="dim">{t("debug.server.chatOnly")}</Chip>}
        {wrapper?.subagent && <Chip tone="dim">{t("debug.server.subagent")}</Chip>}
        {wrapper?.stale && <Chip tone="warning">{t("debug.server.stale")}</Chip>}
        <ListenerMismatch detail={detail} t={t} />
        {live && <RunChips detail={detail} t={t} />}
        {activity && <span className="min-w-0 font-mono text-xs tabular-nums [overflow-wrap:anywhere]">{activity}</span>}
      </div>
      {live && <SubagentRows detail={detail} clock={clock} ctx={ctx} />}
      {live && <McpRows detail={detail} clock={clock} ctx={ctx} />}
    </div>
  );
}

/** A wrapper whose listeners differ from the streams the server lists for it: one leaked or lost. */
function ListenerMismatch({ detail, t }: { detail: DebugSessionDetail; t: Translate }) {
  const wrapper = detail.wrapper;
  const mismatch = wrapper !== null && !wrapper.stale
    && detail.eventStreams.every((stream) => stream.connectedAt !== null)
    && wrapper.eventListeners !== detail.eventStreams.length;
  if (!mismatch || !wrapper) return null;
  return <Chip tone="warning">{`${t("debug.server.listeners")} ${wrapper.eventListeners}`}</Chip>;
}

/**
 * The chat's row in the list: one badge per event stream ("SSE") and liveness provider (its name)
 * the server holds for the session, with the holders the other rows' summaries lack: this page's
 * first and filled. Same caps as the other rows.
 */
function DetailBadges({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t, myHolder } = ctx;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  const streams = thisPageFirst([...detail.eventStreams].sort((a, b) => a.openedAt - b.openedAt), myHolder);
  const streamItems: BadgeItem[] = streams.map((stream) => {
    const starting = stream.connectedAt === null;
    return {
      tone: starting || stream.droppedEvents > 0 ? "warning" : debugHolderTone(stream.holder, myHolder),
      filled: stream.holder !== null && stream.holder === myHolder,
      dashed: starting,
      // Which page, then where it says it is: a browser label and an address tell pages apart.
      title: join([
        debugHolderLabel(stream.holder, myHolder, t),
        stream.client,
        stream.address,
        stream.connectedAt !== null ? t("debug.server.streamConnected", { time: ago(stream.connectedAt) }) : t("debug.server.streamStarting"),
        stream.lastWriteAt !== null && t("debug.server.lastWrite", { time: ago(stream.lastWriteAt) }),
        stream.droppedEvents > 0 && t("debug.server.dropped", { count: stream.droppedEvents }),
        stream.queuedBytes > 0 && t("debug.server.queued", { size: formatBytes(stream.queuedBytes) }),
      ]),
    };
  });
  const providers = detail.providers;
  // Names unknown (server code from before a reload): one dim badge with the generic word.
  const providerItems: BadgeItem[] = providers === null
    ? [{ tone: "dim", title: t("debug.server.providersUnknown") }]
    : providers.map((provider) => ({
      tone: provider.active === "error" ? "error" : provider.active ? "muted" : "dim",
      faded: provider.active === false,
      text: provider.name,
      title: join([
        provider.name,
        t(provider.active === "error" ? "debug.server.providerError" : provider.active ? "debug.server.providerActive" : "debug.server.providerInactive"),
        provider.byFile && t("debug.server.byFile"),
      ]),
    }));
  return (
    <>
      <BadgeRun text="SSE" items={streamItems} cap={3} label={holderGroupLabel("SSE", streams.map((stream) => stream.holder), myHolder, t)} />
      <BadgeRun
        text={t("debug.box.provider")}
        items={providerItems}
        cap={1}
        label={`${t("debug.server.providers")}: ${providers === null ? t("debug.server.providersUnknown") : providers.length}`}
      />
    </>
  );
}

/** What the run is doing, dim; what it waits on, amber. */
function RunChips({ detail, t }: { detail: DebugSessionDetail; t: Translate }) {
  const wrapper = detail.wrapper;
  if (!wrapper) return null;
  const run = wrapper.run;
  const dimChips = [
    run.streaming && t("debug.run.streaming"),
    run.promptRunning && t("debug.run.prompt"),
    run.bashRunning && t("debug.run.bash"),
    run.compacting && t("debug.run.compacting"),
    run.queuedMessages > 0 && t("debug.run.queued", { count: run.queuedMessages }),
    run.runningTools > 0 && t("debug.run.tools", { count: run.runningTools }),
    run.mutatingCommands > 0 && t("debug.run.mutating", { count: run.mutatingCommands }),
    run.replacement && t("debug.run.replacement", { kind: run.replacement }),
    wrapper.extensions === "binding" && `${t("debug.server.extensions")} ${t("debug.server.extensions.binding")}`,
  ].filter((chip): chip is string => Boolean(chip));
  const warnChips = [
    run.pendingPrompts > 0 && t("debug.run.pending", { count: run.pendingPrompts }),
    run.retrying && t("debug.run.retrying"),
    run.waitingForMcp && t("debug.run.waitingForMcp"),
    wrapper.awaitingInput && wrapper.pendingUiRequests > 0 && t("debug.server.uiRequests", { count: wrapper.pendingUiRequests }),
    wrapper.awaitingInput && wrapper.customUis > 0 && t("debug.server.customUis", { count: wrapper.customUis }),
  ].filter((chip): chip is string => Boolean(chip));
  return (
    <>
      {dimChips.map((chip) => <Chip key={chip} tone="dim">{chip}</Chip>)}
      {warnChips.map((chip) => <Chip key={chip} tone="warning">{chip}</Chip>)}
    </>
  );
}

const RUN_TONES: Partial<Record<string, DebugTone>> = {
  completed: "ok",
  failed: "error",
  aborted: "warning",
  interrupted: "warning",
};

/** A subagent run's mark: the sidebar's spinner while it runs, the agent switcher's shapes once settled. */
function RunIcon({ status }: { status: string }) {
  if (status === "running" || status === "starting") {
    return <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />;
  }
  const tone = RUN_TONES[status];
  if (tone) return <span className={cn("inline-flex size-3 shrink-0 items-center justify-center", TONE_TEXT[tone])}><StatusIcon status={status as SubagentSessionStatus} /></span>;
  return <CircleIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function SubagentRows({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t, titleOf } = ctx;
  const subagents = detail.subagents;
  if (!subagents.active && subagents.runs.length === 0 && subagents.notifications.length === 0) return null;
  const ago = (at: number) => formatAgo(clock.age(at), t);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">{t("debug.server.subagents")}</span>
        {subagents.active && <Chip tone="accent">{t("debug.server.subagentsActive")}</Chip>}
      </div>
      <ItemGroup className="gap-0.5">
        {subagents.runs.map((run, index) => (
          <Item key={`${run.sessionId}:${index}`} size="xs" className="flex-wrap gap-x-2 gap-y-1">
            <ItemMedia className="w-3"><RunIcon status={run.status} /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="min-w-0 max-w-full text-xs font-medium">
                {titleOf(run.sessionId) ?? run.profile ?? shortDebugId(run.sessionId)}
              </ItemTitle>
            </ItemContent>
            <ItemActions className="min-w-0 flex-wrap justify-end gap-1 text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
              <span>
                {join([
                  translateDebugCode(run.status, DEBUG_RUN_STATUS_KEYS, t),
                  run.background && t("debug.server.background"),
                  run.resumed && t("debug.server.resumed"),
                  run.dispatchedAt !== null && ago(run.dispatchedAt),
                ])}
              </span>
              {run.abortRequested && <Chip tone="warning">{t("debug.server.abortRequested")}</Chip>}
              {run.mcpWaiting && <Chip tone="warning">{t("debug.run.waitingForMcp")}</Chip>}
            </ItemActions>
          </Item>
        ))}
        {subagents.notifications.map((notification, index) => (
          <p key={`${notification.sessionId}:${index}`} className="min-w-0 px-2.5 text-xs text-warning tabular-nums [overflow-wrap:anywhere]">
            {join([
              t("debug.server.notifying", { parent: shortDebugId(notification.parentSessionId) }),
              notification.since !== null && ago(notification.since),
            ])}
          </p>
        ))}
      </ItemGroup>
    </div>
  );
}

function McpRows({ detail, clock, ctx }: { detail: DebugSessionDetail; clock: DebugServerClock; ctx: Ctx }) {
  const { t } = ctx;
  const mcp = detail.mcp;
  if (!mcp || (mcp.servers.length === 0 && mcp.problems === 0)) return null;
  const release = mcp.idleReleaseAt !== null && mcp.idleMs > 0 ? clock.remaining(mcp.idleReleaseAt) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={cn("text-xs font-semibold", mcp.active ? "text-foreground" : "text-muted-foreground")}>MCP</span>
        {mcp.servers.map((mcpServer, index) => {
          const { tone, filled } = mcpServerTone(mcpServer);
          const stateWord = translateDebugCode(mcpServer.state, MCP_SESSION_STATE_KEYS, t);
          const label = join([
            `${mcpServer.name} (${mcpServer.scope})`,
            stateWord,
            mcpServer.released && t("debug.server.mcpReleased"),
            mcpServer.hasError && t("debug.server.mcpError"),
          ]);
          // Any state but connected also in words, and an error on a connected one: the dot's
          // amber and red alone are a hue. The state word is an outline Badge like every other.
          const word = mcpServer.state !== "connected" ? stateWord : mcpServer.hasError ? t("debug.server.mcpError") : null;
          return (
            <Badge
              key={`${mcpServer.scope}:${mcpServer.name}:${index}`}
              variant="outline"
              className={cn("gap-1 font-normal", TONE_TEXT[tone])}
              role="img"
              aria-label={label}
              title={label}
            >
              <Dot tone={tone} ring={!filled} />
              <span className={mcpServer.released ? "text-muted-foreground" : undefined}>{mcpServer.name}</span>
              {word && <span className="font-normal text-muted-foreground">{`· ${word}`}</span>}
            </Badge>
          );
        })}
        {mcp.problems > 0 && <Chip tone="warning">{t("debug.server.mcpProblems", { count: mcp.problems })}</Chip>}
        {mcp.disposed && <Chip tone="dim">{t("debug.server.mcpDisposed")}</Chip>}
      </div>
      {release !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Bar fraction={barFraction(release, mcp.idleMs) ?? 0} tone="dim" width="w-20" />
          <span className="text-xs tabular-nums text-muted-foreground">{t("debug.server.mcpRelease", { time: formatCountdown(release, t) })}</span>
        </div>
      )}
    </div>
  );
}

function SessionRow({ row, sources, idleTimeoutMs, clock, ctx, current, detail }: {
  row: DebugSessionRow;
  sources: DebugPageReading["sources"];
  idleTimeoutMs: number;
  clock: DebugServerClock;
  ctx: Ctx;
  /** The chat's row: what the session's detail adds to the summary. */
  current?: CurrentRowExtras;
  /** The chat's details, in the row's own footer: one Item, never a card inside a card. */
  detail?: ReactNode;
}) {
  const { t } = ctx;
  const summary = row.summary;
  const name = row.info ? sessionRowTitle(row.info) : shortDebugId(row.id);
  const remaining = summary && summary.nextIdleCheckAt !== null ? clock.remaining(summary.nextIdleCheckAt) : null;
  const state = summary ? debugStatusState(summary) : null;
  return (
    <Item
      size="xs"
      variant={row.current ? "muted" : "default"}
      data-current={row.current ? "true" : undefined}
      data-depth={row.depth === 1 ? "sub" : undefined}
      data-placeholder={row.placeholder ? "true" : undefined}
      className="flex-wrap gap-x-2 gap-y-1"
      title={join([row.current && t("debug.sessions.current"), summary ? debugSessionTitle(summary, remaining, t) : name])}
    >
      <ItemMedia className="w-4">{state && <StatusSlot state={state} label={t(DEBUG_STATUS_KEYS[state])} />}</ItemMedia>
      <ItemContent className={cn("min-w-0", row.depth === 1 && "pl-4")}>
        <ItemTitle className={cn("min-w-0 max-w-full gap-1 text-xs font-medium", row.depth === 1 && "text-muted-foreground", row.placeholder && "text-muted-foreground")}>
          {name}
          {summary && summary.starts > 1 && (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" title={current?.startsTitle}>{`↻${summary.starts}`}</span>
          )}
        </ItemTitle>
      </ItemContent>
      {summary && (
        <ItemActions className="min-w-0 flex-wrap justify-end gap-1">
          <SessionRowCells
            summary={summary}
            mine={pageAgentStreamCount(sources, row.id)}
            remaining={remaining}
            idleTimeoutMs={idleTimeoutMs}
            t={t}
            badges={current?.badges}
            idleTitle={current?.idleTitle}
          />
        </ItemActions>
      )}
      {detail && <ItemFooter className="min-w-0 flex-col items-stretch gap-1.5">{detail}</ItemFooter>}
    </Item>
  );
}

function SessionRowCells({ summary, mine, remaining, idleTimeoutMs, t, badges, idleTitle }: {
  summary: DebugSessionSummary;
  badges?: ReactNode;
  idleTitle?: string;
  /** This page's streams for the session: the first badges are filled. */
  mine: number;
  remaining: number | null;
  idleTimeoutMs: number;
  t: Translate;
}) {
  const streamsLabel = t("debug.overlay.streams", { count: summary.eventStreams });
  const ours = Math.min(summary.eventStreams, mine);
  const streams: BadgeItem[] = Array.from({ length: summary.eventStreams }, (_, index) => (
    index < ours ? { tone: "accent", filled: true, title: streamsLabel } : { tone: "muted", title: streamsLabel }
  ));
  // The summary holds no holders and no provider names: outlined, and the generic word.
  const providersLabel = t("debug.overlay.providers", { count: summary.providers });
  const providers: BadgeItem[] = Array.from({ length: summary.providers }, () => ({ tone: "muted", title: providersLabel }));
  const idleShown = remaining !== null && (idleTimeoutMs > 0 || summary.forcedByStop);
  const idleTone: DebugTone = summary.forcedByStop ? "warning" : "dim";
  const forcedLabel = remaining !== null ? t("debug.overlay.closesIn", { time: formatDebugSeconds(remaining, t) }) : undefined;
  return (
    <>
      {/* The row's badges: one run per kind, a second line under the title in a narrow panel. */}
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        {badges ?? (
          <>
            <BadgeRun text="SSE" items={streams} cap={3} label={streamsLabel} />
            <BadgeRun text={t("debug.box.provider")} items={providers} cap={1} label={providersLabel} />
          </>
        )}
      </span>
      <span
        className={cn("flex shrink-0 items-center gap-1 text-xs tabular-nums", TONE_TEXT[idleTone])}
        title={idleTitle}
      >
        {idleShown && remaining !== null && (
          <>
            {idleTimeoutMs > 0 && (
              <Bar fraction={barFraction(remaining, idleTimeoutMs) ?? 0} tone={idleTone} width="w-8" />
            )}
            {/* Closing after Stop, at every width: a stop square, not the amber alone. */}
            {summary.forcedByStop && (
              <SquareIcon className="size-2.5 shrink-0" fill="currentColor" role="img" aria-label={forcedLabel} />
            )}
            <span className="min-w-9 text-right">{formatDebugSeconds(remaining, t)}</span>
          </>
        )}
      </span>
    </>
  );
}
