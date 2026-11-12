"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { ChevronRightIcon } from "lucide-react";
import {
  COLLAPSIBLE_EXPANDED_EVENT,
  getFoldChoice,
  setToolCallExpanded,
} from "@/lib/tool-call-expansion";
import type { ToolViewStatus } from "@/lib/tool-view";

/**
 * The base every pattern below builds on: one `TraceLine` that folds its
 * content. Kept private to `components/transcript` — a pattern names the thing
 * being shown (a tool call, a thought, a group) instead of exposing this shape.
 */

const STATUS_ATTR = {
  running: "running",
  error: "error",
  pending: "pending",
  done: undefined,
} as const;

/** The nearest ancestor that actually scrolls — the message list's viewport. */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Fold state for one row. `foldKey` keeps the user's choice across remounts
 * (streaming → message_end → process details → a session file read), the same
 * way tool cards always have.
 */
export function useTraceFold(foldKey?: string, defaultOpen = false) {
  // 三态：用户主动过就听用户的，没设置过才用 defaultOpen。旧实现的
  // `setOpen(isToolCallExpanded(key))` 把「没记录」当成「已收起」，于是别处
  // （一行工具）一展开，所有靠 defaultOpen 打开的大折叠都被强行关掉。
  const [open, setOpen] = useState(() => getFoldChoice(foldKey) ?? defaultOpen);

  useEffect(() => {
    if (!foldKey) return;
    const sync = () => {
      const choice = getFoldChoice(foldKey);
      if (choice !== undefined) setOpen(choice);
    };
    window.addEventListener(COLLAPSIBLE_EXPANDED_EVENT, sync);
    return () => window.removeEventListener(COLLAPSIBLE_EXPANDED_EVENT, sync);
  }, [foldKey]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      setToolCallExpanded(foldKey, next);
    },
    [foldKey],
  );

  return { open, onOpenChange };
}

export function TraceRow({
  icon,
  activeIcon,
  title,
  object,
  titleClassName,
  chips,
  suffix,
  duration,
  actions,
  description,
  status = "done",
  foldKey,
  defaultOpen = false,
  trailing,
  content,
  below,
  ariaLabel,
  href,
  activityTool,
  children,
}: {
  icon?: ReactNode;
  /** Shown instead of `icon` while the row is expanded: the coloured version. */
  activeIcon?: ReactNode;
  title: string;
  /** The thing the action applies to: elided before the action ever is. */
  object?: string;
  titleClassName?: string;
  /** File chips the call named, right after the title (第 4.1 节). */
  chips?: ReactNode;
  /** 胶囊后面的定量（编辑的 +N/−N）：胶囊指哪个文件、改了多少，读起来是一句。 */
  suffix?: ReactNode;
  /** 这一行花了多久。和思考行一样放在箭头**里面**，不能一半在里面一半在外面。 */
  duration?: ReactNode;
  /** 行尾的动作按钮（比如打开子代理面板）：放在折叠触发按钮之外，
      因为按钮不能嵌按钮，而触发按钮里只能有那一行文字。 */
  actions?: ReactNode;
  description?: string;
  status?: ToolViewStatus;
  /** Fold memory key (`toolCallId`, `groupKey`, …). */
  foldKey?: string;
  defaultOpen?: boolean;
  /** Rendered after the description, before the chevron (duration, badges). */
  trailing?: ReactNode;
  /** Folding content. Omitted = a plain line that cannot expand. */
  content?: ReactNode;
  /** Rendered inside the fold after `content`. */
  children?: ReactNode;
  /** Rendered inside the same `Trace` below the line (media the call produced). */
  below?: ReactNode;
  ariaLabel?: string;
  /** Renders the line as a link (官方 Sources 的同一形状). */
  href?: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
}) {
  const { open, onOpenChange } = useTraceFold(foldKey, defaultOpen);
  // 展开/收起时行不动，下方内容长在它下面：否则列表会整块上跳（收起）或滑到底
  // （展开），看着就是“闪一下”。锚定的是这一行自己的顶边，量在布局阶段、画之前。
  const rowRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<{ container: HTMLElement; top: number } | null>(null);
  const toggleFold = useCallback(
    (next: boolean) => {
      const row = rowRef.current;
      const container = row ? scrollParentOf(row) : null;
      if (row && container) pinRef.current = { container, top: row.getBoundingClientRect().top };
      // 告诉列表“这一行正在折叠”：这几帧不要贴底跟随，否则展开的行会被拉上去。
      window.dispatchEvent(new Event("pi-web:trace-fold"));
      onOpenChange(next);
    },
    [onOpenChange],
  );
  useLayoutEffect(() => {
    const pin = pinRef.current;
    pinRef.current = null;
    const row = rowRef.current;
    if (!pin || !row || !pin.container.isConnected) return;
    const delta = row.getBoundingClientRect().top - pin.top;
    if (delta !== 0) pin.container.scrollTop += delta;
  }, [open]);
  // 文件胶囊是真正的按钮，行本身是折叠触发按钮：按钮不能嵌按钮，否则 HTML 结构
  // 非法、点击事件在移动端也会被里层吃掉。所以有展开内容时，行按钮只放文字，
  // 胶囊作为它的兄弟摆在行尾（同一行对齐）。
  const line = (withChips: boolean, withTrailing = true) => (
    // 行宽跟随内容（官方 `w-fit max-w-full`）：箭头紧跟文字，不甩到行尾；
    // 超宽时由对象/描述上的 `truncate` 收缩，箭头始终贴住最后一段文字。
      <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="min-w-0 overflow-hidden" data-expanded={open || undefined}>
      {(icon != null || activeIcon != null) && (
        <TraceIcon>{open && activeIcon != null ? activeIcon : icon}</TraceIcon>
      )}
      {/* The action is never elided: it is the row's name (用户要求：工具名称不可省略). */}
      <TraceTitle className={cn("shrink-0 whitespace-nowrap", titleClassName)}>{title}</TraceTitle>
      {/* 对象是唯一能让步的一段：名字、胶囊、行尾都不收缩。 */}
      {object && <span className="min-w-0 flex-1 truncate">{object}</span>}
      {withChips && chips}
      {withChips && suffix != null && <span className="shrink-0 whitespace-nowrap">{suffix}</span>}
      {description && <TraceDescription className="min-w-0 shrink truncate">{description}</TraceDescription>}
      {duration != null && <span className="shrink-0 tabular-nums">{duration}</span>}
      {withTrailing && trailing && <span className="shrink-0 pl-2">{trailing}</span>}
      </TraceLine>
  );

  if (!content) {
    return (
      <Trace ref={rowRef} data-activity="trace-row" data-activity-tool={activityTool}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {line(true)}
          </a>
        ) : (
          line(true)
        )}
        {actions}
        {below}
      </Trace>
    );
  }

  return (
    <Trace ref={rowRef} data-activity="trace-row" data-activity-tool={activityTool}>
      <TraceCollapsible open={open} onOpenChange={toggleFold}>
        <div className="flex w-full max-w-full items-center gap-1.5">
          {/* 触发区只盖文字：胶囊紧跟在动作名后面，不被 flex-1 推到行尾。
              胶囊是按钮，不能嵌进触发按钮里，所以触发区自己不再画箭头，
              箭头改成跟在胶囊后面的兄弟按钮（同样调 toggleFold）。 */}
          <TraceCollapsibleTrigger
            aria-label={ariaLabel}
            className="min-w-0 max-w-full"
            showChevron={chips == null}
          >
            {line(false, false)}
          </TraceCollapsibleTrigger>
          {chips}
          {suffix != null && (
            <span className="shrink-0 whitespace-nowrap">{suffix}</span>
          )}
          {/* 行尾计数（编辑的 +N/−N）跟在胶囊后面：“哪个文件、改了多少”一句话读完。 */}
          {trailing && <span className="shrink-0 pl-2">{trailing}</span>}
          {chips != null && (
            <button
              type="button"
              onClick={() => toggleFold(!open)}
              aria-expanded={open}
              aria-label={ariaLabel}
              className="flex shrink-0 cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <TraceIcon className={cn("transition-transform", open && "rotate-90")}>
                <ChevronRightIcon />
              </TraceIcon>
            </button>
          )}
          {/* 行尾留白，把折叠箭头和 ··· 留在右边缘（胶囊是链接，不能嵌进按钮）。 */}
          <span className="min-w-0 flex-1" aria-hidden="true" />
          {actions}
        </div>
        <TraceCollapsibleContent className="mt-1 flex flex-col gap-2">
          {content}
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {below}
    </Trace>
  );
}
