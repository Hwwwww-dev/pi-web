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
 *
 * `variant="card"` is the tool-call presentation (设计④ 统一卡头): the row is a
 * bordered card whose head carries the status dot + title + duration and folds
 * the body inside the same box — thinking rows and group heads stay lines.
 */

const STATUS_ATTR = {
  running: "running",
  error: "error",
  pending: "pending",
  done: undefined,
} as const;

/** 统一卡头的状态点：运行呼吸（info 环脉动）、成功绿点、失败红点、待命灰。
 *  软环沿用侧边栏状态点的伪元素写法（session-tree-status-pulse 同款）。 */
function StatusDot({ status, className }: { status: ToolViewStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative size-[7px] shrink-0 rounded-full",
        status === "running" && "bg-info after:absolute after:-inset-[3px] after:animate-[session-tree-status-pulse_1.6s_ease-in-out_infinite] after:rounded-full after:border-[1.4px] after:border-info after:opacity-35 motion-reduce:after:animate-none",
        status === "done" && "bg-success after:absolute after:-inset-[3px] after:rounded-full after:border-[1.4px] after:border-success after:opacity-35",
        status === "error" && "bg-destructive after:absolute after:-inset-[3px] after:rounded-full after:border-[1.4px] after:border-destructive after:opacity-35",
        status === "pending" && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

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
 * 被截断文本右缘的一小段渐变淡出：省略号处不再是硬边，文本没截断时
 * 该段覆盖在空背景上不可见。
 */
function FadeOut({ widthClass = "w-5" }: { widthClass?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-r from-transparent to-background", widthClass)}
    />
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
  variant = "line",
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
  /** `card` = 工具卡统一卡头（状态点 + 标题 + 耗时 + 动作，内容在卡内折叠）。 */
  variant?: "line" | "card";
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
      <span className={wrap ? "whitespace-normal break-words" : "block truncate"}>{object}</span>
      {!wrap && <FadeOut />}
    </span>
  );
  // 文件胶囊与行本身均为按钮，HTML 不允许按钮嵌套（移动端内层还会截获点击）。
  // 触发区只承载不可压缩的「图标+工具名+耗时」，胶囊/对象/计数都是它的兄弟节点。
  const line = (withChips: boolean, withTrailing = true) => (
    <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="min-w-0 overflow-hidden" data-expanded={open || undefined}>
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

  // ── 统一卡头（工具卡）───────────────────────────────────────────────
  // 头行 = 状态点 + 标题（+对象/胶囊/计数）+ 耗时 + 行尾动作；内容折叠进同一张
  // 卡片，不再用左缘竖线缩进。类别图标让位给状态点：状态一眼可辨，动作由标题
  // 与文件胶囊说明。
  if (variant === "card") {
    const head = (
      <div
        className={cn(
          "flex w-full max-w-full min-w-0 items-center gap-1.5 rounded-[inherit] px-2 py-1.5 transition-colors",
          open ? "bg-muted/50" : "hover:bg-accent/50",
          wrap && "items-start",
        )}
      >
        <TraceCollapsibleTrigger aria-label={ariaLabel} className="max-w-full min-w-0 shrink-0 rounded-md">
          <TraceLine status={STATUS_ATTR[status]} title={ariaLabel} className="min-w-0" data-expanded={open || undefined}>
            <StatusDot status={status} className={wrap ? "mt-[6.5px] self-start" : "self-center"} />
            {titleEl}
            {description && <TraceDescription className="shrink-0 whitespace-nowrap">{description}</TraceDescription>}
            {duration != null && <span className="shrink-0 tabular-nums">{duration}</span>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        {/* 对象在触发区之外独享让步位：点击同样开合折叠（悬停有整条提示）。 */}
        {objectEl}
        {chips}
        {suffix != null && <span className="shrink-0 whitespace-nowrap">{suffix}</span>}
        {trailing && <span className="shrink-0 pl-1 tabular-nums">{trailing}</span>}
        {/* 无对象文本时由占位把行尾动作推到右缘；有对象时 flex-1 已承担。 */}
        {!object && <span className="min-w-0 flex-1" aria-hidden="true" />}
        {actions}
      </div>
    );

    // 无内容的卡不渲染折叠区：触发器仍需在 Collapsible 根内（Radix 上下文要求）。
    return (
      <Trace
        ref={rowRef}
        data-activity="trace-row"
        data-activity-tool={activityTool}
        data-status={STATUS_ATTR[status]}
        className="overflow-hidden rounded-lg border bg-card shadow-xs"
      >
        <TraceCollapsible open={open} onOpenChange={onOpenChange} className="min-w-0">
          {head}
          {content && (
            // 展开区不设高度上限：代码块、思考块各自限高即可，两层同时限高会出现两个滚动条。
            <TraceCollapsibleContent className="mt-0 mb-0 ml-0 flex flex-col gap-2 border-l-0 pl-3 pr-3 pb-3 pt-2.5 [&>*]:min-w-0">
              {stepUsage && (
                <div className="text-xs">
                  <UsageBar usage={stepUsage} gap={10} />
                </div>
              )}
              {content}
              {children}
            </TraceCollapsibleContent>
          )}
        </TraceCollapsible>
        {below}
      </Trace>
    );
  }

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
        <div className={cn("flex w-full max-w-full items-center gap-1 min-w-0", wrap && "items-start")}>
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
