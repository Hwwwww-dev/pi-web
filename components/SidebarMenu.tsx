"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type SyntheticEvent } from "react";
import { CheckIcon } from "lucide-react";
import { Dialog as DialogPrimitive, DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The session sidebar's popup menu: a row's ⋯ or right-click menu, a project
 * group's menu; also the project and worktree menus of the files tab and of
 * the bar above a fresh composer (components/ProjectWorktreePicker.tsx). On a
 * desktop it is a small menu placed at a point or beside a button; on a phone
 * (`sheet`) a bottom sheet over its own backdrop. Either way it is portaled to `document.body`: the mobile sidebar
 * drawer moves with `transform`, which would make a `position: fixed` menu
 * inside it fixed to the 280px drawer instead of the screen.
 *
 * What it shows and whether it is open come from the parent, which keeps
 * them above the virtualized rows so a row scrolled out of view does not
 * take its open menu with it; the menu keeps only its filter field's text.
 *
 * The shell is Radix: a DropdownMenu on a desktop, a Dialog on a phone.
 * Their trigger is a hidden zero-size element parked at the anchor
 * coordinates — never the real opener button (whose next click must close
 * the menu, not open it again) and never inside the virtualized rows. Radix
 * owns the placement with its collision handling, the Escape and
 * pointer-down-outside dismissal (its Escape listener runs in the document's
 * capture phase and marks the event handled, so the window-level Escape that
 * stops a running agent leaves the menu alone), and the focus scope into and
 * out of the menu. The items stay plain buttons with the sidebar's own
 * keyboard model: Radix's menu collection cannot be used here, because its
 * items must be its own `Item` components while these keep the old markup
 * (and with it the one-letter shortcuts and the arrow roving Radix has no
 * hook for). That keydown lives on the content; Radix's own Tab swallow
 * turns a desktop menu into a focus trap, with a way out along the form
 * fields of a swapped-in body. The old hand-written CSS (app/sidebar-menu.css,
 * retired) is folded into these class names; the old classes stay on as
 * stable markup markers next to the utilities.
 */

/** What an item's `onSelect` is told about the activation. */
export interface SidebarMenuSelectEvent {
  /** Shift was held (click, Enter or the item's shortcut letter): Delete skips its confirmation. */
  shiftKey: boolean;
  /**
   * Leaves the menu open instead of closing it after `onSelect`: for an item
   * that swaps the menu's body, such as "New worktree…" turning the worktree
   * menu into a small form.
   */
  keepOpen(): void;
}

/** An icon button at the end of an item's row with an action of its own (a worktree's remove). */
export interface SidebarMenuSecondaryAction {
  /** Its accessible name and tooltip. */
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: (event: SidebarMenuSelectEvent) => void;
}

export type SidebarMenuItem =
  | {
      type: "item";
      id: string;
      label: string;
      icon?: ReactNode;
      /** One letter that activates the item while the menu has focus. */
      shortcut?: string;
      /** Right-aligned hint shown instead of the shortcut (a worktree's "main"). */
      note?: string;
      /** Tooltip: what the label shortens (a project's full path). */
      title?: string;
      /** A choice: shows a check mark (true) or an empty slot (false) instead of `icon`. */
      checked?: boolean;
      mono?: boolean;
      /** A path (or a branch): cut at its left, where it differs least. */
      path?: boolean;
      danger?: boolean;
      disabled?: boolean;
      /** Shown on the right of a disabled item, in place of its shortcut. */
      disabledReason?: string;
      /** Shown before the note: a project's running and unread counts. */
      badge?: ReactNode;
      /** Arrow keys reach it right after its item. */
      secondary?: SidebarMenuSecondaryAction;
      onSelect: (event: SidebarMenuSelectEvent) => void;
    }
  | { type: "separator"; id: string }
  | { type: "header"; id: string; label: string }
  /** Shown as given in the item's place (a classic menu's confirmation row); its buttons mark themselves as items. */
  | { type: "custom"; id: string; content: ReactNode };

export type SidebarMenuAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; rect: { left: number; top: number; right: number; bottom: number }; align: "start" | "end" };

export type SidebarMenuCloseReason = "escape" | "outside" | "select" | "cancel";

/**
 * A field above the items that narrows the menu's choices (the items with
 * `checked`) by label, note and title, shown once there are
 * `SIDEBAR_MENU_FILTER_MIN_CHOICES` of them. Other items (an action such as
 * "New worktree…") always show.
 */
export interface SidebarMenuFilter {
  placeholder: string;
  /** Shown when no choice matches. */
  emptyLabel: string;
  /** Choices needed for the field, if not `SIDEBAR_MENU_FILTER_MIN_CHOICES` (a classic project menu's 9, as on main). */
  minChoices?: number;
}

export const SIDEBAR_MENU_FILTER_MIN_CHOICES = 8;

export interface SidebarMenuProps {
  open: boolean;
  anchor: SidebarMenuAnchor | null;
  /** Render as a bottom sheet with its own backdrop instead of the anchored dropdown. */
  sheet?: boolean;
  ariaLabel: string;
  /** The sheet's heading (one line, ellipsis). */
  title?: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** A custom body (a small form) instead of `items`. */
  children?: ReactNode;
  /** The sheet's Cancel button. */
  cancelLabel: string;
  /**
   * The sheet's Cancel takes focus when the menu opens or its body changes:
   * for a question whose other answer discards something (force-removing a
   * checkout), so Enter must not give it. On a desktop the body marks its own
   * Cancel instead.
   */
  focusCancel?: boolean;
  /** Tab out of the menu reports "outside". */
  onClose: (reason: SidebarMenuCloseReason) => void;
  /**
   * Focus goes back here on close when it was inside the menu or fell to
   * `<body>`. Read when the menu opens: the parent may let go of it before
   * the menu has closed.
   */
  returnFocusTo?: HTMLElement | null;
  /** Desktop width in px. */
  width?: number;
  /**
   * The files tab's project and worktree menus on a desktop: the look of the
   * dropdowns they were on main, rows divided by lines, 11px.
   */
  classic?: boolean;
  /** Shown after the items, outside the list (a classic worktree menu's "New worktree…" form). */
  footer?: ReactNode;
  /** Focus goes into the menu again whenever this changes (a body swapped in or out). */
  focusKey?: string;
  /**
   * Escape inside a body marked `data-sidebar-menu-esc-to-body` (the
   * "New worktree…" form) goes back to the menu's list instead of closing
   * the menu. Given, the engine keeps the menu open and calls this; without
   * it Escape closes as always.
   */
  onBodyEscape?: () => void;
}

type ActionItem = Extract<SidebarMenuItem, { type: "item" }>;
/** What activating an item or its secondary action needs. */
type MenuAction = Pick<ActionItem, "disabled" | "onSelect">;
/** Where the surface sits: the classic dropdowns of the files tab, or a phone's sheet. */
type SurfaceMode = { classic: boolean; sheet: boolean };

const DEFAULT_MENU_WIDTH = 208;

const ITEM_SELECTOR = "[data-sidebar-menu-item]";
const FILTER_SELECTOR = "[data-sidebar-menu-filter]";
/** The control that takes focus when the menu or its body shows (the filter, a confirmation's Cancel, the sheet's for `focusCancel`). */
const AUTOFOCUS_SELECTOR = "[data-sidebar-menu-autofocus]";
/** A body whose Escape stays in the menu (the "New worktree…" form). */
const BODY_ESC_SELECTOR = "[data-sidebar-menu-esc-to-body]";
const FOCUSABLE_SELECTOR = "button, input, textarea, select, a[href], [tabindex]";
/** A row of the session tree (components/SessionTree.tsx), where most openers sit. */
const ROW_SELECTOR = "[data-row-key]";

/**
 * The enabled item a typed letter activates: its `shortcut`, case-insensitive
 * (Shift+D still means D, and tells Delete to skip its confirmation).
 */
export function findSidebarMenuShortcut(items: readonly SidebarMenuItem[] | undefined, key: string): ActionItem | null {
  if (!items || key.length !== 1) return null;
  const wanted = key.toLowerCase();
  for (const item of items) {
    if (item.type === "item" && !item.disabled && item.shortcut && item.shortcut.toLowerCase() === wanted) return item;
  }
  return null;
}

/**
 * Whether `children` is a custom body. Two conditional bodies side by side
 * arrive as an array (`[false, false]` while neither shows), which is no body.
 */
export function hasCustomMenuBody(children: ReactNode): boolean {
  return Children.toArray(children).length > 0;
}

function isChoice(item: SidebarMenuItem): boolean {
  return item.type === "item" && item.checked !== undefined;
}

/** Whether `items` have enough choices for a filter field. */
export function sidebarMenuHasFilter(items: readonly SidebarMenuItem[] | undefined, minChoices = SIDEBAR_MENU_FILTER_MIN_CHOICES): boolean {
  return (items ?? []).filter(isChoice).length >= minChoices;
}

/**
 * The items a filter `query` leaves: the choices whose label, note or title
 * contains it (case-insensitive), and every item that is not a choice.
 */
export function filterSidebarMenuItems(items: readonly SidebarMenuItem[], query: string): SidebarMenuItem[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...items];
  return items.filter((item) => item.type !== "item" || item.checked === undefined
    || [item.label, item.note, item.title].some((text) => text?.toLowerCase().includes(wanted)));
}

/** A field the keys belong to: arrows move its caret, letters are typed into it. */
function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if ((element as HTMLElement).isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = ((element as HTMLInputElement).type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "reset", "submit", "image", "color", "file"].includes(type);
}

/** Laid out: not display: none itself or inside something that is. Only such an element takes focus. */
function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function isFocusable(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  return isRendered(element);
}

function enabledItems(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(isFocusable);
}

/**
 * What focus goes to when the menu opens: a control marked to take it (a
 * filter field, a confirmation's Cancel), else the first enabled item, else
 * the custom body's first control.
 */
function initialFocusTarget(surface: HTMLElement): HTMLElement | null {
  const marked = Array.from(surface.querySelectorAll<HTMLElement>(AUTOFOCUS_SELECTOR)).find(isFocusable);
  if (marked) return marked;
  const items = enabledItems(surface);
  if (items.length > 0) return items[0];
  const controls = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && isFocusable(element));
  return controls[0] ?? null;
}

/**
 * What focus goes to when the menu's body is swapped while it stays open (the
 * worktree menu's "New worktree…" form under, or in place of, its list): the
 * new body's marked control, not the list's filter field above it — first in
 * the page, it took the focus when the menu opened and would keep it. Back to
 * the list nothing else is marked, so the filter takes it again.
 */
export function menuBodyFocusTarget(surface: HTMLElement): HTMLElement | null {
  const marked = Array.from(surface.querySelectorAll<HTMLElement>(AUTOFOCUS_SELECTOR))
    .filter((element) => !element.matches(FILTER_SELECTOR) && isFocusable(element));
  return marked[0] ?? initialFocusTarget(surface);
}

/**
 * Where focus goes back to when a menu closes: its opener, while it is on the
 * page and rendered. A tree row's ⋯ (a group's + and ⋯ too) shows only while
 * the row is hovered, selected, holds keyboard focus or has its menu open, so
 * once the menu has closed it can be display: none, and focus() on it would
 * do nothing: focus would fall to `<body>`. The first control of the opener's
 * row that can take focus (its main button, a group's toggle) does instead.
 */
export function menuFocusReturnTarget(opener: HTMLElement | null): HTMLElement | null {
  if (!opener || !opener.isConnected) return null;
  if (isRendered(opener)) return opener;
  const row = opener.closest(ROW_SELECTOR);
  if (!row) return null;
  for (const control of Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))) {
    if (control.tabIndex >= 0 && isFocusable(control)) return control;
  }
  return null;
}

/**
 * The opener was pressed while its menu was open: that press closed the menu,
 * and its click must not open it again. Without this a second click on ⋯
 * would close and reopen the menu instead of closing it.
 */
function swallowNextClickOn(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  let timer = 0;
  const stop = () => {
    doc.removeEventListener("click", onClick, true);
    view.clearTimeout(timer);
  };
  function onClick(event: MouseEvent) {
    stop();
    if (!(event.target instanceof Node) || !element.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }
  doc.addEventListener("click", onClick, true);
  timer = view.setTimeout(stop, 1000);
}

/**
 * The portal is outside the sidebar in the page, but React still bubbles its
 * events to the components that rendered it: a click on an item would reach
 * the session row underneath in the component tree and select it. Events stop
 * at the menu.
 */
function stopReactPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function stopContextMenu(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

const isolateEvents = {
  onClick: stopReactPropagation,
  onDoubleClick: stopReactPropagation,
  onMouseDown: stopReactPropagation,
  onMouseUp: stopReactPropagation,
  onPointerDown: stopReactPropagation,
  onPointerUp: stopReactPropagation,
  onKeyDown: stopReactPropagation,
  onKeyUp: stopReactPropagation,
  onFocus: stopReactPropagation,
  onBlur: stopReactPropagation,
  onContextMenu: stopContextMenu,
};

/* ------------------------------------------------------------------ */
/* The retired app/sidebar-menu.css, folded into the class names. The  */
/* old classes stay first as stable markup markers for the tests.      */
/* ------------------------------------------------------------------ */

/** The Delete-confirmation ring: three pixels of half-transparent accent. The bodies' own buttons (a form's Create, a question's Confirm) take it too. */
export const SIDEBAR_MENU_FOCUS_RING = "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const FOCUS_RING = SIDEBAR_MENU_FOCUS_RING;

function menuBoxClassName(classic: boolean): string {
  return [
    "sidebar-menu",
    classic ? "is-classic" : "",
    "z-[400] box-border max-w-[calc(100vw-16px)]",
    "max-h-[min(calc(var(--app-viewport-height,100dvh)-16px),480px,var(--radix-popper-available-height,480px))] overflow-y-auto [overscroll-behavior:contain]",
    "border border-(--border) rounded-(--radius-md) bg-background text-foreground text-xs shadow-(--shadow-md)",
    classic ? "p-0" : "p-1",
    "animate-in fade-in slide-in-from-top-[3px] duration-[120ms] ease-out motion-reduce:animate-none",
    "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[100ms] data-[state=closed]:fill-mode-forwards motion-reduce:data-[state=closed]:animate-none",
    "focus:outline-none",
  ].filter(Boolean).join(" ");
}

function itemClassName(item: ActionItem, mode: SurfaceMode, inRow: boolean): string {
  const choice = item.checked !== undefined;
  const color = item.danger ? "text-destructive"
    : mode.classic ? (item.checked ? "text-foreground" : "text-muted-foreground")
    : "text-foreground";
  const highlight = item.danger
    ? "not-aria-disabled:hover:bg-destructive/10 not-aria-disabled:focus-visible:bg-destructive/10"
    : "not-aria-disabled:hover:bg-accent not-aria-disabled:focus-visible:bg-secondary";
  return [
    "sidebar-menu-item",
    choice ? "is-choice" : "",
    item.danger ? "is-danger" : "",
    item.checked ? "is-checked" : "",
    mode.classic
      ? "flex items-center gap-[7px] h-auto px-2.5 py-2 rounded-xs text-xs leading-[1.35] text-left"
      : mode.sheet
        ? "flex items-center gap-3 h-12 px-4 rounded-none text-base text-left"
        : "flex items-center gap-2 w-full h-7 px-2 rounded-(--radius-sm) text-left",
    mode.classic && choice && !inRow ? "" : "",
    inRow ? "flex-1 min-w-0" : "",
    color,
    highlight,
    "cursor-pointer focus:outline-none",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    !mode.sheet && !mode.classic ? "pointer-coarse:h-10" : "",
    mode.classic ? "pointer-coarse:min-h-[36px]" : "",
  ].filter(Boolean).join(" ");
}

function iconClassName(item: ActionItem, mode: SurfaceMode): string {
  const color = item.danger ? "text-destructive"
    : item.checked ? "text-(--accent)"
    : mode.classic ? "text-inherit" : "text-muted-foreground";
  return [
    "sidebar-menu-icon",
    "inline-flex items-center justify-center shrink-0 grow-0",
    mode.classic ? "basis-[10px] size-[10px] [&_svg]:size-[10px]" : "basis-3.5 size-3.5",
    color,
  ].filter(Boolean).join(" ");
}

function labelClassName(item: ActionItem, mode: SurfaceMode): string {
  const monoSize = mode.sheet ? "text-sm" : mode.classic ? "text-xs" : "text-xs";
  return [
    "sidebar-menu-label",
    item.mono ? "is-mono" : "",
    item.path ? "is-path" : "",
    "flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    item.mono ? `font-mono ${monoSize}` : "",
    item.path ? "[direction:rtl] text-left [&>span]:[unicode-bidi:plaintext]" : "",
  ].filter(Boolean).join(" ");
}

function noteClassName(mode: SurfaceMode): string {
  return [
    "sidebar-menu-note",
    "shrink-0 max-w-[45%] overflow-hidden text-muted-foreground text-ellipsis whitespace-nowrap",
    mode.sheet ? "text-sm" : mode.classic ? "text-xs" : "text-xs",
  ].filter(Boolean).join(" ");
}

function shortcutClassName(sheet: boolean): string {
  return ["sidebar-menu-shortcut", "shrink-0 text-muted-foreground font-mono text-xs", sheet ? "hidden" : ""].filter(Boolean).join(" ");
}

function separatorClassName(mode: SurfaceMode): string {
  return ["sidebar-menu-separator", "h-px bg-(--border)", mode.classic ? "m-0" : mode.sheet ? "my-1" : "my-1 mx-0.5"].filter(Boolean).join(" ");
}

function headerClassName(mode: SurfaceMode): string {
  return [
    "sidebar-menu-header",
    "overflow-hidden text-muted-foreground text-ellipsis whitespace-nowrap",
    mode.sheet ? "px-4 pt-2 pb-1 text-xs" : "px-2 pt-1.5 pb-1 text-xs",
  ].filter(Boolean).join(" ");
}

function filterClassName(mode: SurfaceMode): string {
  return [
    "sidebar-menu-filter",
    "sticky z-[1] bg-background",
    mode.classic
      ? "top-0 m-0 px-2 py-1.5"
      : mode.sheet
        ? "top-[-4px] -mt-1 mb-1 px-4 py-2"
        : "top-[-4px] -mx-1 -mt-1 mb-1 p-1",
  ].filter(Boolean).join(" ");
}

function filterInputClassName(mode: SurfaceMode): string {
  return [
    "sidebar-menu-filter-input",
    "block w-full px-2 box-border border border-(--border) rounded-(--radius-sm) outline-none bg-background text-foreground [user-select:text] [-webkit-user-select:text] focus:border-(--accent) focus-visible:border-(--accent) focus-visible:ring-0",
    // 字号统一由输入框原语（--field-font-size）提供，此处仅保留各模式自身高度。
    mode.classic ? "h-auto py-[5px] font-mono" : mode.sheet ? "h-10" : "h-7",
  ].filter(Boolean).join(" ");
}

function emptyClassName(mode: SurfaceMode): string {
  return [
    "sidebar-menu-empty",
    "text-muted-foreground",
    mode.classic ? "px-2.5 py-2 text-xs" : mode.sheet ? "px-4 py-3 text-base" : "px-2 py-1.5 text-xs",
  ].filter(Boolean).join(" ");
}

function secondaryClassName(secondary: SidebarMenuSecondaryAction, mode: SurfaceMode): string {
  const highlight = secondary.danger
    ? "not-aria-disabled:hover:bg-destructive/10 not-aria-disabled:hover:text-destructive not-aria-disabled:focus-visible:bg-destructive/10 not-aria-disabled:focus-visible:text-destructive"
    : "not-aria-disabled:hover:bg-accent not-aria-disabled:hover:text-foreground not-aria-disabled:focus-visible:bg-secondary not-aria-disabled:focus-visible:text-foreground";
  return [
    "sidebar-menu-secondary",
    secondary.danger ? "is-danger" : "",
    "inline-flex items-center justify-center shrink-0 grow-0 p-0 border-0 bg-transparent cursor-pointer focus:outline-none",
    secondary.danger ? "text-destructive" : "text-muted-foreground",
    mode.classic ? "w-[34px] h-7 mr-1 rounded-(--radius-sm)" : mode.sheet ? "size-12 rounded-none" : "size-7 rounded-(--radius-sm)",
    highlight,
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    !mode.sheet && !mode.classic ? "pointer-coarse:size-10" : "",
  ].filter(Boolean).join(" ");
}

const SHEET_LAYER_CLASS = "sidebar-sheet-layer fixed top-0 right-0 left-0 z-[410] flex flex-col justify-end pointer-events-none focus:outline-none";
const SHEET_BACKDROP_CLASS = "sidebar-sheet-backdrop fixed inset-0 z-[410] bg-black/35 animate-in fade-in duration-[120ms] ease-out [touch-action:none] [-webkit-tap-highlight-color:transparent] motion-reduce:animate-none";
const SHEET_CLASS = "sidebar-sheet relative z-[1] box-border max-h-[calc(var(--app-viewport-height,100dvh)-48px)] overflow-y-auto [overscroll-behavior:contain] pt-1 pb-[max(8px,env(safe-area-inset-bottom))] rounded-t-(--radius-lg) bg-background text-foreground text-base  animate-in fade-in slide-in-from-bottom-[16px] duration-[120ms] ease-out pointer-events-auto focus:outline-none motion-reduce:animate-none [html[data-keyboard-open]_&]:pb-2";
const SHEET_TITLE_CLASS = "sidebar-sheet-title px-4 pt-[10px] pb-[9px] overflow-hidden text-muted-foreground text-xs text-ellipsis whitespace-nowrap";
const SHEET_BODY_CLASS = "sidebar-sheet-body py-1";
const SHEET_CANCEL_CLASS = ["sidebar-sheet-cancel", "flex items-center justify-center w-full h-12 px-4 bg-transparent text-muted-foreground text-base [font:inherit] cursor-pointer hover:bg-accent", "rounded-none font-normal focus-visible:ring-0 focus-visible:border-(--border)", FOCUS_RING].filter(Boolean).join(" ");

/** Enter is taken on the button rather than left to its click, which would not say whether Shift was held. */
function activateOnEnter(action: MenuAction, onActivate: (action: MenuAction, shiftKey: boolean) => void) {
  return (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    onActivate(action, event.shiftKey);
  };
}

function MenuItemButton({ item, mode, inRow = false, onActivate }: { item: ActionItem; mode: SurfaceMode; inRow?: boolean; onActivate: (action: MenuAction, shiftKey: boolean) => void }) {
  const choice = item.checked !== undefined;
  let trailing: ReactNode = null;
  if (item.disabled && item.disabledReason) {
    trailing = <span className={noteClassName(mode)}>{item.disabledReason}</span>;
  } else if (item.note) {
    trailing = <span className={noteClassName(mode)}>{item.note}</span>;
  } else if (item.shortcut) {
    trailing = <kbd className={shortcutClassName(mode.sheet)}>{item.shortcut}</kbd>;
  }
  const button = (
    <button
      type="button"
      role={choice ? "menuitemradio" : "menuitem"}
      aria-checked={choice ? item.checked : undefined}
      aria-disabled={item.disabled ? true : undefined}
      aria-keyshortcuts={item.shortcut && !item.disabled ? item.shortcut.toUpperCase() : undefined}
      tabIndex={-1}
      title={item.title}
      data-sidebar-menu-item=""
      className={itemClassName(item, mode, inRow)}
      onClick={(event) => onActivate(item, event.shiftKey)}
      onKeyDown={activateOnEnter(item, onActivate)}
    >
      <span className={iconClassName(item, mode)}>
        {choice ? (item.checked ? <CheckIcon size={13} /> : null) : item.icon}
      </span>
      <span className={labelClassName(item, mode)}>{item.path ? <span>{item.label}</span> : item.label}</span>
      {item.badge}
      {trailing}
    </button>
  );
  const secondary = item.secondary;
  if (!secondary) return button;
  return (
    <div
      className={[choice ? "sidebar-menu-row is-choice" : "sidebar-menu-row", "flex items-center gap-0.5", mode.classic && choice ? "" : ""].filter(Boolean).join(" ")}
      role="none"
    >
      {button}
      <button
        type="button"
        role="menuitem"
        aria-label={secondary.label}
        aria-disabled={secondary.disabled ? true : undefined}
        tabIndex={-1}
        title={secondary.label}
        data-sidebar-menu-item=""
        className={secondaryClassName(secondary, mode)}
        onClick={(event) => onActivate(secondary, event.shiftKey)}
        onKeyDown={activateOnEnter(secondary, onActivate)}
      >
        {secondary.icon}
      </button>
    </div>
  );
}

/** Whether the body is more than a plain item list: then the box is a dialog and the list a menu. */
function isCompositeBody(items: readonly SidebarMenuItem[] | undefined, filter: SidebarMenuFilter | undefined, children: ReactNode, footer: ReactNode): boolean {
  return hasCustomMenuBody(children)
    || hasCustomMenuBody(footer)
    || (filter !== undefined && sidebarMenuHasFilter(items, filter.minChoices));
}

interface MenuSurfaceBodyProps {
  mode: SurfaceMode;
  ariaLabel: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** The filter field's text. */
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  children?: ReactNode;
  /** Focus goes into the list from the field: Down/Up to its first/last item (Tab like Down). */
  onFilterNavigate?: (element: HTMLElement | undefined) => void;
  footer?: ReactNode;
  onActivate: (action: MenuAction, shiftKey: boolean) => void;
}

/** The items of the list the field belongs to, focusable ones only. */
function itemsAround(field: HTMLInputElement): HTMLElement[] {
  const menu = field.closest("div[role='menu']");
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(isFocusable);
}

/**
 * The body of a desktop box or a sheet: the filter, what it found, the items,
 * a footer — or a custom body as given.
 */
function MenuSurfaceBody({ mode, ariaLabel, items, filter, filterQuery = "", onFilterQueryChange, onFilterNavigate, footer, onActivate, children }: MenuSurfaceBodyProps) {
  const custom = hasCustomMenuBody(children);
  const hasFooter = !custom && hasCustomMenuBody(footer);
  const filtered = filter !== undefined && !custom && sidebarMenuHasFilter(items, filter.minChoices);
  const shown = filtered ? filterSidebarMenuItems(items ?? [], filterQuery) : items ?? [];
  const list = shown.map((item) => {
    if (item.type === "separator") return <div key={item.id} className={separatorClassName(mode)} role="separator" />;
    if (item.type === "header") return <div key={item.id} className={headerClassName(mode)} role="presentation">{item.label}</div>;
    if (item.type === "custom") return <div key={item.id} className="sidebar-menu-custom" role="none">{item.content}</div>;
    return <MenuItemButton key={item.id} item={item} mode={mode} onActivate={onActivate} />;
  });
  // A menu holds only its items: the field and what it found stand before
  // the list, a footer after it, inside a dialog (the sheet is one already).
  if (custom) return <>{children}</>;
  if (!filtered && !hasFooter) return <>{list}</>;
  return (
    <>
      {filtered && (
        <div className={filterClassName(mode)}>
          <Input
            className={filterInputClassName(mode)}
            value={filterQuery}
            placeholder={filter.placeholder}
            aria-label={filter.placeholder}
            autoComplete="off"
            spellCheck={false}
            data-sidebar-menu-filter=""
            data-sidebar-menu-autofocus={mode.sheet ? undefined : ""}
            onChange={(event) => onFilterQueryChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) {
                // An IME composition belongs to the field.
                event.stopPropagation();
                return;
              }
              // Arrows and Tab leave the field for the list (Down and Up like
              // the old leavesFilter). Everything else stays the field's: its
              // letters must not reach the menu's key handling.
              if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab") {
                event.preventDefault();
                event.stopPropagation();
                const items = itemsAround(event.currentTarget);
                const last = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
                onFilterNavigate?.(last ? items[items.length - 1] : items[0]);
                return;
              }
              if (event.key.length === 1) event.stopPropagation();
            }}
          />
        </div>
      )}
      {filtered && (
        <div role="status">
          {filterQuery.trim() && !shown.some(isChoice) && <div className={emptyClassName(mode)}>{filter.emptyLabel}</div>}
        </div>
      )}
      <div role="menu" aria-label={ariaLabel}>{list}</div>
      {hasFooter && footer}
    </>
  );
}

/** The sheet's box: its title, its body and its Cancel. */
function SheetInner({
  ariaLabel,
  title,
  radixTitle = false,
  items,
  filter,
  filterQuery,
  onFilterQueryChange,
  onFilterNavigate,
  children,
  cancelLabel,
  focusCancel = false,
  footer,
  surfaceRef,
  onActivate,
  onCancel,
}: Omit<MenuSurfaceBodyProps, "mode"> & {
  title?: string;
  /** The production sheet renders the title as a Radix dialog title. */
  radixTitle?: boolean;
  cancelLabel: string;
  focusCancel?: boolean;
  surfaceRef?: Ref<HTMLDivElement>;
  onCancel: () => void;
}) {
  const menuRole = isCompositeBody(items, filter, children, footer) ? undefined : "menu";
  const titleElement = radixTitle
    ? <DialogPrimitive.Title className={title ? SHEET_TITLE_CLASS : "sr-only"}>{title ?? ariaLabel}</DialogPrimitive.Title>
    : title ? <div className={SHEET_TITLE_CLASS}>{title}</div> : null;
  return (
    <div ref={surfaceRef} className={SHEET_CLASS} role="dialog" aria-modal="true" aria-label={ariaLabel}>
      {titleElement}
      <div className={SHEET_BODY_CLASS} role={menuRole} aria-label={menuRole ? ariaLabel : undefined}>
        <MenuSurfaceBody
          mode={{ classic: false, sheet: true }}
          ariaLabel={ariaLabel}
          items={items}
          filter={filter}
          filterQuery={filterQuery}
          onFilterQueryChange={onFilterQueryChange}
          onFilterNavigate={onFilterNavigate}
          footer={footer}
          onActivate={onActivate}
        >
          {children}
        </MenuSurfaceBody>
      </div>
      <Button
        type="button"
        variant="ghost"
        className={SHEET_CANCEL_CLASS}
        data-sidebar-menu-autofocus={focusCancel ? "" : undefined}
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
    </div>
  );
}

export interface SidebarMenuSurfaceProps {
  sheet?: boolean;
  ariaLabel: string;
  title?: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** The filter field's text. */
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  children?: ReactNode;
  cancelLabel: string;
  focusCancel?: boolean;
  width?: number;
  classic?: boolean;
  footer?: ReactNode;
  surfaceRef?: Ref<HTMLDivElement>;
  onActivate: (action: MenuAction, shiftKey: boolean) => void;
  onClose: (reason: "outside" | "cancel") => void;
}

/**
 * The menu or sheet itself, without the portal, placement, focus or key
 * handling `SidebarMenu` adds around it. The production sheet mounts the
 * same box under a Radix dialog; the desktop box's classes, role and body
 * are the ones `SidebarMenu` puts on Radix's content.
 */
export function SidebarMenuSurface({
  sheet = false,
  ariaLabel,
  title,
  items,
  filter,
  filterQuery = "",
  onFilterQueryChange,
  children,
  cancelLabel,
  focusCancel = false,
  width = DEFAULT_MENU_WIDTH,
  classic = false,
  footer,
  surfaceRef,
  onActivate,
  onClose,
}: SidebarMenuSurfaceProps) {
  const mode: SurfaceMode = { classic, sheet };
  const menuRole = isCompositeBody(items, filter, children, footer) ? "dialog" : "menu";
  if (!sheet) {
    return (
      <div
        ref={surfaceRef}
        className={menuBoxClassName(classic)}
        role={menuRole}
        aria-label={ariaLabel}
        style={{ width }}
        {...isolateEvents}
      >
        <MenuSurfaceBody
          mode={mode}
          ariaLabel={ariaLabel}
          items={items}
          filter={filter}
          filterQuery={filterQuery}
          onFilterQueryChange={onFilterQueryChange}
          footer={footer}
          onActivate={onActivate}
        >
          {children}
        </MenuSurfaceBody>
      </div>
    );
  }

  return (
    <div className={SHEET_LAYER_CLASS} {...isolateEvents}>
      {/* The backdrop takes the tap that closes the sheet, so it reaches neither the
          drawer's own backdrop (which would close the sidebar) nor a row. */}
      <div className={SHEET_BACKDROP_CLASS} aria-hidden="true" onClick={() => onClose("outside")} />
      <SheetInner
        ariaLabel={ariaLabel}
        title={title}
        items={items}
        filter={filter}
        filterQuery={filterQuery}
        onFilterQueryChange={onFilterQueryChange}
        cancelLabel={cancelLabel}
        focusCancel={focusCancel}
        footer={footer}
        surfaceRef={surfaceRef}
        onActivate={onActivate}
        onCancel={() => onClose("cancel")}
      >
        {children}
      </SheetInner>
    </div>
  );
}

export function SidebarMenu({
  open,
  anchor,
  sheet = false,
  ariaLabel,
  title,
  items,
  filter,
  children,
  cancelLabel,
  focusCancel,
  onClose,
  returnFocusTo,
  width,
  classic = false,
  footer,
  focusKey = "",
  onBodyEscape,
}: SidebarMenuProps) {
  const [mounted, setMounted] = useState(false);
  // The one piece of state the menu keeps: its filter field's text, for one
  // opening of one body.
  const [filterQuery, setFilterQuery] = useState("");
  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The latest props for handlers attached once per opening.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onBodyEscapeRef = useRef(onBodyEscape);
  onBodyEscapeRef.current = onBodyEscape;
  /**
   * The opener, taken as the menu opens: the parent closes it by dropping its
   * state, `returnFocusTo` included, before Radix's deferred focus return runs.
   */
  const openerRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);
  /** Which dismissal Radix reports: tagged by the handlers that see the cause. */
  const closeReasonRef = useRef<SidebarMenuCloseReason | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const visible = open && mounted && (sheet || anchor !== null);
  const custom = hasCustomMenuBody(children);
  const anchorKey = anchor ? JSON.stringify(anchor) : "";

  const activate = (action: MenuAction, shiftKey: boolean) => {
    if (action.disabled) return;
    let keepOpen = false;
    action.onSelect({ shiftKey, keepOpen: () => { keepOpen = true; } });
    if (!keepOpen) onCloseRef.current("select");
  };
  const activateRef = useRef(activate);
  activateRef.current = activate;

  useEffect(() => {
    setFilterQuery("");
  }, [visible, custom]);

  // The opener is read on the opening; every close-time handler uses this.
  useLayoutEffect(() => {
    if (visible && !wasVisibleRef.current) openerRef.current = returnFocusTo ?? null;
    wasVisibleRef.current = visible;
  });

  // Focus moves into the menu when it opens, and again when its body is
  // swapped (the worktree menu turning into its form, or showing it below).
  // The opening takes the first marked control (a filter field); a swap hands
  // the claim to the new body's own, so a long list's filter does not keep it.
  const openedRef = useRef(false);
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!visible || !surface) {
      // Closed: the next run is an opening again.
      openedRef.current = false;
      return;
    }
    const opening = !openedRef.current;
    openedRef.current = true;
    (opening ? initialFocusTarget(surface) : menuBodyFocusTarget(surface))?.focus({ preventScroll: true });
  }, [visible, sheet, custom, focusKey]);

  // On close, focus returns to the opener unless the user put it elsewhere.
  // The cleanup runs while the menu tree is still in the DOM (the parent
  // closes by dropping its state): the row still shows its actions, so the
  // opener can take focus back before the commit hides it again. Radix's own
  // deferred close focus runs after that; handleCloseAutoFocus prevents it.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!visible || !surface) return;
    const opener = openerRef.current;
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body && !surface.contains(active)) return;
      const target = menuFocusReturnTarget(opener);
      if (!target) return;
      target.focus({ preventScroll: true });
      // Keyboard focus on the row's main button shows its actions again
      // (:has(:focus-visible) in app/sidebar.css): the opener is back, so it
      // takes focus, as if it had never been hidden.
      if (opener && target !== opener && isRendered(opener)) opener.focus({ preventScroll: true });
    };
  }, [visible, sheet]);

  /** Radix reports the dismissal; the cause tagged `closeReasonRef` first. */
  const handleOpenChange = (next: boolean) => {
    if (!next) onCloseRef.current(closeReasonRef.current ?? "outside");
  };

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    // A filter with text in it is cleared first; the next Escape closes.
    const field = surfaceRef.current?.querySelector<HTMLElement>(FILTER_SELECTOR) ?? null;
    if (field && filterQueryRef.current) {
      event.preventDefault();
      setFilterQuery("");
      field.focus({ preventScroll: true });
      return;
    }
    // Escaping out of the swapped-in body returns to the list instead of
    // closing (the "New worktree…" form).
    if (onBodyEscapeRef.current && event.target instanceof Element && event.target.closest(BODY_ESC_SELECTOR)) {
      event.preventDefault();
      onBodyEscapeRef.current();
      return;
    }
    closeReasonRef.current = "escape";
  };

  const handlePointerDownOutside = (event: CustomEvent<{ originalEvent: PointerEvent }>) => {
    closeReasonRef.current = "outside";
    // The opener was pressed while its menu was open: that press closes the
    // menu, and its click must not open it again.
    const opener = openerRef.current;
    const original = event.detail.originalEvent;
    const target = original.target instanceof Node ? original.target : null;
    if (opener && target && original.button === 0 && opener.contains(target)) swallowNextClickOn(opener);
  };

  const handleFocusOutside = () => {
    closeReasonRef.current = "outside";
  };

  /** The opening takes the first marked control (a filter field, a question's Cancel); Radix keeps the box itself otherwise. */
  const handleOpenAutoFocus = (event: Event) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const target = initialFocusTarget(surface);
    if (target) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
  };

  /**
   * On close, focus returns to the opener unless the user put it elsewhere.
   * Radix hands its deferred close event here: taking it keeps its own
   * trigger-focus fallback out, and the opener was captured when the menu
   * opened, before the parent dropped it with the rest of its state.
   */
  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const surface = surfaceRef.current;
    const active = document.activeElement;
    if (active && active !== document.body && !(surface && surface.contains(active))) return;
    const opener = openerRef.current;
    const target = menuFocusReturnTarget(opener);
    if (!target) return;
    target.focus({ preventScroll: true });
    // Keyboard focus on the row's main button shows its actions again
    // (:has(:focus-visible) in app/sidebar.css): the opener is back, so it
    // takes focus, as if it had never been hidden.
    if (opener && target !== opener && isRendered(opener)) opener.focus({ preventScroll: true });
  };

  /**
   * The menu's keys: the items' arrows, Home/End and one-letter shortcuts,
   * over the plain buttons Radix's collection does not know. Runs on the
   * content, so it sees only keys of the menu itself.
   */
  const handleMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Tab") {
      // Radix swallows Tab inside a desktop menu (a focus trap). A form
      // swapped into the body keeps its own order: the next tabbable of the
      // surface takes the Tab; out of the surface it stays trapped.
      if (!target || !surface.contains(target)) return;
      const backwards = event.shiftKey;
      const tabbables = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element !== target && element.tabIndex >= 0 && isFocusable(element));
      const direction = backwards ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
      const next = tabbables.find((element) => (target.compareDocumentPosition(element) & direction) !== 0);
      if (next) {
        event.preventDefault();
        next.focus({ preventScroll: true });
      }
      return;
    }
    // The filter field keeps its letters and caret keys; Down, Up and Tab go
    // on to the items (the field handles them itself).
    if (target && isTextEntry(target)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      const list = enabledItems(surface);
      if (list.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const index = target ? list.indexOf(target as HTMLElement) : -1;
      let next: number;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      else if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % list.length;
      else next = index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length;
      list[next].focus({ preventScroll: false });
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const item = findSidebarMenuShortcut(itemsRef.current, event.key);
    if (!item || custom) return;
    event.preventDefault();
    event.stopPropagation();
    activateRef.current(item, event.shiftKey);
  };

  const onFilterNavigate = (element: HTMLElement | undefined) => {
    element?.focus({ preventScroll: false });
  };

  if (!visible) return null;

  const mode: SurfaceMode = { classic, sheet };
  const menuRole = isCompositeBody(items, filter, children, footer) ? "dialog" : "menu";
  const onKeyDown = (event: ReactKeyboardEvent) => {
    stopReactPropagation(event);
    handleMenuKeyDown(event);
  };

  if (sheet) {
    return (
      // Non-modal: the drawer underneath keeps its own dismissal, and the
      // layer locks no pointer events; the backdrop takes the taps that
      // close the sheet.
      <DialogPrimitive.Root open onOpenChange={handleOpenChange} modal={false}>
        <DialogPrimitive.Portal>
          <div className={SHEET_BACKDROP_CLASS} aria-hidden="true" {...isolateEvents} />
          {/* The layer spans the visible area the way the drawer does, from
              the top of the screen down to --app-viewport-height (100dvh, the
              only value anything writes it to now that the keyboard no longer
              takes the layout height over). The layer lets taps through
              (`pointer-events-none`): they land on the backdrop, which Radix
              reads as a press outside the layer. */}
          <DialogPrimitive.Content
            ref={surfaceRef}
            role="presentation"
            className={cn(SHEET_LAYER_CLASS, "h-[var(--app-viewport-height,100dvh)]")}
            onOpenAutoFocus={handleOpenAutoFocus}
            onCloseAutoFocus={handleCloseAutoFocus}
            onEscapeKeyDown={handleEscapeKeyDown}
            onPointerDownOutside={handlePointerDownOutside}
            onFocusOutside={handleFocusOutside}
            {...isolateEvents}
            onKeyDown={onKeyDown}
          >
            <SheetInner
              ariaLabel={ariaLabel}
              title={title}
              radixTitle
              items={items}
              filter={filter}
              filterQuery={filterQuery}
              onFilterQueryChange={setFilterQuery}
              onFilterNavigate={onFilterNavigate}
              cancelLabel={cancelLabel}
              focusCancel={focusCancel}
              footer={footer}
              onActivate={(action, shiftKey) => activateRef.current(action, shiftKey)}
              onCancel={() => onCloseRef.current("cancel")}
            >
              {children}
            </SheetInner>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  const triggerStyle: CSSProperties = anchor!.kind === "point"
    ? { position: "fixed", left: anchor!.x, top: anchor!.y, width: 0, height: 0 }
    : {
        position: "fixed",
        left: anchor!.rect.left,
        top: anchor!.rect.top,
        width: anchor!.rect.right - anchor!.rect.left,
        height: anchor!.rect.bottom - anchor!.rect.top,
      };

  // Radix keeps onOpenAutoFocus out of the DropdownMenu content's public
  // props, but the runtime wires it (FocusScope's mount focus): taking it
  // stops the box itself from taking the focus Radix's internal mount
  // handler would give it after this component's own focus effect.
  const mountFocusProps = { onOpenAutoFocus: handleOpenAutoFocus } as ComponentProps<typeof DropdownMenuPrimitive.Content>;

  return (
    // Keyed by the anchor: a menu re-anchored while it stays open remeasures
    // instead of sitting at the old coordinates.
    <DropdownMenuPrimitive.Root key={anchorKey} open onOpenChange={handleOpenChange} modal={false}>
      {/* The hidden trigger: parked at the anchor, outside the virtualized
          rows and outside the opener button, pointer-events off. Radix
          anchors its placement here. */}
      <DropdownMenuPrimitive.Trigger asChild aria-hidden tabIndex={-1}>
        <span className="pointer-events-none" style={triggerStyle} />
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={surfaceRef}
          className={menuBoxClassName(classic)}
          role={menuRole}
          aria-label={ariaLabel}
          style={{ width: width ?? DEFAULT_MENU_WIDTH }}
          side="bottom"
          align={anchor!.kind === "point" ? "start" : anchor!.align}
          sideOffset={anchor!.kind === "point" ? 0 : 4}
          collisionPadding={8}
          avoidCollisions
          {...mountFocusProps}
          onCloseAutoFocus={handleCloseAutoFocus}
          onEscapeKeyDown={handleEscapeKeyDown}
          onPointerDownOutside={handlePointerDownOutside}
          onFocusOutside={handleFocusOutside}
          {...isolateEvents}
          onKeyDown={onKeyDown}
        >
          <MenuSurfaceBody
            mode={mode}
            ariaLabel={ariaLabel}
            items={items}
            filter={filter}
            filterQuery={filterQuery}
            onFilterQueryChange={setFilterQuery}
            onFilterNavigate={onFilterNavigate}
            footer={footer}
            onActivate={(action, shiftKey) => activateRef.current(action, shiftKey)}
          >
            {children}
          </MenuSurfaceBody>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
