"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useDelayedUnmount } from "@/hooks/useDelayedUnmount";
import { AnsiText } from "@/components/AnsiText";
import { stripAnsi } from "@/lib/ansi";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ExtensionWidgetItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const DEFAULT_EXPANDED_WIDGET_LINES = 3;
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

function getDefaultExpandedWidgetKey(widgets: ExtensionWidgetItem[]): string | null {
  return widgets.find((widget) => {
    const lineCount = widget.lines.length;
    return lineCount > 1 && lineCount <= DEFAULT_EXPANDED_WIDGET_LINES
      && hasVisibleWidgetLines(widget.lines);
  })?.key ?? null;
}

export function getNextExpandedWidgetKey(
  currentKey: string | null,
  requestedKey: string,
): string | null {
  return currentKey === requestedKey ? null : requestedKey;
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
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(
    () => getDefaultExpandedWidgetKey(widgets),
  );
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

  // The expanded panel plays tw-animate-css's animate-out on close: it stays
  // mounted for the animation (useDelayedUnmount) and keeps the last expanded
  // widget's content while it plays.
  const panelOpen = expandedWidgetKey !== null;
  const panelMounted = useDelayedUnmount(panelOpen);
  const lastExpandedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (expandedWidgetKey) lastExpandedKeyRef.current = expandedWidgetKey;
  }, [expandedWidgetKey]);

  if (widgets.length === 0) return null;

  const expandedWidget = widgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length > 0
  ));
  const panelWidget: ExtensionWidgetItem | null = expandedWidget
    ?? (panelMounted ? widgets.find((widget) => widget.key === lastExpandedKeyRef.current) ?? null : null);

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  const renderPlacementIcon = (widget: ExtensionWidgetItem) => (
    widget.placement === "belowEditor"
      ? <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      : <ChevronUpIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
  );

  return (
    <>
      {(panelOpen || panelMounted) && panelWidget && (
        <ExtensionWidgetPanel
          widget={panelWidget}
          triggerId={`${idPrefix}-trigger-${widgets.indexOf(panelWidget)}`}
          panelId={`${idPrefix}-panel-${widgets.indexOf(panelWidget)}`}
          closing={!panelOpen}
        />
      )}
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
          const triggerClass = cn(
            "shrink-0 gap-1.5 rounded-md px-2 font-mono text-[11.5px] text-muted-foreground",
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
              {renderPlacementIcon(widget)}
              <span className="min-w-0 truncate">{widget.key}</span>
            </>
          );

          // No tooltip: the key is already the trigger's whole text, and the
          // placement/expand line only repeated it in jargon.
          return expandable ? (
            <Button
              key={widget.key}
              id={triggerId}
              type="button"
              variant="ghost"
              size="xs"
              data-expanded={expanded || undefined}
              className={triggerClass}
              aria-controls={panelId}
              aria-expanded={expanded}
              aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
              onClick={() => toggleWidget(widget)}
            >
              {content}
            </Button>
          ) : (
            <span
              key={widget.key}
              className="inline-flex h-6 shrink-0 items-center rounded-md px-2 font-mono text-[11.5px] text-muted-foreground"
              aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
            >
              {content}
            </span>
          );
        })}
      </div>
      {children != null && <Separator orientation="vertical" className="h-5 shrink-0 self-center" />}
      {children}
      </div>
    </>
  );
}

/**
 * Expanded widget content: a small popover-style card above the trigger row.
 */
export function ExtensionWidgetPanel({ widget, triggerId, panelId, closing = false }: {
  widget: ExtensionWidgetItem;
  triggerId: string;
  panelId: string;
  /** True while the exit animation plays; the panel is already logically closed. */
  closing?: boolean;
}) {
  return (
    // Floats above the shelf bar (the bar root is its positioned ancestor): the
    // official popover look — bg-popover, its own border, shadow — detached from
    // the pill row, never nested inside it.
    <section
      id={panelId}
      aria-labelledby={triggerId}
      data-state={closing ? "closed" : "open"}
      // fill-mode-forwards：退场动画播完到 useDelayedUnmount 真正卸载之间
      // 有一帧以上的空档，缺省 fill-mode none 会让面板弹回可见（同抽屉
      // 关闭闪烁的根因）， forwards 把终态钉在透明/缩小上。
      className="absolute bottom-full left-0 z-50 mb-2 w-[min(460px,100%)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md pointer-events-none data-[state=open]:pointer-events-auto data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:fill-mode-forwards"
    >
      <div className="border-b px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{widget.key}</div>
      {/* Extension widgets render TUI output: tables, progress bars and box drawing
          only line up while the monospace grid survives, so the panel scrolls
          sideways rather than wrapping a line into a broken row. */}
      <pre className="max-h-40 overflow-auto px-3 py-2 font-mono text-xs/relaxed [font-size:calc(12px+var(--chat-font-size-offset,0px))] scrollbar-thin [overflow-wrap:normal] whitespace-pre">
        <AnsiText text={formatExtensionWidgetContent(widget.lines)} />
      </pre>
    </section>
  );
}
