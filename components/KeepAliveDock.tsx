"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayersIcon, XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/i18n/format";
import { loadKeepAliveDockTopPct, saveKeepAliveDockTopPct, type KeepAliveSlot } from "@/lib/chat-keepalive";
import type { SessionInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { PathLabel } from "./PathLabel";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./SessionIndicators";

const DRAG_CLICK_THRESHOLD_PX = 6;
/** 伸长动画时长（220ms）；transitionend 缺席（reduced motion、中断）时的兜底开面板时限。 */
const STRETCH_FALLBACK_MS = 300;

/**
 * Edge-docked capsule for the active (keep-alive) chats. The capsule hugs the
 * left edge (square on the dock side, a pill on the free side), is vertically
 * draggable (position persisted), and opens the shadcn Popover beside it in
 * two stages: click stretches the capsule to reveal the active task's title,
 * and only when the stretch has finished does the panel unfold (the popover's
 * own fade + slide). Escape is intercepted here first so the global shortcut
 * doesn't stop the agent.
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
  /** idle: collapsed; stretching: growing (panel still shut); open: panel shown, capsule kept long. */
  const [phase, setPhase] = useState<"idle" | "stretching" | "open">("idle");
  const [topPct, setTopPct] = useState(() => loadKeepAliveDockTopPct());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startTopPx: number; moved: boolean } | null>(null);
  const dragMovedRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const stretchTimerRef = useRef(0);
  const panelOpen = phase === "open";

  // Restore the persisted position after hydration so SSR markup stays stable.
  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    setTopPct(loadKeepAliveDockTopPct());
  }, []);

  const clearStretchTimer = useCallback(() => {
    if (stretchTimerRef.current) {
      window.clearTimeout(stretchTimerRef.current);
      stretchTimerRef.current = 0;
    }
  }, []);

  // Escape closes here first and stops propagation: the global shortcut would
  // otherwise stop the running agent (Esc stacking). Radix's own Escape path
  // never sees the event — the controlled open has already flipped false.
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPhase("idle");
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [panelOpen]);

  useEffect(() => clearStretchTimer, [clearStretchTimer]);

  const openPanel = useCallback(() => {
    clearStretchTimer();
    setPhase("open");
  }, [clearStretchTimer]);

  const handleTriggerClick = useCallback(() => {
    // A drag ends with a click on the capsule; that click must not open.
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    if (phase === "stretching") return;
    if (phase === "open") {
      setPhase("idle");
      return;
    }
    // 伸长完成后自动展开面板；reduced motion 没有过渡事件，直接开。
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("open");
      return;
    }
    setPhase("stretching");
    clearStretchTimer();
    stretchTimerRef.current = window.setTimeout(openPanel, STRETCH_FALLBACK_MS);
  }, [phase, openPanel, clearStretchTimer]);

  // 伸长到位（宽度过渡结束）即开面板；兜底定时器两条路只走一条。
  const handleStretchEnd = useCallback((event: React.TransitionEvent) => {
    if (event.target !== event.currentTarget || event.propertyName !== "max-width") return;
    openPanel();
  }, [openPanel]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const button = buttonRef.current;
    const container = rootRef.current?.parentElement;
    if (!button || !container) return;
    dragMovedRef.current = false;
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
    dragMovedRef.current = true;
    const height = button.offsetHeight || 30;
    const nextPx = Math.min(container.clientHeight - height - 6, Math.max(6, drag.startTopPx + dy));
    setTopPct((nextPx / container.clientHeight) * 100);
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    buttonRef.current?.releasePointerCapture?.(event.pointerId);
    if (drag?.moved) saveKeepAliveDockTopPct(topPct);
  }, [topPct]);

  if (slots.length === 0) return null;

  const hasRunning = slots.some((slot) => runningSessionIds.has(slot.session.id));
  const hasUnread = slots.some((slot) => !runningSessionIds.has(slot.session.id) && unreadSessionIds.has(slot.session.id));
  // 伸长态露出的那一条：运行中的优先，其次有未读的，最后只是计数。
  const featured = slots.find((slot) => runningSessionIds.has(slot.session.id))
    ?? slots.find((slot) => !runningSessionIds.has(slot.session.id) && unreadSessionIds.has(slot.session.id));
  const featuredInfo = featured ? sessions.find((session) => session.id === featured.session.id) ?? featured.session : null;
  const featuredTitle = featuredInfo
    ? featuredInfo.name || featuredInfo.firstMessage || featuredInfo.id
    : t("keepalive.title");

  return (
    <div
      ref={rootRef}
      className="absolute left-0 z-30 -translate-y-1/2"
      style={{ top: `${topPct}%` }}
    >
      {/* 面板受控自持：点击先伸长、到位再开。PopoverAnchor 只提供锚点，
          不像 Trigger 那样接管点击。 */}
      <Popover open={panelOpen} onOpenChange={(next) => { if (!next) setPhase("idle"); }}>
        <PopoverAnchor asChild>
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              // 左贴边长条胶囊：贴靠侧直角，另一侧全圆角。ghost 语义——无
              // 边框无底色，压过内容处 backdrop-blur；面板开着时同 AppShell
              // 的按钮惯例压上 accent。
              "h-7 max-w-[min(260px,44vw)] rounded-none rounded-r-full bg-background/95 px-2.5 text-xs font-normal text-muted-foreground shadow-sm select-none [touch-action:none] backdrop-blur-sm",
              "hover:text-foreground",
              panelOpen && "bg-accent text-foreground",
            )}
            aria-label={`${t("keepalive.title")} (${slots.length})`}
            aria-expanded={panelOpen}
            aria-haspopup="menu"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onClick={handleTriggerClick}
          >
            {/* 单一状态符号 + 计数：运行=旋转弧、有未读=脉冲点、空闲=层叠
                图标——互斥出现。 */}
            {hasRunning ? (
              <span className="inline-flex [&_svg]:size-3"><RunningSessionIndicator /></span>
            ) : hasUnread ? (
              <span className="inline-flex [&_svg]:size-3"><UnreadSessionIndicator /></span>
            ) : (
              <LayersIcon className="size-3" aria-hidden="true" />
            )}
            <span className="text-[11px] font-semibold tabular-nums">{slots.length}</span>
            {/* 伸长段：宽度 0→内容宽，宽度过渡结束（onTransitionEnd）开面板。 */}
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap text-[11px] transition-[max-width,opacity] duration-[220ms] ease-out motion-reduce:transition-none",
                phase === "idle" ? "max-w-0 opacity-0 duration-200" : "max-w-[220px] opacity-100",
              )}
              onTransitionEnd={handleStretchEnd}
            >
              <span className="pl-1.5">{featuredTitle}</span>
            </span>
          </Button>
        </PopoverAnchor>

        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          role="menu"
          aria-label={t("keepalive.title")}
          className="w-[min(340px,calc(100vw-56px))] overflow-hidden rounded-xl p-1.5"
        >
          {/* 头部一行收纳计数与「全部移出」；行内信息层级：标题 →
              状态词 · 消息数 · 时间 → 路径。 */}
          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5">
            <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("keepalive.title")}
              <span className="text-[11px] font-normal tabular-nums text-muted-foreground/70">{slots.length}</span>
            </span>
            {slots.some((slot) => slot.session.id !== selectedSessionId) && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 rounded-full px-2 text-[11px] font-normal text-muted-foreground hover:bg-accent/60 hover:text-destructive"
                onClick={() => { onDismissAll(); setPhase("idle"); }}
              >
                {t("keepalive.dismissAll")}
              </Button>
            )}
          </div>
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
                    "group relative flex items-center gap-1 rounded-lg pr-1 transition-colors",
                    // 当前会话一眼可辨：primary 淡底 + 左缘指示条（暗色的
                    // primary 近白、亮色近黑，两边都醒目），不再是描边盒子。
                    isSelected ? "bg-primary/10" : "hover:bg-accent/60",
                  )}
                >
                  {isSelected && <span aria-hidden="true" className="absolute left-0 top-1/2 h-[60%] w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
                  <Button
                    type="button"
                    role="menuitem"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-transparent"
                    onClick={() => {
                      if (!isSelected) onSelect(info);
                      setPhase("idle");
                    }}
                  >
                    <span className="truncate text-[13px] font-medium text-foreground" title={info.name || info.firstMessage || info.id}>{info.name || info.firstMessage || info.id}</span>
                    <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      {isRunning && <span className="inline-flex shrink-0 [&_svg]:size-3"><RunningSessionIndicator /></span>}
                      {isUnread && <span className="inline-flex shrink-0 [&_svg]:size-3"><UnreadSessionIndicator /></span>}
                      <span className="shrink-0">{t(isRunning ? "keepalive.statusRunning" : isUnread ? "keepalive.statusDone" : "keepalive.statusIdle")}</span>
                      <span aria-hidden="true" className="text-muted-foreground/50">·</span>
                      <span className="shrink-0">{t("sidebar.messagesCount", { count: info.messageCount })}</span>
                      <span aria-hidden="true" className="text-muted-foreground/50">·</span>
                      <span className="shrink-0" title={info.modified}>{formatRelativeTime(info.modified, locale)}</span>
                    </span>
                    <PathLabel
                      text={info.cwd}
                      className="text-[11px] font-mono text-muted-foreground/50"
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-6 shrink-0 self-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
