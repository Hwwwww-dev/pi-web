"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { SessionFamily } from "@/lib/session-family";
import { splitForkSuffix } from "@/lib/session-fork-name";
import { MAX_PROJECT_NAME_LENGTH, type ProjectMovePosition } from "@/lib/session-ui-state-shared";
import {
  PINNED_MORE_KEY,
  getRowOffsets,
  getVisibleRowIndices,
  revealScrollTop,
  revealStep,
  type RevealMisses,
  type SidebarLayout,
  type SidebarProject,
  type SidebarRow,
} from "@/lib/session-tree";
import type { SessionInfo } from "@/lib/types";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import { formatRelativeTime, formatShortRelativeTime } from "@/lib/i18n/format";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { useGroupDrag, type GroupDragHandlers } from "@/hooks/useGroupDrag";
import { useI18n } from "@/hooks/useI18n";
import type { SidebarMenuAnchor } from "./SidebarMenu";
import {
  ArchiveIcon,
  GitBranchIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The sessions tab's tree: the pinned section, every project as a group of
 * session families, and the footer links, or the archive view's rows. It
 * renders the flat rows of lib/session-tree.ts in one virtualized scroll and
 * owns nothing but scroll position, viewport size, which row has focus and a
 * group being dragged (hooks/useGroupDrag.ts); every decision (what is shown,
 * what is open, what is being renamed, where a group goes) comes in through
 * props, so a row scrolled out of view loses no state.
 */

type SessionRow = Extract<SidebarRow, { kind: "session" }>;

/**
 * A request to bring one row into view, made by the parent after a change
 * that puts it somewhere the user is not looking (a fork's new row, a moved
 * group). Until it is handled the row is kept mounted. It is handled once:
 * scrolled to when its row is in the rows, or dropped (revealStep(): its row
 * missed REVEAL_MAX_MISSES rows updates, or it is older than
 * REVEAL_EXPIRY_MS), so it never fires later, when that row shows up for
 * another reason (its group expanded minutes after). Either way the tree
 * calls onRevealHandled(id), and the parent drops the request: kept, a tree
 * mounted again (search results replace it while a query is typed) would
 * take it for a new one.
 */
export interface SessionTreeReveal {
  /** Unique: a new number for every request. */
  id: number;
  /** When it was made (Date.now()). */
  at: number;
  /** Any row's key: a session row, a group header. */
  rowKey: string;
  /** "start": the row goes to the top (a group header with its rows below it); else centred when out of view. */
  block?: "start";
  /**
   * Also focus the row's first control once it is on the page: when focus has
   * fallen to <body>, or when this says the element that has it may give it
   * up (it is still where the request came from). Omitted: focus stays put.
   */
  takeFocusFrom?: (active: Element) => boolean;
}

export interface SessionTreeProps {
  rows: SidebarRow[];
  layout: SidebarLayout;
  /** Shown above the footer rows when there are no session/group rows; null = none. */
  emptyLabel: string | null;
  /** Shows t("sidebar.loading") instead of rows. */
  loading: boolean;
  error: string | null;
  renamingRootId: string | null;
  /** The project whose group header is a name field (its menu's Rename…). */
  renamingProjectKey: string | null;
  confirmDeleteRootId: string | null;
  /** Row whose menu is open: kept mounted, its ⋯ shown pressed. A group row's key works too. */
  activeMenuRowKey: string | null;
  onSelectFamily(family: SessionFamily): void;
  /** `all` (Alt+click): every group follows this one. */
  onToggleGroup(projectKey: string, all: boolean): void;
  /** Reveal SHOW_MORE_STEP more families; key is a projectKey or PINNED_MORE_KEY. */
  onShowMore(key: string): void;
  /** Back to the base limit; key is a projectKey or PINNED_MORE_KEY. */
  onShowLess(key: string): void;
  onTogglePinned(): void;
  onArchiveFamily(family: SessionFamily): void;
  onRestoreFamily(family: SessionFamily): void;
  onOpenRowMenu(row: SessionRow, anchor: SidebarMenuAnchor, opener: HTMLElement | null): void;
  /** The sidebar dispatches the downstream event first. */
  onRowContextMenu(row: SessionRow, event: ReactMouseEvent): void;
  /** `value` is the raw input text; the caller trims and skips unchanged titles. */
  onRenameCommit(family: SessionFamily, value: string): void;
  onRenameCancel(): void;
  /** `value` is the raw input text; the caller decides what it saves. */
  onRenameProjectCommit(project: SidebarProject, value: string): void;
  onRenameProjectCancel(): void;
  onDeleteConfirm(family: SessionFamily, event: ReactMouseEvent): void;
  onDeleteCancel(): void;
  /** A group's "+": a new session in that project at once. */
  onGroupNew(project: SidebarProject): void;
  onGroupMenu(project: SidebarProject, opener: HTMLElement): void;
  /** An unpinned empty group's "Pin to keep": without sessions, only a pin keeps it listed. */
  onPinEmptyGroup(project: SidebarProject): void;
  /** An archive header's toggle; `all` (Alt+click): every archive group follows this one. */
  onToggleArchiveGroup?(projectKey: string, all: boolean): void;
  /** An archive header's ⋯: Restore all, Delete…. */
  onArchiveGroupMenu?(project: SidebarProject, opener: HTMLElement): void;
  onOpenOtherProject(opener: HTMLElement): void;
  onOpenArchive(): void;
  /** Scroll a row into view (and maybe focus it); see SessionTreeReveal. */
  reveal?: SessionTreeReveal | null;
  /** The reveal request with this id was scrolled to or dropped: the parent lets go of it. */
  onRevealHandled?(id: number): void;
  /** A group dropped next to another of its band. Without it no group can be dragged. */
  onMoveGroup?(projectKey: string, anchorKey: string, position: ProjectMovePosition): void;
}

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN_PX = 240;
/** How often relative times ("5m") move on while nothing else re-renders. */
const CLOCK_TICK_MS = 60_000;
const DELETE_TITLE_MAX = 22;

/**
 * The rows' two alignment lines (docs/agents/sessions.md): the tree's 6px
 * left inset, plus a header toggle's 5px chevron column, and the text column
 * 20px in from the inset (26px), where project names, section labels,
 * session titles, "show more" and the footer's labels all start. The inset
 * vars live on the scroll box (app/sidebar.css, measured scrollbar room).
 */
const ROW_INSETS = "left-(--session-tree-inset-left) right-(--session-tree-inset-right)";
const TEXT_COLUMN = "pl-[22px]";

/**
 * A session's display title: its stored name, else its first message (an
 * SDK-expanded <skill> block collapsed back to the /skill:name command the
 * user typed, as MessageView shows it), else its id.
 */
export function sessionRowTitle(session: SessionInfo): string {
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);
}

function isImeKey(event: ReactKeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function anchorOf(button: HTMLElement): SidebarMenuAnchor {
  const rect = button.getBoundingClientRect();
  return { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align: "end" };
}

export function SessionTree(props: SessionTreeProps): ReactNode {
  const {
    rows,
    layout,
    emptyLabel,
    loading,
    error,
    renamingRootId,
    renamingProjectKey,
    confirmDeleteRootId,
    activeMenuRowKey,
    reveal,
  } = props;
  const { t } = useI18n();
  // Rows read the handlers at event time, so memoized rows need not re-render
  // when the parent passes new callbacks.
  const handlersRef = useRef(props);
  handlersRef.current = props;

  const treeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollFrameRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (element) setScrollTop(element.scrollTop);
    });
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A classic scrollbar takes width on the right only; the rows read its
    // width so they end 6px in or on its gutter. The files below the
    // sessions read it from the sidebar's root, to end their keys and boxes
    // where the session times end; a tree with no box (under the archive
    // view, in a hidden tab) measures nothing and leaves it.
    const syncScrollbarWidth = () => {
      const width = `${Math.max(0, element.offsetWidth - element.clientWidth)}px`;
      element.style.setProperty("--session-tree-scrollbar", width);
      if (element.offsetWidth > 0) element.closest<HTMLElement>(".session-sidebar")?.style.setProperty("--session-tree-scrollbar", width);
    };
    syncScrollbarWidth();
    setViewportHeight(element.clientHeight);
    setScrollTop(element.scrollTop);
    if (typeof ResizeObserver === "undefined") return;
    // The gutter is reserved (scrollbar-gutter in sidebar.css), but its width
    // still changes with the pointer media query, which resizes the content box.
    const observer = new ResizeObserver(() => {
      syncScrollbarWidth();
      setViewportHeight(element.clientHeight);
      // Inside a hidden tab the height was 0; coming back, the position may
      // have changed without a scroll event.
      setScrollTop(element.scrollTop);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Focus is tracked by row key, so a focused row stays mounted while it is
  // scrolled away (an inline rename, a keyboard user on ⋯).
  const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest("[data-row-key]") : null;
    setFocusedRowKey(row?.getAttribute("data-row-key") ?? null);
  }, []);
  const handleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    // Moving within the tree: the next focus event names the new row.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocusedRowKey(null);
  }, []);

  const offsets = useMemo(() => getRowOffsets(rows, layout), [rows, layout]);
  // A group header can be dragged to another place in its band (pinned
  // projects, or the others) when the band has another group.
  const canMoveGroups = Boolean(props.onMoveGroup);
  const groupsPerBand = useMemo(() => {
    const count = { pinned: 0, other: 0 };
    for (const row of rows) {
      if (row.kind === "group") count[row.project.pinned ? "pinned" : "other"]++;
    }
    return count;
  }, [rows]);
  const groupDrag = useGroupDrag({
    rows,
    offsets,
    layout,
    enabled: canMoveGroups && !loading,
    scrollRef,
    innerRef,
    treeRef,
    ghostRef,
    onMove: (projectKey, anchorKey, position) => handlersRef.current.onMoveGroup?.(projectKey, anchorKey, position),
  });
  const dragView = groupDrag.view;
  // The header holding the pointer stays mounted while auto-scroll moves it away.
  const draggedRowKey = dragView ? `group:${dragView.projectKey}` : null;
  // The last reveal request handled (scrolled to, or dropped), ignored from
  // then on, until the parent's answer to onRevealHandled arrives.
  const [handledRevealId, setHandledRevealId] = useState<number | null>(null);
  const pendingReveal = reveal && reveal.id !== handledRevealId ? reveal : null;
  const pendingRevealKey = pendingReveal?.rowKey ?? null;
  const keepMounted = useMemo(() => {
    const indices: number[] = [];
    rows.forEach((row, index) => {
      if (row.key === focusedRowKey || row.key === activeMenuRowKey || row.key === pendingRevealKey || row.key === draggedRowKey) indices.push(index);
      else if (row.kind === "session" && (row.family.root.id === renamingRootId || row.family.root.id === confirmDeleteRootId)) indices.push(index);
      else if (row.kind === "group" && row.project.key === renamingProjectKey) indices.push(index);
    });
    return indices;
  }, [rows, focusedRowKey, activeMenuRowKey, pendingRevealKey, draggedRowKey, renamingRootId, renamingProjectKey, confirmDeleteRootId]);
  const visibleIndices = useMemo(
    () => (loading ? [] : getVisibleRowIndices(offsets, scrollTop, viewportHeight, OVERSCAN_PX, keepMounted)),
    [loading, offsets, scrollTop, viewportHeight, keepMounted],
  );

  // "Show more" / "show less" change the rows under the pointer. After "show
  // less" the list can shrink by hundreds of pixels, and after a keyboard
  // "show more" the focused button moves 20 rows down: either way the more
  // row is scrolled back into view. The button a keyboard user was on may be
  // the one that disappears (the last "show more", any "show less"), or the
  // whole row may go; focus then moves to what remains of the row, else to
  // the group or pinned header. Focus waits in its own ref until a commit has
  // the target mounted, so a second rows change in between cannot drop it.
  const pendingMoreRef = useRef<{ rowKey: string; fallbackKey: string; focus: boolean; scroll: boolean } | null>(null);
  const pendingFocusRef = useRef<{
    rowKey: string;
    fallbackKey: string;
    tries: number;
    /** A reveal's rule for focus that is still on the page (see SessionTreeReveal). */
    takeFocusFrom?: (active: Element) => boolean;
  } | null>(null);
  const handleMoreAction = useCallback((rowKey: string, key: string, action: "more" | "less", button: HTMLElement) => {
    const focus = document.activeElement === button;
    const keyboard = focus && button.matches(":focus-visible");
    const fallbackKey = key === PINNED_MORE_KEY ? "pinned-header" : `group:${key}`;
    pendingMoreRef.current = { rowKey, fallbackKey, focus, scroll: action === "less" || keyboard };
    if (action === "more") handlersRef.current.onShowMore(key);
    else handlersRef.current.onShowLess(key);
  }, []);
  useLayoutEffect(() => {
    const pending = pendingMoreRef.current;
    if (!pending) return;
    pendingMoreRef.current = null;
    const element = scrollRef.current;
    let index = rows.findIndex((row) => row.key === pending.rowKey);
    if (index < 0) index = rows.findIndex((row) => row.key === pending.fallbackKey);
    if (pending.scroll && element && index >= 0) {
      const next = revealScrollTop(offsets, index, element.scrollTop, element.clientHeight);
      if (next !== null) element.scrollTop = next;
      // The browser may clamp scrollTop when the list shrank: keep the window in step either way.
      setScrollTop(element.scrollTop);
    }
    if (pending.focus) pendingFocusRef.current = { rowKey: pending.rowKey, fallbackKey: pending.fallbackKey, tries: 0 };
  }, [rows, offsets]);
  // A reveal request: scrolled to once its row is in the rows (it is kept
  // mounted meanwhile, so focus can go to it in the same commit), or dropped.
  // Its age is checked on every look, so a late one is dropped even when its
  // row has just turned up, and a tree mounted after it has gone stale.
  const revealMissesRef = useRef<RevealMisses | null>(null);
  useLayoutEffect(() => {
    if (!pendingReveal) return;
    const index = rows.findIndex((row) => row.key === pendingReveal.rowKey);
    const step = revealStep(revealMissesRef.current, pendingReveal, index >= 0, Date.now());
    revealMissesRef.current = step.misses;
    if (step.action === "wait") return;
    if (step.action === "reveal") {
      const element = scrollRef.current;
      // A tree in a hidden tab has no box to scroll: it gets its saved position back when shown.
      if (element && element.getClientRects().length > 0) {
        const next = revealScrollTop(offsets, index, element.scrollTop, element.clientHeight, pendingReveal.block);
        if (next !== null) element.scrollTop = next;
        setScrollTop(element.scrollTop);
      }
      if (pendingReveal.takeFocusFrom) {
        pendingFocusRef.current = { rowKey: pendingReveal.rowKey, fallbackKey: pendingReveal.rowKey, tries: 0, takeFocusFrom: pendingReveal.takeFocusFrom };
      }
    }
    setHandledRevealId(pendingReveal.id);
    handlersRef.current.onRevealHandled?.(pendingReveal.id);
  }, [pendingReveal, rows, offsets]);
  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const active = document.activeElement;
    // Focus that survived (the clicked button is still there) stays put,
    // unless a reveal may take it from where it is.
    if (active && active !== document.body && document.contains(active) && !target.takeFocusFrom?.(active)) {
      pendingFocusRef.current = null;
      return;
    }
    const root = scrollRef.current;
    const rowElement = (key: string) => root?.querySelector(`[data-row-key="${CSS.escape(key)}"]`) ?? null;
    const row = rowElement(target.rowKey);
    // A saved session row's first control is its link, the others' a button.
    const button = row?.querySelector<HTMLElement>("[data-more-action=\"more\"]")
      ?? row?.querySelector<HTMLElement>("a[href], button")
      ?? rowElement(target.fallbackKey)?.querySelector<HTMLElement>("a[href], button");
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocusRef.current = null;
    } else if (++target.tries > 2) {
      pendingFocusRef.current = null;
    }
  }, [visibleIndices]);

  const hasTreeRows = rows.some((row) => row.kind === "session" || row.kind === "group" || row.kind === "archive-group");
  const showEmpty = !loading && !error && emptyLabel !== null && !hasTreeRows;
  // While dragging: the group's block is dimmed in place (groups never fold
  // up under the pointer), a line marks the drop, and a pill with the
  // project's name follows the pointer, clear of it and of the line
  // (useGroupDrag places it), outside the scroll box, where it cannot make
  // room to scroll into.
  const dragSource = dragView?.source ?? null;
  const dropLineY = dragView?.drop?.lineY ?? null;
  const ghostProject = dragView?.phase === "dragging"
    ? rows.find((row): row is Extract<SidebarRow, { kind: "group" }> => row.kind === "group" && row.project.key === dragView.projectKey)?.project ?? null
    : null;

  return (
    <div ref={treeRef} className={`session-tree relative flex min-h-0 min-w-0 flex-1 flex-col${layout === "mobile" ? " is-mobile" : ""}${ghostProject ? " is-group-dragging" : ""}`}>
      {loading && (
        <div role="status" aria-label={t("sidebar.loading")} className="flex-none flex flex-col gap-2.5 p-4 px-3.5">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="session-tree-error flex-none border-0 bg-transparent px-3.5 py-3 text-xs">
          <AlertDescription className="text-xs leading-normal text-destructive">{error}</AlertDescription>
        </Alert>
      )}
      {showEmpty && (
        <Empty className="session-tree-empty flex-none items-start gap-1 border-0 p-4 px-3.5 text-left md:p-4 md:px-3.5">
          <EmptyHeader className="items-start text-left">
            <EmptyDescription className="text-xs">{emptyLabel}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div
        ref={scrollRef}
        className="session-tree-scroll scrollbar-subtle relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-1.5"
        onScroll={handleScroll}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDownCapture={groupDrag.onPointerDownCapture}
        onClickCapture={groupDrag.onClickCapture}
      >
        {!loading && (
          // Virtualized canvas height: the measured sum of all row offsets.
          <div ref={innerRef} className="session-tree-inner relative" style={{ height: offsets[rows.length] }}>
            {visibleIndices.map((index) => {
              const row = rows[index];
              if (row.kind === "spacer") return null;
              const top = offsets[index];
              const height = offsets[index + 1] - top;
              const menuOpen = row.key === activeMenuRowKey;
              if (row.kind === "session") {
                return (
                  <SessionRowView
                    key={row.key}
                    row={row}
                    layout={layout}
                    top={top}
                    height={height}
                    now={now}
                    renaming={row.family.root.id === renamingRootId}
                    confirming={row.family.root.id === confirmDeleteRootId}
                    menuOpen={menuOpen}
                    handlers={handlersRef}
                  />
                );
              }
              if (row.kind === "archive-group") {
                return <ArchiveGroupRowView key={row.key} row={row} layout={layout} top={top} height={height} menuOpen={menuOpen} handlers={handlersRef} />;
              }
              if (row.kind === "group") {
                const renaming = row.project.key === renamingProjectKey;
                return (
                  <GroupRowView
                    key={row.key}
                    row={row}
                    layout={layout}
                    top={top}
                    height={height}
                    menuOpen={menuOpen}
                    renaming={renaming}
                    // A header that is a name field is no handle to drag.
                    canDrag={canMoveGroups && !renaming && groupsPerBand[row.project.pinned ? "pinned" : "other"] > 1}
                    dragPhase={dragView?.projectKey === row.project.key ? dragView.phase : null}
                    drag={groupDrag.handlers}
                    handlers={handlersRef}
                  />
                );
              }
              return <PlainRowView key={row.key} row={row} top={top} height={height} handlers={handlersRef} onMoreAction={handleMoreAction} />;
            })}
            {dragSource && (
              // Ghost highlight over the measured row band being dragged.
              <div
                className="session-tree-drag-source absolute pointer-events-none rounded-md bg-sidebar/55 left-(--session-tree-inset-left) right-(--session-tree-inset-right)"
                aria-hidden="true"
                style={{ top: dragSource.top, height: dragSource.bottom - dragSource.top }}
              />
            )}
            {/* Drop indicator between rows: the measured Y of the insertion point. */}
            {dropLineY !== null && (
              <div
                className="session-tree-drop-line absolute -mt-px h-[2px] rounded-[1px] bg-accent left-(--session-tree-inset-left) right-(--session-tree-inset-right) transition-[top] duration-100 ease-out before:absolute before:-top-0.5 before:left-0 before:size-1.5 before:rounded-full before:bg-accent before:content-['']"
                aria-hidden="true"
                style={{ top: dropLineY }}
              />
            )}
          </div>
        )}
      </div>
      {ghostProject && (
        // A one-line pill, shorter than a header, so it fits above or below
        // the pointer and the drop line without covering either. Outside the
        // scroll box (useGroupDrag places it by its measured height).
        <div
          ref={ghostRef}
          className="session-tree-drag-ghost pointer-events-none absolute z-[2] flex h-[22px] max-w-[70%] min-w-0 items-center rounded-md border border-border bg-sidebar px-2.5 text-xs font-semibold whitespace-nowrap text-foreground opacity-90 shadow-sm"
          aria-hidden="true"
        >
          <span className="session-tree-group-name min-w-0 truncate">{ghostProject.name}</span>
        </div>
      )}
    </div>
  );
}

type Handlers = RefObject<SessionTreeProps>;

/**
 * Rows are laid out edge to edge by the virtualizer's offsets (the canvas height
 * is their sum), so the visual box is inset a pixel at the top and bottom:
 * adjacent rows read as two rows instead of one filled block.
 */
const ROW_VERTICAL_INSET = 1;

function rowStyle(top: number, height: number) {
  return {
    top: top + ROW_VERTICAL_INSET,
    height: Math.max(0, height - ROW_VERTICAL_INSET * 2),
  };
}

const SessionRowView = memo(function SessionRowView({
  row,
  layout,
  top,
  height,
  now,
  renaming,
  confirming,
  menuOpen,
  handlers,
}: {
  row: SessionRow;
  layout: SidebarLayout;
  top: number;
  height: number;
  now: number;
  renaming: boolean;
  confirming: boolean;
  menuOpen: boolean;
  handlers: Handlers;
}) {
  const { locale, t } = useI18n();
  const { family, context, status } = row;
  const root = family.root;
  const title = sessionRowTitle(root);
  const nowDate = new Date(now);
  const isMobile = layout === "mobile";
  // Hover and selection are a rounded box inset from the sidebar's edges,
  // never a full-width band: the rows end 6px in, or on the tree's classic
  // scrollbar's gutter where that is further in (the scroll box's vars).
  const className = [
    "session-tree-row session-tree-session group/tree-row",
    ROW_INSETS,
    "flex min-w-0 items-center overflow-hidden rounded-md",
    // A delete confirmation's row is not clickable, and its red frame stands
    // alone (the selected row's accent bar yields to it).
    confirming
      ? "is-confirming cursor-default gap-1.5 bg-destructive/10 ring-1 ring-destructive/30 ring-inset"
      : "cursor-pointer hover:bg-accent",
    // A family's child (in its group, or the archive) sits a step lower and
    // deeper than a pinned row, under its group's name.
    context === "pinned" ? "pl-5" : "is-child pl-8",
    "pr-1",
    status.selected ? "is-selected bg-accent" : "",
    status.running ? "is-running" : "",
    context === "archive" ? "is-archived" : "",
    menuOpen ? "is-menu-open" : "",
    renaming ? "is-renaming" : "",
    // The selected row's mark: a 3px accent bar on the box's left edge,
    // before the chevron column, inset from the row's rounded corners (7px
    // of a 34px row, 12px of a phone's 40px).
    status.selected && !confirming
      ? isMobile
        ? "before:absolute before:bottom-3 before:left-0 before:top-3 before:w-[3px] before:rounded-r-[2px] before:bg-accent before:content-['']"
        : "before:absolute before:bottom-[7px] before:left-0 before:top-[7px] before:w-[3px] before:rounded-r-[2px] before:bg-accent before:content-['']"
      : "",
  ].filter(Boolean).join(" ");

  if (confirming) {
    const shortTitle = title.slice(0, DELETE_TITLE_MAX) + (title.length > DELETE_TITLE_MAX ? "…" : "");
    return (
      <div
        className={className}
        style={rowStyle(top, height)}
        data-row-key={row.key}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || isImeKey(event)) return;
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onDeleteCancel();
        }}
      >
        <DeleteConfirm
          label={t("sidebar.deleteSession", { title: shortTitle })}
          deleteLabel={t("sidebar.delete")}
          cancelLabel={t("sidebar.cancel")}
          onConfirm={(event) => {
            event.stopPropagation();
            handlers.current.onDeleteConfirm(family, event);
          }}
          onCancel={(event) => {
            event.stopPropagation();
            handlers.current.onDeleteCancel();
          }}
        />
      </div>
    );
  }

  if (renaming) {
    return (
      <div className={className} style={rowStyle(top, height)} data-row-key={row.key}>
        <RenameInput
          initialValue={title}
          label={t("sidebar.rename")}
          mobile={isMobile}
          onCommit={(value) => handlers.current.onRenameCommit(family, value)}
          onCancel={() => handlers.current.onRenameCancel()}
        />
      </div>
    );
  }

  const branch = root.isWorktree && root.branch ? root.branch : null;
  // A fork named by the sidebar's Fork: the ellipsis cuts its title before
  // the suffix that tells it from its source, never the suffix.
  const forkTitle = root.name && root.relation?.kind === "fork" ? splitForkSuffix(root.name) : null;
  const details = root.detailsPending ? "…" : t("sidebar.messagesCount", { count: root.messageCount });
  const tooltip = `${title}\n${details} · ${formatRelativeTime(root.modified, locale, nowDate)}${branch ? ` · ⑂ ${branch}` : ""}`;

  // 运行状态是行首的那颗点（在行缩进里，标题之前）：等待输入琥珀色，其次运行中绿色，
  // 再次未读强调色。它不占标题的位置。右侧只说时间，固定行用项目名代替。
  // 归档行显示的是家族的修改时间而不是归档时间：今天归档的旧会话不该读作“刚刚”
  // （#1351）。
  let statusDot: ReactNode = null;
  let statusTitle: string | undefined;
  if (status.awaiting) {
    // 这轮停在一个只有用户能答的对话框上：未读点的形状 + 警告琥珀色（规则在
    // app/sidebar.css，Debug 面板在树外渲染同一个 span）。
    statusDot = <span className="session-tree-awaiting" role="img" aria-label={t("sidebar.agentAwaitingInput")} />;
    statusTitle = t("sidebar.agentAwaitingInput");
  } else if (status.running) {
    // 草稿的绿色呼吸点，与未读点同一套光环。
    statusDot = (
      <span
        className="relative inline-block size-[7px] shrink-0 rounded-full bg-success after:absolute after:-inset-[3px] after:animate-[session-tree-status-pulse_1.6s_ease-in-out_infinite] after:rounded-full after:border-[1.4px] after:border-success after:opacity-35 motion-reduce:after:animate-none"
        role="img"
        aria-label={t("sidebar.agentRunning")}
      />
    );
    statusTitle = t("sidebar.agentRunning");
  } else if (status.unread) {
    statusDot = (
      <span
        className="relative inline-block size-[7px] shrink-0 rounded-full bg-status-unread after:absolute after:-inset-[3px] after:animate-[session-tree-status-pulse_1.6s_ease-in-out_infinite] after:rounded-full after:border-[1.4px] after:border-status-unread after:opacity-35 motion-reduce:after:animate-none"
        role="img"
        aria-label={t("sidebar.newSessionActivity")}
      />
    );
    statusTitle = t("sidebar.newActivity");
  }

  // 行首的状态点：横向与分组标题的展开箭头中心线附近（箭头中心 10.5px；
  // 点 7px，left 12px 即中心 15.5px——用户目视定值，右移让开行首），
  // 固定行与会话行共用一个值。
  const dotLeft = "left-[12px]";
  const meta = context === "pinned"
    ? <span className="inline-block max-w-[70px] truncate align-bottom">{row.project.name}</span>
    : formatShortRelativeTime(family.latestModified, locale, nowDate);

  // Archive (or restore) one click away: desktop only, never for a running
  // family, which would come straight back.
  const quickAction = layout === "desktop" && (context === "archive" || !status.running);
  // 动作按钮占着时间的格子（手机上两者并存；行首的状态点不受影响），键盘通过行内任一元素的
  // :focus-visible 唤出。
  const actionVisibility = isMobile
    ? "flex"
    : "hidden group-hover/tree-row:flex group-has-[:focus-visible]/tree-row:flex";
  const moreVisibility = isMobile || menuOpen || status.selected
    ? "flex"
    : // Touch screens wider than a phone have no hover: keep ⋯ reachable.
      "hidden group-hover/tree-row:flex group-has-[:focus-visible]/tree-row:flex [@media(hover:none)]:flex";
  const metaVisibility = isMobile
    ? ""
    : "group-hover/tree-row:hidden group-has-[:focus-visible]/tree-row:hidden";

  const titleClass = [
    "session-tree-title min-w-0 flex-1 truncate",
    "text-foreground",
    // Titles are the content: the item's 13px, a family's child a step
    // smaller (12.5px) and deeper.
    "text-[13px]",
    // The selected one a little heavier.
    status.selected ? "font-medium" : "",
    context === "archive" ? "text-muted-foreground" : "",
  ].filter(Boolean).join(" ");

  const mainContent = (
    <>
      {forkTitle ? (
        // A Fork's copy: the ellipsis cuts its title before the suffix that
        // tells it from its source ("… · 3f9a"), never the suffix.
        <span className={`${titleClass} has-fork-suffix flex`}>
          <span className="min-w-0 truncate">{forkTitle.base}</span>
          <span className="shrink-0 whitespace-pre">{forkTitle.suffix}</span>
        </span>
      ) : (
        <span className={titleClass}>{title}</span>
      )}
      {branch && (
        // A worktree's branch: icon only — the name crowded the row and the
        // title's ellipsis; the tooltip (and title=) carries the branch name.
        <span
          className="shrink-0 text-muted-foreground"
          title={branch}
          role="img"
          aria-label={t("sidebar.worktreeBranch", { branch })}
        >
          <GitBranchIcon size={10} className="inline-block -translate-y-px" />
        </span>
      )}
      <span
        className={`flex min-w-[26px] shrink-0 items-center justify-end text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap${metaVisibility ? ` ${metaVisibility}` : ""}`}
      >
        {meta}
      </span>
    </>
  );

  return (
    <div
      className={className}
      style={rowStyle(top, height)}
      data-row-key={row.key}
      onClick={() => handlers.current.onSelectFamily(family)}
      onContextMenu={(event) => handlers.current.onRowContextMenu(row, event)}
    >
      {statusDot && (
        // 行首的状态点：落在行的缩进末端、标题前，不占标题的宽度，子会话的点
        // 也不跟着缩进漂移。垂直方向比行中线高 1px，压住笔画的那点视觉重量。
        <span
          className={`absolute top-[calc(50%-1px)] ${dotLeft} z-10 -translate-y-1/2`}
          title={statusTitle}
        >
          {statusDot}
        </span>
      )}
      {status.transient ? (
        // No file yet: a link would open a session no other tab can load.
        <Button
          type="button"
          variant="ghost"
          className="session-tree-main h-full min-w-0 grow basis-0 justify-start gap-1.5 rounded-md p-0 text-left font-normal hover:bg-transparent hover:text-inherit dark:hover:bg-transparent"
          title={tooltip}
          aria-current={status.selected ? "true" : undefined}
        >
          {mainContent}
        </Button>
      ) : (
        // A real link, so middle-click, Ctrl/Cmd-click and the browser's own
        // gestures open the session in another tab. A plain click (or Enter)
        // stays here and selects it as before; never `target`, which would
        // send plain clicks away too. It looks exactly like the button above.
        <a
          className="session-tree-main flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          href={sessionDeepLink(root.id)}
          title={tooltip}
          aria-current={status.selected ? "true" : undefined}
          onClick={(event) => {
            // The row's handler must not select it again, nor on a modified click.
            event.stopPropagation();
            if (!isPlainActivation(event)) return;
            event.preventDefault();
            handlers.current.onSelectFamily(family);
          }}
        >
          {mainContent}
        </a>
      )}
      {!status.transient && (
        <span className="session-tree-actions flex shrink-0 items-center">
          {quickAction && (context === "archive" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={`session-tree-action session-tree-quick-action ml-0.5 rounded-md hover:bg-accent dark:hover:bg-accent ${actionVisibility}${isMobile ? " size-8" : ""}`}
              aria-label={t("sidebar.restore")}
              title={t("sidebar.restore")}
              onClick={(event) => {
                event.stopPropagation();
                handlers.current.onRestoreFamily(family);
              }}
            >
              <ArchiveRestoreIcon size={13} className="size-[13px]" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={`session-tree-action session-tree-quick-action ml-0.5 rounded-md hover:bg-accent dark:hover:bg-accent ${actionVisibility}${isMobile ? " size-8" : ""}`}
              aria-label={t("sidebar.archive")}
              title={t("sidebar.archive")}
              onClick={(event) => {
                event.stopPropagation();
                handlers.current.onArchiveFamily(family);
              }}
            >
              <ArchiveIcon size={13} className="size-[13px]" />
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={`session-tree-action session-tree-more-action ml-0.5 rounded-md hover:bg-accent dark:hover:bg-accent ${moreVisibility}${isMobile ? " size-8" : ""}${menuOpen ? " is-active bg-accent text-accent-foreground" : ""}`}
            aria-label={t("sidebar.moreActions")}
            title={t("sidebar.moreActions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              const button = event.currentTarget;
              handlers.current.onOpenRowMenu(row, anchorOf(button), button);
            }}
          >
            <MoreHorizontalIcon size={14} className="size-3.5" />
          </Button>
        </span>
      )}
    </div>
  );
});

function RenameInput({
  initialValue,
  label,
  maxLength,
  mobile,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  label: string;
  maxLength?: number;
  /** The phone's field is a step taller (its inputs are forced to 16px there). */
  mobile?: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter or Escape ends the rename; the blur that follows when the input
  // goes away must not commit a second time (or after a cancel).
  const doneRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commit = (text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(text);
  };

  return (
    <Input
      ref={inputRef}
      className={`session-tree-rename min-w-0 flex-1${mobile ? " h-8" : " h-7"} rounded-md border-accent bg-background px-2 [user-select:text] [-webkit-user-select:text]`}
      value={value}
      aria-label={label}
      maxLength={maxLength}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (isImeKey(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (doneRef.current) return;
          doneRef.current = true;
          onCancel();
        }
      }}
    />
  );
}

/** A row's delete confirmation; also a side chat's in the Agents switcher (AgentSessionPanel). */
export function DeleteConfirm({
  label,
  deleteLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  label: string;
  deleteLabel: string;
  cancelLabel: string;
  onConfirm: (event: ReactMouseEvent) => void;
  onCancel: (event: ReactMouseEvent) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Opened from a menu, focus has nowhere to be (the menu and the row's ⋯ are
  // gone): put it on the safe choice so the keyboard can answer.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) cancelRef.current?.focus();
  }, []);

  return (
    <>
      <span className="session-tree-confirm-text min-w-0 flex-1 truncate text-xs text-foreground">{label}</span>
      <Button type="button" variant="destructive" size="xs" className="session-tree-confirm-delete shrink-0" onClick={onConfirm}>
        <Trash2Icon size={12} className="size-3" />
        {deleteLabel}
      </Button>
      <Button ref={cancelRef} type="button" variant="outline" size="xs" className="session-tree-confirm-cancel shrink-0 shadow-none" onClick={onCancel}>
        {cancelLabel}
      </Button>
    </>
  );
}

/**
 * Running dot + count, amber dot + count (awaiting input) and dot + count; the
 * label carries the count for screen readers. Also a project's badge in the
 * project menus (ProjectWorktreePicker), which counts no awaiting. `className`
 * adds where it shows: a folded group header's hides it while the header's
 * actions show (a phone keeps both).
 */
export function ActivitySummary({ running, awaiting = 0, unread, className, t }: { running: number; awaiting?: number; unread: number; className?: string; t: (key: string) => string }) {
  if (running === 0 && awaiting === 0 && unread === 0) return null;
  return (
    <span className={`session-tree-summary ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground${className ? ` ${className}` : ""}`}>
      {running > 0 && (
        <span
          className="session-tree-summary-running inline-flex items-center gap-[3px]"
          role="img"
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${running})`}
        >
          <span className="session-tree-summary-dot size-1.5 shrink-0 rounded-full bg-status-unread" />
          {running}
        </span>
      )}
      {awaiting > 0 && (
        <span
          className="session-tree-summary-awaiting inline-flex items-center gap-[3px]"
          role="img"
          title={t("sidebar.agentAwaitingInput")}
          aria-label={`${t("sidebar.agentAwaitingInput")} (${awaiting})`}
        >
          <span className="session-tree-summary-dot size-1.5 shrink-0 rounded-full bg-status-awaiting" />
          {awaiting}
        </span>
      )}
      {unread > 0 && (
        <span
          className="session-tree-summary-unread inline-flex items-center gap-[3px]"
          role="img"
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${unread})`}
        >
          <span className="session-tree-summary-dot size-1.5 shrink-0 rounded-full bg-status-unread" />
          {unread}
        </span>
      )}
    </span>
  );
}

const GroupRowView = memo(function GroupRowView({
  row,
  layout,
  top,
  height,
  menuOpen,
  renaming,
  canDrag,
  dragPhase,
  drag,
  handlers,
}: {
  row: Extract<SidebarRow, { kind: "group" }>;
  layout: SidebarLayout;
  top: number;
  height: number;
  /** The group's ⋯ menu is open. */
  menuOpen: boolean;
  /** The header is a field for the project's display name. */
  renaming: boolean;
  /** Its band has another group to move it past. */
  canDrag: boolean;
  /** This group is picked up by a long-press, or being dragged. */
  dragPhase: "armed" | "dragging" | null;
  drag: GroupDragHandlers;
  handlers: Handlers;
}) {
  const { t } = useI18n();
  const { project, expanded } = row;
  const rowRef = useRef<HTMLDivElement>(null);
  const isMobile = layout === "mobile";
  // A section header over its rows, not one more row: the same inset box as
  // the session rows, "+"/⋯ replacing the folded summary on hover. It can be
  // dragged (hooks/useGroupDrag.ts): a long-press on a phone must not select
  // its text or open the iOS callout. touch-action stays as it is, so a
  // swipe that starts on a header still scrolls the list.
  const className = [
    "session-tree-row session-tree-group group/tree-row",
    ROW_INSETS,
    "flex min-w-0 select-none items-center gap-0.5 rounded-md pr-1 [-webkit-touch-callout:none] hover:bg-accent",
    project.current ? "is-current" : "",
    menuOpen ? "is-active" : "",
    // Picked up by a long-press, before the finger moves.
    dragPhase === "armed" ? "is-drag-armed bg-accent shadow-sm" : "",
    // The project's name field (its menu's Rename…) in place of the header.
    renaming ? "is-renaming pl-1" : "",
  ].filter(Boolean).join(" ");

  // Once a long-press has picked the group up, the finger's moves must not
  // scroll the list. That takes a touchmove listener that is not passive
  // (React's onTouchMove is) and is in place before the touch starts: added
  // later, the browser has already taken the gesture for a scroll. It sits on
  // the header alone, so only touches that start on one wait for it.
  useEffect(() => {
    const element = rowRef.current;
    if (!canDrag || !element) return;
    const onTouchMove = (event: TouchEvent) => drag.onTouchMove(event);
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => element.removeEventListener("touchmove", onTouchMove);
  }, [canDrag, drag]);

  // Seeded with the name shown. The field counts UTF-16 units, the server
  // code points: whatever fits the field, the server takes.
  if (renaming) {
    return (
      <div ref={rowRef} className={className} style={rowStyle(top, height)} data-row-key={row.key}>
        <RenameInput
          initialValue={project.name}
          label={t("sidebar.projectName")}
          maxLength={MAX_PROJECT_NAME_LENGTH}
          mobile={isMobile}
          onCommit={(value) => handlers.current.onRenameProjectCommit(project, value)}
          onCancel={() => handlers.current.onRenameProjectCancel()}
        />
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className={className}
      style={rowStyle(top, height)}
      data-row-key={row.key}
      onPointerDown={canDrag ? (event) => drag.onPointerDown(event, project.key) : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        className={`session-tree-group-toggle h-full min-w-0 flex-1 justify-start gap-[5px] rounded-md bg-transparent py-0 pl-1 pr-0 text-left text-sm font-normal whitespace-nowrap hover:bg-transparent ${project.current ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        aria-expanded={expanded}
        title={project.root}
        onClick={(event) => handlers.current.onToggleGroup(project.key, event.altKey)}
      >
        {/* A section header, not one more row: the chevron leads in a
            column of its own, so the name starts where the session titles
            below it do and every header's chevron lines up. */}
        <ChevronRightIcon size={13} strokeWidth={3} className={`size-[13px] shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none${expanded ? " rotate-90" : ""}`} />
        <span className="session-tree-group-name min-w-0 truncate">{project.name}</span>
        {project.pinned && <PinIcon size={10} className="ml-0.5 size-2.5 shrink-0 text-muted-foreground" role="img" aria-label={t("sidebar.pinnedProject")} aria-hidden={false} />}
        {!expanded && (
          <ActivitySummary
            running={row.running}
            awaiting={row.awaiting}
            unread={row.unread}
            className={isMobile ? "" : "group-hover/tree-row:hidden group-has-[:focus-visible]/tree-row:hidden"}
            t={t}
          />
        )}
      </Button>
      <span className={`session-tree-group-actions flex flex-none items-center gap-0.5${isMobile ? "" : " hidden group-hover/tree-row:flex group-has-[:focus-visible]/tree-row:flex"}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={`session-tree-group-action cursor-pointer${isMobile ? " size-8" : " size-5"} rounded-md hover:bg-accent dark:hover:bg-accent`}
          aria-label={t("sidebar.newSessionInProject", { name: project.name })}
          title={t("sidebar.newSessionInProject", { name: project.name })}
          onClick={(event) => {
            event.stopPropagation();
            handlers.current.onGroupNew(project);
          }}
        >
          <PlusIcon size={13} className="size-[13px]" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={`session-tree-group-action cursor-pointer${isMobile ? " size-8" : " size-5"} rounded-md hover:bg-accent dark:hover:bg-accent${menuOpen ? " is-active bg-accent text-accent-foreground" : ""}`}
          aria-label={t("sidebar.projectActions", { name: project.name })}
          title={t("sidebar.projectActions", { name: project.name })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            handlers.current.onGroupMenu(project, event.currentTarget);
          }}
        >
          <MoreHorizontalIcon size={13} className="size-[13px]" />
        </Button>
      </span>
    </div>
  );
});

/** The rows with at most one control: section headers, "show more", footer links. */
const PlainRowView = memo(function PlainRowView({
  row,
  top,
  height,
  handlers,
  onMoreAction,
}: {
  row: Exclude<SidebarRow, { kind: "session" | "group" | "archive-group" | "spacer" }>;
  top: number;
  height: number;
  handlers: Handlers;
  onMoreAction: (rowKey: string, key: string, action: "more" | "less", button: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const style = rowStyle(top, height);

  switch (row.kind) {
    case "pinned-header":
      // A section label, not a project: its chevron in the groups' chevron
      // column, the label where the session titles start, small capitals.
      return (
        <div className="session-tree-row session-tree-pinned-header left-0 right-0 flex min-w-0 items-stretch" style={style} data-row-key={row.key}>
          <Button
            type="button"
            variant="ghost"
            className="session-tree-pinned-toggle h-auto min-w-0 flex-1 items-center justify-start gap-[5px] rounded-md bg-transparent py-0 pl-1 pr-2 text-left text-[13px] whitespace-nowrap text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-expanded={!row.collapsed}
            onClick={() => handlers.current.onTogglePinned()}
          >
            <ChevronRightIcon size={13} strokeWidth={3} className={`size-[13px] shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none${row.collapsed ? "" : " rotate-90"}`} />
            <span className="session-tree-pinned-label min-w-0 truncate font-semibold tracking-[0.05em] uppercase">{t("sidebar.pinned")}</span>
            <span className="session-tree-pinned-count font-normal text-muted-foreground">· {row.count}</span>
            {row.collapsed && row.running > 0 && (
              <span
                className="session-tree-pinned-dot is-running ml-0.5 size-1.5 shrink-0 rounded-full bg-status-unread"
                role="img"
                title={t("sidebar.agentRunning")}
                aria-label={`${t("sidebar.agentRunning")} (${row.running})`}
              />
            )}
            {row.collapsed && row.awaiting > 0 && (
              <span
                className="session-tree-pinned-dot is-awaiting ml-0.5 size-1.5 shrink-0 rounded-full bg-status-awaiting"
                role="img"
                title={t("sidebar.agentAwaitingInput")}
                aria-label={`${t("sidebar.agentAwaitingInput")} (${row.awaiting})`}
              />
            )}
            {row.collapsed && row.unread > 0 && (
              <span
                className="session-tree-pinned-dot is-unread ml-0.5 size-1.5 shrink-0 rounded-full bg-status-unread"
                role="img"
                title={t("sidebar.newSessionActivity")}
                aria-label={`${t("sidebar.newSessionActivity")} (${row.unread})`}
              />
            )}
          </Button>
        </div>
      );
    case "pinned-more":
    case "group-more": {
      const moreKey = row.kind === "pinned-more" ? PINNED_MORE_KEY : row.projectKey;
      // "Show more · N" and, once more is shown, "Show less" side by side. A
      // lone button takes the whole row; on a narrow sidebar "show more"
      // gives way so "Show less" is never clipped.
      const lone = (row.hidden > 0 ? 1 : 0) + (row.canShowLess ? 1 : 0) === 1;
      const toggleClass = (loneButton: boolean, marginLeft = false) => [
        "session-tree-more-toggle h-full min-w-0 truncate rounded-md bg-transparent px-0 py-0 text-left text-[13px] whitespace-nowrap text-muted-foreground hover:bg-transparent hover:text-foreground",
        loneButton ? "flex-1" : "shrink",
        marginLeft ? "ml-[14px]" : "",
      ].filter(Boolean).join(" ");
      return (
        <div className={`session-tree-row session-tree-more left-0 right-0 flex min-w-0 items-center ${TEXT_COLUMN} pr-1`} style={style} data-row-key={row.key}>
          {row.hidden > 0 && (
            <Button
              type="button"
              variant="ghost"
              className={toggleClass(lone)}
              data-more-action="more"
              onClick={(event) => onMoreAction(row.key, moreKey, "more", event.currentTarget)}
            >
              {t("sidebar.showMore", { count: row.hidden })}
            </Button>
          )}
          {row.canShowLess && (
            <Button
              type="button"
              variant="ghost"
              className={toggleClass(lone || row.hidden === 0, row.hidden > 0)}
              data-more-action="less"
              onClick={(event) => onMoreAction(row.key, moreKey, "less", event.currentTarget)}
            >
              {t("sidebar.showLess")}
            </Button>
          )}
        </div>
      );
    }
    case "group-empty":
      // "No sessions yet" and an unpinned group's "Pin to keep" side by side.
      return (
        <div className={`session-tree-row session-tree-group-empty left-0 right-0 flex min-w-0 items-center ${TEXT_COLUMN} pr-1`} style={style} data-row-key={row.key}>
          <span className="session-tree-group-empty-label min-w-0 flex-[0_1_auto] truncate text-[13px] text-muted-foreground">{t("sidebar.noLiveSessions")}</span>
          {!row.project.pinned && (
            <Button
              type="button"
              variant="ghost"
              className="session-tree-more-toggle ml-[14px] h-full min-w-0 flex-none truncate rounded-md bg-transparent px-0 py-0 text-left text-[13px] whitespace-nowrap text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => handlers.current.onPinEmptyGroup(row.project)}
            >
              {t("sidebar.pinToKeep")}
            </Button>
          )}
        </div>
      );
    case "footer-open":
      // Footer links: open another project, the archive. Their 12px icons in
      // the chevron column, their labels in the text column.
      return (
        <div className={`session-tree-row session-tree-footer flex min-w-0 items-stretch ${ROW_INSETS}`} style={style} data-row-key={row.key}>
          <Button
            type="button"
            variant="ghost"
            className="session-tree-footer-button h-full min-w-0 flex-1 items-center justify-start gap-[3px] rounded-md bg-transparent py-0 pl-[7px] pr-1 text-left text-[13px] text-muted-foreground hover:bg-accent dark:hover:bg-accent hover:text-muted-foreground"
            onClick={(event) => handlers.current.onOpenOtherProject(event.currentTarget)}
          >
            <FolderPlusIcon size={12} className="size-3 shrink-0" />
            <span className="session-tree-footer-label min-w-0 flex-1 truncate whitespace-nowrap">{t("sidebar.openOtherProject")}</span>
          </Button>
        </div>
      );
    case "footer-archived":
      return (
        <div className={`session-tree-row session-tree-footer flex min-w-0 items-stretch ${ROW_INSETS}`} style={style} data-row-key={row.key}>
          <Button
            type="button"
            variant="ghost"
            className="session-tree-footer-button h-full min-w-0 flex-1 items-center justify-start gap-[3px] rounded-md bg-transparent py-0 pl-[7px] pr-1 text-left text-[13px] text-muted-foreground hover:bg-accent dark:hover:bg-accent hover:text-muted-foreground"
            onClick={() => handlers.current.onOpenArchive()}
          >
            <ArchiveIcon size={12} className="size-3 shrink-0" />
            <span className="session-tree-footer-label min-w-0 flex-1 truncate whitespace-nowrap">{t("sidebar.archivedCount", { count: row.count })}</span>
          </Button>
        </div>
      );
  }
});

/**
 * An archive view's project header: a main group's header (chevron, name;
 * the current project in `--text`) with its count, and ⋯ for the project's
 * archived sessions. No "+", no pin, no drag: the archive keeps no order.
 */
const ArchiveGroupRowView = memo(function ArchiveGroupRowView({
  row,
  layout,
  top,
  height,
  menuOpen,
  handlers,
}: {
  row: Extract<SidebarRow, { kind: "archive-group" }>;
  layout: SidebarLayout;
  top: number;
  height: number;
  menuOpen: boolean;
  handlers: Handlers;
}) {
  const { t } = useI18n();
  const { project, expanded } = row;
  const className = [
    "session-tree-row session-tree-group session-tree-archive-group group/tree-row",
    ROW_INSETS,
    "flex min-w-0 select-none items-center gap-0.5 rounded-md pr-1 [-webkit-touch-callout:none] hover:bg-accent",
    project.current ? "is-current" : "",
    menuOpen ? "is-active" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={className} style={rowStyle(top, height)} data-row-key={row.key}>
      <Button
        type="button"
        variant="ghost"
        className={`session-tree-group-toggle h-full min-w-0 flex-1 justify-start gap-[5px] rounded-md bg-transparent py-0 pl-1 pr-0 text-left text-sm font-normal whitespace-nowrap hover:bg-transparent ${project.current ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        aria-expanded={expanded}
        title={project.root}
        onClick={(event) => handlers.current.onToggleArchiveGroup?.(project.key, event.altKey)}
      >
        <ChevronRightIcon size={13} strokeWidth={3} className={`size-[13px] shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none${expanded ? " rotate-90" : ""}`} />
        <span className="session-tree-group-name min-w-0 truncate">{project.name}</span>
        <span className="session-tree-archive-group-count ml-0.5 shrink-0 font-normal text-muted-foreground">· {row.count}</span>
      </Button>
      <span className={`session-tree-group-actions flex flex-none items-center gap-0.5${layout === "mobile" ? "" : " hidden group-hover/tree-row:flex group-has-[:focus-visible]/tree-row:flex"}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={`session-tree-group-action cursor-pointer${layout === "mobile" ? " size-8" : " size-5"} rounded-md hover:bg-accent dark:hover:bg-accent${menuOpen ? " is-active bg-accent text-accent-foreground" : ""}`}
          aria-label={t("sidebar.archivedProjectActions", { name: project.name })}
          title={t("sidebar.archivedProjectActions", { name: project.name })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            handlers.current.onArchiveGroupMenu?.(project, event.currentTarget);
          }}
        >
          <MoreHorizontalIcon size={13} className="size-[13px]" />
        </Button>
      </span>
    </div>
  );
});
