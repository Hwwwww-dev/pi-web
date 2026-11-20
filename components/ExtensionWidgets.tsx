"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnsiText } from "@/components/AnsiText";
import { stripAnsi } from "@/lib/ansi";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { displayLabel } from "@/lib/label-case";
import type { ExtensionWidgetItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CHAT_GLASS_CLASS } from "@/lib/chat-layout";

export const WIDGET_UPDATE_IDLE_MS = 1100;

export function formatExtensionWidgetContent(lines: string[]): string {
  return lines.join("\n");
}

export function snapshotExtensionWidgetContents(
  widgets: ExtensionWidgetItem[],
): Map<string, string[]> {
  return new Map(widgets.map((widget) => [widget.key, [...widget.lines]]));
}

export function getUpdatedExtensionWidgetKeys(
  previous: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>,
): string[] {
  if (!previous) return [];
  return Array.from(next, ([key, lines]) => {
    const previousLines = previous.get(key);
    if (!previousLines || previousLines.length !== lines.length) {
      return previousLines ? key : null;
    }
    return lines.some((line, index) => line !== previousLines[index]) ? key : null;
  }).filter((key): key is string => key !== null);
}

/** A widget whose every line is blank has nothing to show. Extensions pad
 *  their TUI output with blank spacer rows, and expanding such a widget would
 *  render a full-width empty card above the composer. */
function hasVisibleWidgetLines(lines: string[]): boolean {
  return lines.some((line) => stripAnsi(line).trim().length > 0);
}

export function getNextExpandedWidgetKey(
  currentKey: string | null,
  requestedKey: string,
): string | null {
  return currentKey === requestedKey ? null : requestedKey;
}

/** Chip labels name the widget, not its package: `rpiv-todos` is the agent's
 *  todo list, and the chip is the only place that name surfaces. */
const WIDGET_DISPLAY_NAMES: Record<string, string> = { "rpiv-todos": "TODO" };

export function extensionWidgetLabel(key: string): string {
  return WIDGET_DISPLAY_NAMES[key] ?? key;
}

/**
 * `children` (the status line) joins the triggers in one row, so the whole row
 * scrolls sideways together; the expanded panel stays above it, out of the scroll.
 */
export function ExtensionWidgets({ widgets, children }: { widgets: ExtensionWidgetItem[]; children?: ReactNode }) {
  const { t } = useI18n();
  const idPrefix = useId();
  const previousContentsRef = useRef<Map<string, string[]> | null>(null);
  const updateClearTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // 一律收起：面板仅在点击时展开。短 widget 挂载即展开会使底栏在切换会话或 agent 时
  // 自行弹出面板。
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(null);
  const [updatingWidgetKeys, setUpdatingWidgetKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const nextContents = snapshotExtensionWidgetContents(widgets);
    const updatedKeys = getUpdatedExtensionWidgetKeys(
      previousContentsRef.current,
      nextContents,
    );
    previousContentsRef.current = nextContents;

    for (const [key, timer] of updateClearTimersRef.current) {
      if (nextContents.has(key)) continue;
      clearTimeout(timer);
      updateClearTimersRef.current.delete(key);
    }

    setUpdatingWidgetKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => nextContents.has(key)));
      for (const key of updatedKeys) next.add(key);
      if (
        next.size === current.size
        && Array.from(next).every((key) => current.has(key))
      ) return current;
      return next;
    });

    for (const key of updatedKeys) {
      const currentTimer = updateClearTimersRef.current.get(key);
      if (currentTimer) clearTimeout(currentTimer);
      updateClearTimersRef.current.set(key, setTimeout(() => {
        updateClearTimersRef.current.delete(key);
        setUpdatingWidgetKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, WIDGET_UPDATE_IDLE_MS));
    }
  }, [widgets]);

  useEffect(() => () => {
    for (const timer of updateClearTimersRef.current.values()) clearTimeout(timer);
    updateClearTimersRef.current.clear();
  }, []);

  const panelOpen = expandedWidgetKey !== null;
  const expandedWidget = widgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length > 0
  ));

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  return (
    // Radix 驱动面板的开合与出入场动画（Presence 在退场动画期间保持已挂载）：
    // 点击外部与 Escape 由 Popover 关闭，芯片点击仍走自身的开合切换。
    <Popover
      open={panelOpen}
      onOpenChange={(open) => {
        if (!open) setExpandedWidgetKey(null);
      }}
    >
      {expandedWidget && (
        <PopoverContent
          id={`${idPrefix}-panel-${widgets.indexOf(expandedWidget)}`}
          aria-labelledby={`${idPrefix}-trigger-${widgets.indexOf(expandedWidget)}`}
          side="top"
          align="start"
          sideOffset={8}
          // 面板不抢焦点：底部输入框与页面选区保持原状。
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            // 芯片点击在行内自管开合，交给 Popover 反而会把「切到另一个 widget」
            // 变成先关再开。
            if ((event.target as Element | null)?.closest(`[id^="${idPrefix}-trigger-"]`)) {
              event.preventDefault();
            }
          }}
          className="z-(--z-popover) w-[min(460px,calc(100vw-16px))] overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-md data-[state=closed]:pointer-events-none data-[state=open]:duration-150 data-[state=closed]:duration-150"
        >
          <div className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{expandedWidget.key}</div>
          {/* Extension widgets render TUI output: tables, progress bars and box drawing
              only line up while the monospace grid survives, so the panel scrolls
              sideways rather than wrapping a line into a broken row. */}
          <pre className="max-h-40 overflow-auto px-3 py-2 font-mono text-xs/relaxed [font-size:calc(12px+var(--chat-font-size-offset,0px))] [overflow-wrap:normal] whitespace-pre">
            <AnsiText text={formatExtensionWidgetContent(expandedWidget.lines)} />
          </pre>
        </PopoverContent>
      )}
      {/* 定位锚点：底栏左缘、其顶边上的零尺寸点——面板底边在栏顶上方 8px，与旧
          `bottom-full left-0 mb-2` 一致（浮层从 Popover 门户渲染，锚点只是坐标）。 */}
      <PopoverAnchor className="absolute bottom-full left-0 h-0 w-0" />
      <div className="flex min-w-0 flex-1 items-center gap-1 pl-0.5 pr-1.5">
        <div className="flex shrink-0 items-center gap-0.5" aria-label={t("chat.extensionWidgets")}>
          {widgets.map((widget, index) => {
            const expandable = hasVisibleWidgetLines(widget.lines);
            const expanded = expandable && widget.key === expandedWidget?.key;
            const updating = updatingWidgetKeys.has(widget.key);
            const lineCountLabel = t(
              widget.lines.length === 1 ? "chat.extensionWidgetLine" : "chat.extensionWidgetLines",
              { count: widget.lines.length },
            );
            const placementLabel = t(
              widget.placement === "belowEditor"
                ? "chat.extensionWidgetBelow"
                : "chat.extensionWidgetAbove",
            );
            const triggerId = `${idPrefix}-trigger-${index}`;
            const panelId = `${idPrefix}-panel-${index}`;
            // A chip, matching the status pills beside it. The terminal marks a
            // widget above or below the editor with a chevron; here the panel
            // always opens above the row, so the name is the whole chip.
            const triggerClass = cn(
              CHAT_GLASS_CLASS,
              "shrink-0 gap-1.5 font-mono text-xs text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "data-[expanded=true]:bg-accent data-[expanded=true]:text-accent-foreground",
            );
            const content = (
              <>
                {updating && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-warning motion-safe:animate-pulse"
                  />
                )}
                <span className="min-w-0 truncate">{displayLabel(extensionWidgetLabel(widget.key))}</span>
              </>
            );

            // No tooltip: the name is already the trigger's whole text, and the
            // placement/expand line only repeated it in jargon.
            return expandable ? (
              <Button
                key={widget.key}
                id={triggerId}
                type="button"
                variant="outline"
                size="xs"
                data-expanded={expanded || undefined}
                className={triggerClass}
                aria-controls={panelId}
                aria-expanded={expanded}
                aria-label={`${placementLabel}: ${extensionWidgetLabel(widget.key)}, ${lineCountLabel}`}
                onClick={() => toggleWidget(widget)}
              >
                {content}
              </Button>
            ) : (
              // 与相邻状态胶囊形状一致（outline / xs / mono），否则无法对齐。
              <Button
                key={widget.key}
                type="button"
                variant="outline"
                size="xs"
                disabled
                className={cn(CHAT_GLASS_CLASS, "shrink-0 gap-1.5 font-mono text-xs font-normal text-muted-foreground")}
                aria-label={`${placementLabel}: ${extensionWidgetLabel(widget.key)}, ${lineCountLabel}`}
              >
                {content}
              </Button>
            );
          })}
        </div>
        {children}
      </div>
    </Popover>
  );
}
