"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UsageBar } from "@/components/UsageBar";
import type { StepUsage } from "@/lib/turn-view";
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
  // 三态：用户已记录选择则以其为准，未记录时使用 defaultOpen。不可将“未记录”
  // 等同于“已收起”，否则任一处展开都会关闭所有依赖 defaultOpen 的折叠区。
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
  stepUsage,
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
  /** 胶囊后的定量信息（编辑的 +N/−N）：同时说明目标文件与改动量。 */
  suffix?: ReactNode;
  /** 本行耗时。与思考行一致，置于箭头**内侧**，不可跨内外边界。 */
  duration?: ReactNode;
  /** 行尾动作按钮（如打开子代理面板）：置于折叠触发按钮之外，
      因按钮不可嵌套，而触发按钮内只容纳该行文字。 */
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
  /** The issuing request's usage: the expanded card's first line, whatever kind of call it is. */
  stepUsage?: StepUsage;
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
  // 展开/收起时行保持原位，内容在其下方增长：否则列表在收起时上跳、展开时滑到底部。
  // 锚定的是本行顶边，在布局阶段测量、绘制之前应用。
  const rowRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<{ container: HTMLElement; top: number } | null>(null);
  const toggleFold = useCallback(
    (next: boolean) => {
      const row = rowRef.current;
      const container = row ? scrollParentOf(row) : null;
      if (row && container) pinRef.current = { container, top: row.getBoundingClientRect().top };
      // 通知列表本行正在折叠：这几帧禁用贴底跟随，否则展开的行会被拉上去。
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
  // 文件胶囊与行本身均为按钮，HTML 不允许按钮嵌套（移动端内层还会截获点击）。
  // 因此有展开内容时，行按钮只承载文字，胶囊作为其兄弟节点置于行尾并对齐。
  const line = (withChips: boolean, withTrailing = true) => (
    // 行宽跟随内容（官方 `w-fit max-w-full`）：箭头紧跟文字；超宽时由对象/描述上的
    // `truncate` 收缩，箭头始终贴住最后一段文字。
      <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="min-w-0 overflow-hidden" data-expanded={open || undefined}>
      {(icon != null || activeIcon != null) && (
        <TraceIcon>{open && activeIcon != null ? activeIcon : icon}</TraceIcon>
      )}
      {/* The action is never elided: it is the row's name (工具名称为必要信息，不可省略). */}
      <TraceTitle className={cn("shrink-0 whitespace-nowrap", titleClassName)}>{title}</TraceTitle>
      {/* 对象是唯一可让步的片段：名称、胶囊、行尾均不收缩。 */}
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
        {/* 行内间距与触发区一致（gap-1）：有无胶囊的行，箭头前留白必须相同。 */}
        <div className="flex w-full max-w-full items-center gap-1">
          {/* 触发区仅覆盖文字：胶囊紧跟动作名，不被 flex-1 推到行尾。胶囊为按钮，不可
              嵌套于触发按钮内，故触发区不绘制箭头，箭头改为胶囊后的兄弟按钮（同样调 toggleFold）。 */}
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
          {/* 行尾计数（编辑的 +N/−N）位于胶囊之后，一次读完目标文件与改动量。 */}
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
          {/* 行尾留白，将折叠箭头与 ··· 推至右边缘（胶囊为链接，不可嵌入按钮）。 */}
          <span className="min-w-0 flex-1" aria-hidden="true" />
          {actions}
        </div>
        {/* 展开区不设高度上限：代码块、思考块各自限高即可，两层同时限高会出现两个滚动条。 */}
        <TraceCollapsibleContent className="mt-1 flex flex-col gap-2 [&>*]:min-w-0">
          {stepUsage && (
            <div className="text-xs">
              <UsageBar usage={stepUsage} gap={10} />
            </div>
          )}
          {content}
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {below}
    </Trace>
  );
}
