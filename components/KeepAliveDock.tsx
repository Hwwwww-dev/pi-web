"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LayersIcon, XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/i18n/format";
import { loadKeepAliveDockTopPct, saveKeepAliveDockTopPct, type KeepAliveSlot } from "@/lib/chat-keepalive";
import type { SessionInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PathLabel } from "./PathLabel";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./SessionIndicators";

const DRAG_CLICK_THRESHOLD_PX = 6;
/** 面板可读的最低可见高度：低于它在哪侧都放不下时，选剩余空间更大的一侧并压到该侧余量。 */
const PANEL_MIN_VISIBLE_PX = 176;
/** 面板与胶囊边缘的间隙。 */
const PANEL_GAP_PX = 4;

/**
 * Edge-docked capsule for the active (keep-alive) chats. The capsule hugs the
 * left edge (square on the dock side, a pill on the free side), is vertically
 * draggable (position persisted), and unfolds into the session panel in one
 * continuous motion: the capsule stretches to reveal the active task's title
 * while the panel fades out of the capsule's edge — capsule and panel are one
 * column, never a floating island. The panel shell stays mounted (invisible
 * when closed) so opening and closing are the same smooth transition. Escape
 * is intercepted here first so the global shortcut doesn't stop the agent.
 */
export function KeepAliveDock({ slots, sessions, selectedSessionId, runningSessionIds, unreadSessionIds, onSelect, onDismiss }: {
  slots: KeepAliveSlot[];
  /** Live catalogue (AppShell's copy of the sidebar scan) for fresh counts. */
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelect: (session: SessionInfo) => void;
  onDismiss: (sessionId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [topPct, setTopPct] = useState(() => loadKeepAliveDockTopPct());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startTopPx: number; moved: boolean } | null>(null);
  const dragMovedRef = useRef(false);
  const hasHydratedRef = useRef(false);
  /** 面板展开方向与高度预算：下方放不下就向上长，二者都以视口边缘封顶。 */
  const [placement, setPlacement] = useState<{ up: boolean; maxH: number } | null>(null);

  // 开面板（以及开着拖动）时按胶囊在视口里的实际位置决定向上/向下与最大高度，
  // 面板永不溢出可视范围。关闭时也保留最后一次的预算：面板壳层常挂载，
  // 下次展开从既有位置过渡，不会跳变。
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - PANEL_GAP_PX;
    const above = rect.top - PANEL_GAP_PX;
    const up = below < PANEL_MIN_VISIBLE_PX && above > below;
    setPlacement({ up, maxH: Math.max(PANEL_MIN_VISIBLE_PX, Math.floor(up ? above : below)) });
  }, [open, topPct]);

  // Restore the persisted position after hydration so SSR markup stays stable.
  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    setTopPct(loadKeepAliveDockTopPct());
  }, []);

  const closePanel = useCallback(() => setOpen(false), []);

  // Escape closes here first and stops propagation: the global shortcut would
  // otherwise stop the running agent (Esc stacking). 点在面板/胶囊之外同样关闭
  // （此前由 Popover 的 outside 检测负责）。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePanel();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      closePanel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, closePanel]);

  const handleTriggerClick = useCallback(() => {
    // A drag ends with a click on the capsule; that click must not toggle.
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    setOpen((prev) => !prev);
  }, []);

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
          open && "bg-accent text-foreground",
        )}
        aria-label={`${t("keepalive.title")} (${slots.length})`}
        aria-expanded={open}
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
        {/* 伸长段：宽度 0→内容宽的裁切揭示，与面板展开同时进行。 */}
        <span
          className={cn(
            "overflow-hidden whitespace-nowrap text-[11px] transition-[max-width,opacity] duration-[220ms] ease-out motion-reduce:transition-none",
            open ? "max-w-[220px] opacity-100" : "max-w-0 opacity-0 duration-200",
          )}
        >
          <span className="pl-1.5">{featuredTitle}</span>
        </span>
      </Button>

      {/* 一体面板：挂在胶囊边缘（同左缘），胶囊与列表构成一个纵向整体，
          不再是旁边独立的浮层。absolute 使其不参与高度——开合不移动胶囊的
          拖动定位（root 的 -translate-y-1/2 始终只锚胶囊）。向下放不下时
          整体向上长，maxHeight 由视口余量给出，永不溢出可视范围。
          壳层常挂载，invisible + opacity + translate 过渡：开与关是同一段
          200ms 运动，不再有「伸长完才弹出」的两段停顿；visibility 的离散
          插值保证关闭动画播完才真正隐藏、隐藏态不参与绘制与命中。 */}
      <div
        role="menu"
        aria-label={t("keepalive.title")}
        aria-hidden={!open}
        style={{ maxHeight: placement?.maxH }}
        className={cn(
          "absolute left-0 flex w-[min(340px,calc(100vw-56px))] flex-col overflow-hidden rounded-xl border border-border bg-background/95 p-1.5 shadow-md backdrop-blur-sm",
          "transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none",
          placement?.up ? "bottom-full mb-1" : "top-full mt-1",
          open ? "visible opacity-100" : "invisible opacity-0",
          placement?.up
            ? open ? "translate-y-0" : "translate-y-1"
            : open ? "translate-y-0" : "-translate-y-1",
        )}
      >
        {/* 无头部：计数在胶囊上，关闭靠失焦、Esc 或再点胶囊，逐行移出
            在行尾。行内信息层级：标题 → 状态词 · 消息数 · 时间 → 路径。 */}
        {/* 滚动条放在内层：面板由 maxHeight 封顶、行列表 flex-1 min-h-0
            消化剩余空间，超高即内层滚动；外层圆角 + 裁切，滚动条不会在
            圆角外侧露出方角。 */}
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
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
                  "relative flex items-center gap-1 rounded-lg pr-1 transition-colors",
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
                    closePanel();
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
                  className="size-6 shrink-0 self-center rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
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
      </div>
    </div>
  );
}
