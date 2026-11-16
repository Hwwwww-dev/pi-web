"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

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
  /** Shown as given in the item's place (a worktree menu's confirmation row); its buttons mark themselves as items. */
  | { type: "custom"; id: string; content: ReactNode };

export type SidebarMenuAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; rect: { left: number; top: number; right: number; bottom: number }; align: "start" | "end" };

export type SidebarMenuCloseReason = "escape" | "outside" | "select";

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
  /** Choices needed for the field, if not `SIDEBAR_MENU_FILTER_MIN_CHOICES`. */
  minChoices?: number;
}

export const SIDEBAR_MENU_FILTER_MIN_CHOICES = 8;

export interface SidebarMenuProps {
  open: boolean;
  anchor: SidebarMenuAnchor | null;
  ariaLabel: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** A custom body (a small form) instead of `items`. */
  children?: ReactNode;
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
  /** Shown after the items, outside the list (a worktree menu's "New worktree…" form). */
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

const DEFAULT_MENU_WIDTH = 208;

const ITEM_SELECTOR = "[data-sidebar-menu-item]";
const FILTER_SELECTOR = "[data-sidebar-menu-filter]";
/** The control that takes focus when the menu or its body shows (a filter field, a question's Cancel). */
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
 * worktree menu's "New worktree…" form under its list): the new body's marked
 * control, not the list's filter field above it — first in the page, it took
 * the focus when the menu opened and would keep it. Back to the list nothing
 * else is marked, so the filter takes it again.
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
 * The opener was pressed while its menu was open: that press closes the menu,
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

/** The menu box's look, shared by the engine and the picker's own DropdownMenu content. */
export function sidebarMenuBoxClassName(): string {
  return menuBoxClassName();
}

function menuBoxClassName(): string {
  return [
    "sidebar-menu",
    "z-[400] box-border min-w-0 max-w-[calc(100vw-16px)]",
    "max-h-[min(calc(var(--app-viewport-height,100dvh)-16px),480px,var(--radix-popper-available-height,480px))] overflow-y-auto [overscroll-behavior:contain]",
    "border border-(--border) rounded-(--radius-md) bg-background text-foreground text-xs shadow-(--shadow-md)",
    "p-0",
    // 开合动画沿用官方 content 的 fade+滑入，缩放两档归零（旧手写动画无缩放），
    // 时长保留侧栏自己的 120ms 进 / 100ms 出。
    "duration-[120ms] ease-out motion-reduce:animate-none",
    "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
    "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[100ms] data-[state=closed]:fill-mode-forwards motion-reduce:data-[state=closed]:animate-none",
    "focus:outline-none",
  ].join(" ");
}

function itemClassName(item: ActionItem): string {
  const choice = item.checked !== undefined;
  const color = item.danger ? "text-destructive"
    : choice && !item.checked ? "text-muted-foreground"
    : "text-foreground";
  const highlight = item.danger
    ? "focus:bg-destructive/10 focus:text-destructive"
    : "focus:bg-secondary focus:text-foreground";
  return [
    "sidebar-menu-item",
    choice ? "is-choice" : "",
    item.danger ? "is-danger" : "",
    item.checked ? "is-checked" : "",
    "relative flex w-full items-center gap-2 rounded-xs px-2.5 py-2 text-left text-xs leading-[1.35] outline-hidden select-none",
    color,
    highlight,
    "cursor-pointer focus:outline-none",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
    "pointer-coarse:min-h-9",
  ].filter(Boolean).join(" ");
}

function iconClassName(item: ActionItem): string {
  const color = item.danger ? "text-destructive"
    : item.checked ? "text-(--accent)"
    : "text-muted-foreground";
  return [
    "sidebar-menu-icon",
    "inline-flex size-3.5 shrink-0 grow-0 items-center justify-center",
    // 强制统一 12px 与继承色：shadcn item 基类会给无 size-/text- 类的 svg 塞
    // size-4 / text-muted-foreground，盖过外层 span 的颜色继承。
    "[&_svg]:size-3! [&_svg]:text-inherit!",
    color,
  ].join(" ");
}

function labelClassName(item: ActionItem): string {
  return [
    "sidebar-menu-label",
    item.mono ? "is-mono" : "",
    item.path ? "is-path" : "",
    "flex-1 min-w-0 whitespace-nowrap",
    // 长路径标签：不省略而是横向滚动（rtl 起始即显示尾部，滚去头部），
    // 悬停另有整条 title 提示兜底——两样都对"显示不下"负责。
    item.path
      ? "overflow-x-auto overflow-y-hidden text-left [direction:rtl] [text-overflow:clip] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>span]:[unicode-bidi:plaintext]"
      : "overflow-hidden text-ellipsis",
    item.mono ? "font-mono text-xs" : "",
  ].filter(Boolean).join(" ");
}

function noteClassName(): string {
  return "sidebar-menu-note shrink-0 max-w-[45%] overflow-hidden text-muted-foreground text-ellipsis whitespace-nowrap text-xs";
}

function shortcutClassName(): string {
  return "sidebar-menu-shortcut shrink-0 text-muted-foreground font-mono text-xs";
}

function separatorClassName(): string {
  return "sidebar-menu-separator h-px bg-(--border) my-1 mx-0";
}

function filterClassName(): string {
  return "sidebar-menu-filter sticky top-0 z-[1] m-0 bg-background px-2 py-1.5";
}

function filterInputClassName(): string {
  return [
    "sidebar-menu-filter-input",
    "block h-auto w-full box-border border border-(--border) rounded-(--radius-sm) bg-background px-2 py-[5px] font-mono text-foreground outline-none [user-select:text] [-webkit-user-select:text] focus:border-(--accent) focus-visible:border-(--accent) focus-visible:ring-0",
  ].join(" ");
}

function emptyClassName(): string {
  return "sidebar-menu-empty px-2.5 py-2 text-muted-foreground text-xs";
}

function secondaryClassName(secondary: SidebarMenuSecondaryAction): string {
  const highlight = secondary.danger
    ? "focus:bg-destructive/10 focus:text-destructive"
    : "focus:bg-accent focus:text-foreground";
  return [
    "sidebar-menu-secondary",
    secondary.danger ? "is-danger" : "",
    "inline-flex size-7 shrink-0 grow-0 items-center justify-center rounded-(--radius-sm) border-0 bg-transparent p-0 cursor-pointer outline-none [&_svg]:text-inherit!",
    secondary.danger ? "text-destructive" : "text-muted-foreground",
    highlight,
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
    "pointer-coarse:size-10",
  ].filter(Boolean).join(" ");
}

/** Enter is taken on the button rather than left to its click, which would not say whether Shift was held. */
function activateOnEnter(action: MenuAction, onActivate: (action: MenuAction, shiftKey: boolean) => void) {
  return (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    onActivate(action, event.shiftKey);
  };
}

/** Static-mode stand-in for a Radix item (tests render the surface without a menu root). */
function StaticItem({ role, checked, className, title, disabled, onActivate, action, children }: {
  role: "menuitem" | "menuitemcheckbox";
  checked?: boolean;
  className: string;
  title?: string;
  disabled?: boolean;
  onActivate: (action: MenuAction, shiftKey: boolean) => void;
  action: MenuAction;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      tabIndex={-1}
      title={title}
      data-sidebar-menu-item=""
      className={className}
      onClick={(event) => onActivate(action, event.shiftKey)}
      onKeyDown={activateOnEnter(action, onActivate)}
    >
      {children}
    </div>
  );
}

/** One item of the list: a shadcn menu item (Radix under it), its own tooltip and its trailing note. */
function MenuRow({ item, onActivate, radix = true }: {
  item: ActionItem;
  onActivate: (action: MenuAction, shiftKey: boolean, event?: Event) => void;
  radix?: boolean;
}) {
  const choice = item.checked !== undefined;
  let trailing: ReactNode = null;
  if (item.disabled && item.disabledReason) {
    trailing = <span className={noteClassName()}>{item.disabledReason}</span>;
  } else if (item.note) {
    trailing = <span className={noteClassName()}>{item.note}</span>;
  } else if (item.shortcut) {
    trailing = <kbd className={shortcutClassName()}>{item.shortcut}</kbd>;
  }
  // 悬停提示：没有显式 title 的条目兜底为完整标签——凡是"显示不下"的地方
  // 都保证有提示可看（配合路径标签的横向滚动）。
  const tooltipTitle = item.title ?? item.label;
  const inner = (
    <>
      <span className={iconClassName(item)}>
        {choice ? (item.checked ? <CheckIcon size={12} /> : null) : item.icon}
      </span>
      <span className={labelClassName(item)}>{item.path ? <span>{item.label}</span> : item.label}</span>
      {item.badge}
      {trailing}
    </>
  );
  const className = itemClassName(item);
  const rowItem = radix ? (
    choice ? (
      <DropdownMenuCheckboxItem
        checked={item.checked}
        disabled={item.disabled}
        title={tooltipTitle}
        data-sidebar-menu-item=""
        className={`${className} pr-2 pl-2.5 [&>span]:hidden`}
        onSelect={(event) => onActivate(item, false, event)}
      >
        {inner}
      </DropdownMenuCheckboxItem>
    ) : (
      <DropdownMenuItem
        disabled={item.disabled}
        title={tooltipTitle}
        data-sidebar-menu-item=""
        className={className}
        onSelect={(event) => onActivate(item, false, event)}
      >
        {inner}
      </DropdownMenuItem>
    )
  ) : (
    <StaticItem
      role={choice ? "menuitemcheckbox" : "menuitem"}
      checked={item.checked}
      className={choice ? `${className} pr-2 pl-2.5` : className}
      title={tooltipTitle}
      disabled={item.disabled}
      action={item}
      onActivate={onActivate}
    >
      {inner}
    </StaticItem>
  );
  const secondary = item.secondary;
  if (!secondary) return rowItem;
  const secondaryNode = radix ? (
    <DropdownMenuItem
      disabled={secondary.disabled}
      title={secondary.label}
      aria-label={secondary.label}
      data-sidebar-menu-item=""
      className={secondaryClassName(secondary)}
      onSelect={(event) => onActivate(secondary, false, event)}
    >
      {secondary.icon}
    </DropdownMenuItem>
  ) : (
    <StaticItem
      role="menuitem"
      className={secondaryClassName(secondary)}
      title={secondary.label}
      disabled={secondary.disabled}
      action={secondary}
      onActivate={onActivate}
    >
      {secondary.icon}
    </StaticItem>
  );
  return (
    <div className={["sidebar-menu-row", choice ? "is-choice" : "", "flex items-center gap-0.5"].filter(Boolean).join(" ")} role="none">
      <div className="flex min-w-0 flex-1">{rowItem}</div>
      {secondaryNode}
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
  /** Radix on (the live menu); plain stand-ins off (the static surface the tests render). */
  radix?: boolean;
  onActivate: (action: MenuAction, shiftKey: boolean, event?: Event) => void;
}

/** The items of the list the field belongs to, focusable ones only. */
function itemsAround(field: HTMLInputElement): HTMLElement[] {
  const menu = field.closest("div[role='menu']");
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(isFocusable);
}

/**
 * The body of the menu: the filter, what it found, the items, a footer — or a
 * custom body as given.
 */
function MenuSurfaceBody({ ariaLabel, items, filter, filterQuery = "", onFilterQueryChange, onFilterNavigate, footer, onActivate, radix = true, children }: MenuSurfaceBodyProps) {
  const custom = hasCustomMenuBody(children);
  const hasFooter = !custom && hasCustomMenuBody(footer);
  const filtered = filter !== undefined && !custom && sidebarMenuHasFilter(items, filter.minChoices);
  const shown = filtered ? filterSidebarMenuItems(items ?? [], filterQuery) : items ?? [];
  const list = shown.map((item) => {
    if (item.type === "separator") return <div key={item.id} className={separatorClassName()} role="separator" />;
    if (item.type === "custom") return <div key={item.id} className="sidebar-menu-custom" role="none">{item.content}</div>;
    return <MenuRow key={item.id} item={item} onActivate={onActivate} radix={radix} />;
  });
  // A menu holds only its items: the field and what it found stand before
  // the list, a footer after it, inside a dialog.
  if (custom) return <>{children}</>;
  if (!filtered && !hasFooter) return <>{list}</>;
  return (
    <>
      {filtered && (
        <div className={filterClassName()}>
          <Input
            className={filterInputClassName()}
            value={filterQuery}
            placeholder={filter.placeholder}
            aria-label={filter.placeholder}
            autoComplete="off"
            spellCheck={false}
            data-sidebar-menu-filter=""
            data-sidebar-menu-autofocus=""
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
          {filterQuery.trim() && !shown.some(isChoice) && <div className={emptyClassName()}>{filter.emptyLabel}</div>}
        </div>
      )}
      <div role="menu" aria-label={ariaLabel}>{list}</div>
      {hasFooter && footer}
    </>
  );
}

export interface SidebarMenuSurfaceProps {
  ariaLabel: string;
  items?: SidebarMenuItem[];
  filter?: SidebarMenuFilter;
  /** The filter field's text. */
  filterQuery?: string;
  onFilterQueryChange?: (query: string) => void;
  children?: ReactNode;
  width?: number;
  footer?: ReactNode;
  onActivate: (action: MenuAction, shiftKey: boolean, event?: Event) => void;
  onClose: (reason: "outside") => void;
}

/**
 * The menu itself, without the portal, placement, focus or key handling
 * `SidebarMenu` adds around it: the same box and body the live menu renders
 * inside Radix's content. Static and test-facing.
 */
export function SidebarMenuSurface({
  ariaLabel,
  items,
  filter,
  filterQuery = "",
  onFilterQueryChange,
  children,
  width = DEFAULT_MENU_WIDTH,
  footer,
  onActivate,
}: SidebarMenuSurfaceProps) {
  const menuRole = isCompositeBody(items, filter, children, footer) ? "dialog" : "menu";
  return (
    <div
      className={menuBoxClassName()}
      role={menuRole}
      aria-label={ariaLabel}
      style={{ width }}
      {...isolateEvents}
    >
      <MenuSurfaceBody
        ariaLabel={ariaLabel}
        items={items}
        filter={filter}
        filterQuery={filterQuery}
        onFilterQueryChange={onFilterQueryChange}
        footer={footer}
        onActivate={onActivate}
        radix={false}
      >
        {children}
      </MenuSurfaceBody>
    </div>
  );
}

export function SidebarMenu({
  open,
  anchor,
  ariaLabel,
  items,
  filter,
  children,
  onClose,
  returnFocusTo,
  width,
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
  /** Shift at the pointer/key press that will select: Radix's select event does not carry it. */
  const lastShiftRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const visible = open && mounted && anchor !== null;
  const custom = hasCustomMenuBody(children);
  const anchorKey = anchor ? JSON.stringify(anchor) : "";

  /** Selects an item: keepOpen keeps Radix's select event unhandled (menu stays), else the closing is Radix's. */
  const activate = (action: MenuAction, shiftKey: boolean, event?: Event) => {
    if (action.disabled) return;
    let keepOpen = false;
    action.onSelect({ shiftKey, keepOpen: () => { keepOpen = true; } });
    if (keepOpen) {
      event?.preventDefault();
      return;
    }
    // No event (a shortcut letter activated the item): the engine closes
    // itself, since Radix's select flow is not in play.
    if (!event) onCloseRef.current("select");
    closeReasonRef.current = "select";
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
  }, [visible, custom, focusKey]);

  // On close, focus returns to the opener unless the user put it elsewhere.
  // The cleanup runs while the menu tree is still in the DOM (the parent
  // closes it by dropping its state): the row still shows its actions, so the
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
  }, [visible]);

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
   * The menu's own keys: Tab inside a composite body, and the items' one-letter
   * shortcuts. Arrows, Home/End and typeahead are Radix's (its collection owns
   * the items now); a shortcut letter activates directly, as it always has.
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

  const menuRole = isCompositeBody(items, filter, children, footer) ? "dialog" : "menu";
  const onKeyDown = (event: ReactKeyboardEvent) => {
    stopReactPropagation(event);
    handleMenuKeyDown(event);
  };

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
  const mountFocusProps = { onOpenAutoFocus: handleOpenAutoFocus } as ComponentProps<typeof DropdownMenuContent>;

  return (
    // Keyed by the anchor: a menu re-anchored while it stays open remeasures
    // instead of sitting at the old coordinates.
    <DropdownMenu key={anchorKey} open onOpenChange={handleOpenChange} modal={false}>
      {/* The hidden trigger: parked at the anchor, outside the virtualized
          rows and outside the opener button, pointer-events off. Radix
          anchors its placement here. */}
      <DropdownMenuTrigger asChild aria-hidden tabIndex={-1}>
        <span className="pointer-events-none" style={triggerStyle} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={surfaceRef}
        role={menuRole}
        aria-label={ariaLabel}
        className={menuBoxClassName()}
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
        onKeyDownCapture={(event) => { lastShiftRef.current = event.shiftKey; }}
        onPointerDownCapture={(event) => { lastShiftRef.current = event.shiftKey; }}
        onKeyDown={onKeyDown}
      >
        <MenuSurfaceBody
          ariaLabel={ariaLabel}
          items={items}
          filter={filter}
          filterQuery={filterQuery}
          onFilterQueryChange={setFilterQuery}
          onFilterNavigate={onFilterNavigate}
          footer={footer}
          // Radix 的 select 事件不带 shift 状态：capture 层记录，选中时读取。
          // 没有 event 的激活（快捷键字母）用调用方自己的 shiftKey。
          onActivate={(action, shiftKey, event) => activateRef.current(action, event ? lastShiftRef.current : shiftKey, event)}
        >
          {children}
        </MenuSurfaceBody>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
