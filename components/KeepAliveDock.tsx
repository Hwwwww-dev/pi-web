"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayersIcon, XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/i18n/format";
import { loadKeepAliveDockTopPct, saveKeepAliveDockTopPct, type KeepAliveSlot } from "@/lib/chat-keepalive";
import type { SessionInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PathLabel } from "./PathLabel";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./SessionIndicators";

const DRAG_CLICK_THRESHOLD_PX = 6;

/**
 * Edge-docked floating button for the active (keep-alive) chats. The button
 * hugs the left edge of the chat area, is vertically draggable (position
 * persisted), and IS the panel: a click expands it in place (zooming out of
 * the pill's spot) and a second click, Escape or an outside press shrinks it
 * back.
 */
export function KeepAliveDock({ slots, sessions, selectedSessionId, runningSessionIds, unreadSessionIds, onSelect, onDismiss, onDismissAll }: {
  slots: KeepAliveSlot[];
  /** Live catalogue (AppShell's copy of the sidebar scan) for fresh counts. */
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelect: (session: SessionInfo) => void;
  onDismiss: (sessionId: string) => void;
  onDismissAll: () => void;
}) {
  const { t, locale } = useI18n();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [topPct, setTopPct] = useState(() => loadKeepAliveDockTopPct());
  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // 面板与胶囊是同一个物体：展开时胶囊隐身，面板从原位长出；收起播放缩回
  // 动画后再卸载（reduced-motion 直接卸载，否则 onAnimationEnd 不会触发）。
  const openPanel = () => {
    setPanelOpen(true);
    setPanelMounted(true);
  };
  const closePanel = () => {
    setPanelOpen(false);
    if (prefersReducedMotion()) setPanelMounted(false);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startTopPx: number; moved: boolean } | null>(null);
  const hasHydratedRef = useRef(false);

  // Restore the persisted position after hydration so SSR markup stays stable.
  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    setTopPct(loadKeepAliveDockTopPct());
  }, []);

  // Escape closes before the global shortcuts see it (Esc also stops the
  // running agent otherwise); outside presses close here (Radix is gone).
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePanel();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePanel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [panelOpen]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const button = buttonRef.current;
    const container = rootRef.current?.parentElement;
    if (!button || !container) return;
    const containerRect = container.getBoundingClientRect();
    dragStateRef.current = {
      startY: event.clientY,
      startTopPx: containerRect.height * (topPct / 100),
      moved: false,
    };
    button.setPointerCapture(event.pointerId);
  }, [topPct]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    const button = buttonRef.current;
    const container = rootRef.current?.parentElement;
    if (!drag || !button || !container) return;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < DRAG_CLICK_THRESHOLD_PX) return;
    drag.moved = true;
    const height = button.offsetHeight || 30;
    const nextPx = Math.min(container.clientHeight - height - 6, Math.max(6, drag.startTopPx + dy));
    setTopPct((nextPx / container.clientHeight) * 100);
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    buttonRef.current?.releasePointerCapture?.(event.pointerId);
    if (!drag) return;
    if (drag.moved) {
      saveKeepAliveDockTopPct(topPct);
    } else if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }, [topPct, panelOpen]);

  if (slots.length === 0) return null;

  const hasRunning = slots.some((slot) => runningSessionIds.has(slot.session.id));
  const hasUnread = slots.some((slot) => !runningSessionIds.has(slot.session.id) && unreadSessionIds.has(slot.session.id));

  return (
    <div
      ref={rootRef}
      className="absolute left-0 z-30 max-[640px]:hidden -translate-y-1/2"
      style={{ top: `${topPct}%` }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
                ref={buttonRef}
                type="button"
                variant="outline"
                size="xs"
                className={cn(
                  // 浮动工具胶囊（shadcn badge 语义）：圆角描边 + 轻投影，图标与
                  // 计数都收在 muted 层次里，运行/未读指示器带颜色。展开时胶囊
                  // 隐身（面板原地覆盖它）。
                  "h-7 gap-1.5 rounded-full bg-background/95 px-2.5 text-xs font-normal text-muted-foreground shadow-sm select-none [touch-action:none] backdrop-blur-sm",
                  "hover:text-foreground",
                  panelMounted && "invisible",
                )}
                aria-expanded={panelOpen}
                aria-label={`${t("keepalive.title")} (${slots.length})`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                {/* 单一状态符号 + 计数：运行=旋转弧、有未读=脉冲点、空闲=层叠
                    图标——互斥出现，不再层叠两个图标挤在胶囊里。 */}
                {hasRunning ? (
                  <span className="inline-flex [&_svg]:size-3"><RunningSessionIndicator /></span>
                ) : hasUnread ? (
                  <span className="inline-flex [&_svg]:size-3"><UnreadSessionIndicator /></span>
                ) : (
                  <LayersIcon className="size-3" aria-hidden="true" />
                )}
                <span className="text-[11px] font-semibold tabular-nums">{slots.length}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t("keepalive.title")}</TooltipContent>
      </Tooltip>

      {/* 面板从胶囊原位长出：外层只做垂直居中定位（避免 translate 与缩放动画
          的 transform 互相覆盖），内层承担 zoom+fade，transform-origin 钉在
          胶囊一侧，展开/收起都从原点出入。展开时胶囊 invisible，二者是同一
          个物体的两个状态。 */}
      {panelMounted && (
        <div className="absolute left-0 top-1/2 z-40 -translate-y-1/2">
          <div
            role="menu"
            aria-label={t("keepalive.title")}
            onAnimationEnd={() => { if (!panelOpen) setPanelMounted(false); }}
            className={cn(
              "w-[min(340px,calc(100vw-56px))] overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg origin-left",
              panelOpen
                ? "animate-in fade-in-0 zoom-in-90 duration-150 motion-reduce:animate-none"
                : "animate-out fade-out-0 zoom-out-90 duration-100 motion-reduce:animate-none",
            )}
          >
          {/* shadcn 菜单惯用法：小标题行 + Separator + 菜单行（accent 悬停/选中），
              关闭钮入行右侧悬停浮现，底部动作走 Separator + 菜单行。 */}
          <div className="flex items-baseline gap-1.5 px-2 pb-1 pt-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("keepalive.title")}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground/70">{slots.length}</span>
          </div>
          <Separator className="mb-1" />
          {/* 滚动条放在内层：外层圆角 + 裁切，滚动条才不会在圆角外侧露出方角。 */}
          <div className="flex max-h-[calc(min(440px,62vh)-8px)] flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {slots.map((slot) => {
              // Counts and timing come from the live catalogue so this panel and
              // the session tree never disagree; the slot snapshot is only the
              // fallback while the list is being refreshed.
              const info = sessions.find((session) => session.id === slot.session.id) ?? slot.session;
              const isSelected = info.id === selectedSessionId;
              const isRunning = runningSessionIds.has(info.id);
              const isUnread = !isRunning && unreadSessionIds.has(info.id);
              return (
                <div
                  key={info.id}
                  className={cn(
                    "group relative flex items-start gap-1 rounded-lg pr-1",
                    isSelected ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-stretch gap-1 rounded-lg px-2 py-2 text-left outline-none"
                    onClick={() => {
                      if (!isSelected) onSelect(info);
                      closePanel();
                    }}
                  >
                    <span className="truncate text-[13px] font-medium text-foreground">{info.name || info.firstMessage || info.id}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      {isRunning && <span className="inline-flex shrink-0 [&_svg]:size-3"><RunningSessionIndicator /></span>}
                      {isUnread && <span className="inline-flex shrink-0 [&_svg]:size-3"><UnreadSessionIndicator /></span>}
                      <span className="shrink-0">{t(isRunning ? "keepalive.statusRunning" : isUnread ? "keepalive.statusDone" : "keepalive.statusIdle")}</span>
                      <span className="shrink-0">{t("sidebar.messagesCount", { count: info.messageCount })}</span>
                      <span className="shrink-0" title={info.modified}>{formatRelativeTime(info.modified, locale)}</span>
                    </span>
                    <PathLabel
                      text={info.cwd}
                      className="text-[11px] font-mono text-muted-foreground/60"
                    />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="mt-1.5 size-6 shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
                    title={t("keepalive.close")}
                    aria-label={`${t("keepalive.close")}: ${info.name || info.id}`}
                    onClick={() => onDismiss(info.id)}
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
          {slots.some((slot) => slot.session.id !== selectedSessionId) && (
            <>
              <Separator className="mt-1" />
              <button
                type="button"
                role="menuitem"
                className="mt-1 flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors outline-none hover:bg-accent/60 hover:text-destructive"
                onClick={() => { onDismissAll(); closePanel(); }}
              >
                {t("keepalive.dismissAll")}
              </button>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
