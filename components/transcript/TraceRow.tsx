"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

/**
 * 折叠状态。`foldKey` 保存用户的选择（流式 → message_end → 过程详情 → 会话
 * 文件读取，跨重挂载不丢），与工具卡片一致。
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

/**
 * 行对象文本（命令/文件等）的固定形状：行内截左保右——尾部是命令的关键段
 * （2026-11-20 用户拍板，所有工具行与折叠行标题共用）。direction:rtl 把溢出
 * 与省略号赶到左侧，unicode-bidi:plaintext 保住行内 LTR 顺序。
 */
export function RowObjectSpan({ object }: { object: string }) {
  return (
    <span className="block truncate" style={{ direction: "rtl", unicodeBidi: "plaintext" }}>{object}</span>
  );
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
  wrap = false,
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
  /** 胶囊后的定量信息（编辑的 +N/−N）：与工具名同等优先，不收缩。 */
  suffix?: ReactNode;
  /** 本行耗时。折叠行置于触发区内，与工具名同享“不可挤压”待遇。 */
  duration?: ReactNode;
  /** 行尾动作按钮（如打开子代理面板）。 */
  actions?: ReactNode;
  description?: string;
  status?: ToolViewStatus;
  /** Fold memory key (`toolCallId`, `groupKey`, …). */
  foldKey?: string;
  defaultOpen?: boolean;
  /** Rendered after the description (duration, badges). */
  trailing?: ReactNode;
  /** Folding content. Omitted = a plain line that cannot expand. */
  content?: ReactNode;
  /** The issuing request's usage: the expanded card's first line, whatever kind of call it is. */
  stepUsage?: StepUsage;
  /** Rendered inside the same `Trace` below the line (media the call produced). */
  below?: ReactNode;
  ariaLabel?: string;
  /** Renders the line as a link (官方 Sources 的同一形状). */
  href?: string;
  /** The pi tool name, kept as `data-activity-tool` for the selectors that count rows. */
  activityTool?: string;
  /** 标题换行显示（提问/计划这类长标题行）：不截断、不加淡出。 */
  wrap?: boolean;
  children?: ReactNode;
}) {
  const { open, onOpenChange } = useTraceFold(foldKey, defaultOpen);
  const rowRef = useRef<HTMLDivElement>(null);
  // 收缩优先级：工具名与耗时不可压（触发区 shrink-0），+N/−N 不可压（shrink-0），
  // 文件胶囊先收缩（内部省略号+淡出），对象文本随后（truncate+淡出）。
  const titleEl = (
    <TraceTitle className={cn(wrap ? "whitespace-normal break-words" : "shrink-0 whitespace-nowrap", titleClassName)}>
      {title}
    </TraceTitle>
  );
  const objectEl = object && (
    <span
      className={cn("relative min-w-0", wrap ? "" : "flex-1 cursor-pointer")}
      onClick={wrap ? undefined : () => onOpenChange(!open)}
      title={!wrap ? object : undefined}
    >
      {wrap ? <span className="whitespace-normal break-words">{object}</span> : <RowObjectSpan object={object} />}
    </span>
  );
  // 文件胶囊与行本身均为按钮，HTML 不允许按钮嵌套（移动端内层还会截获点击）。
  // 触发区只承载不可压缩的「图标+工具名+耗时」，胶囊/对象/计数都是它的兄弟节点。
  const line = (withChips: boolean, withTrailing = true) => (
    <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="min-w-0 w-full max-w-[80%] overflow-hidden" data-expanded={open || undefined}>
      {(icon != null || activeIcon != null) && (
        <TraceIcon>{open && activeIcon != null ? activeIcon : icon}</TraceIcon>
      )}
      {/* The action is never elided: it is the row's name (工具名称为必要信息，不可省略). */}
      {titleEl}
      {objectEl}
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
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <div className={cn("flex w-full items-center gap-1 min-w-0", !wrap && "max-w-[80%]", wrap && "items-start")}>
          <TraceCollapsibleTrigger aria-label={ariaLabel} className="max-w-full shrink-0">
            <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="min-w-0" data-expanded={open || undefined}>
              {(icon != null || activeIcon != null) && (
                <TraceIcon className={wrap ? "mt-[2px] self-start" : undefined}>{open && activeIcon != null ? activeIcon : icon}</TraceIcon>
              )}
              {titleEl}
              {description && <TraceDescription className="shrink-0 whitespace-nowrap">{description}</TraceDescription>}
              {duration != null && <span className="shrink-0 tabular-nums">{duration}</span>}
            </TraceLine>
          </TraceCollapsibleTrigger>
          {/* 对象在触发区之外独享让步位：点击同样开合折叠（悬停有整条提示）。 */}
          {objectEl}
          {chips}
          {suffix != null && (
            <span className="shrink-0 whitespace-nowrap">{suffix}</span>
          )}
          {trailing && <span className="shrink-0 pl-2">{trailing}</span>}
          {/* 无对象文本时由占位把行尾动作推到右缘；有对象时 flex-1 已承担。 */}
          {!object && <span className="min-w-0 flex-1" aria-hidden="true" />}
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
