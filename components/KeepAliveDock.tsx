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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PathLabel } from "./PathLabel";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./SessionIndicators";

const DRAG_CLICK_THRESHOLD_PX = 6;

/**
 * Edge-docked floating button for the active (keep-alive) chats, with a
 * flyout panel in the minimap's visual language. The button hugs the left
 * edge of the chat area, is vertically draggable (position persisted), and
 * the panel switches between sessions or removes them.
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
  const [open, setOpen] = useState(false);
  const [topPct, setTopPct] = useState(() => loadKeepAliveDockTopPct());
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
  // running agent otherwise); outside presses are Radix's dismissal.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

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
    } else {
      setOpen((current) => !current);
    }
  }, [topPct]);

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
          <PopoverAnchor asChild>
            <Button
              ref={buttonRef}
              type="button"
              variant="ghost"
              className={cn(
                "h-9 gap-1 rounded-l-none rounded-r-lg border border-l-0 bg-sidebar px-[7px] text-muted-foreground shadow-sm select-none [touch-action:none]",
                "hover:bg-secondary hover:text-foreground",
                open && "bg-secondary text-foreground",
              )}
              aria-expanded={open}
              aria-label={`${t("keepalive.title")} (${slots.length})`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {hasRunning && <span className="inline-flex [&_svg]:size-[11px]"><RunningSessionIndicator /></span>}
              {!hasRunning && hasUnread && <span className="inline-flex [&_svg]:size-[11px]"><UnreadSessionIndicator /></span>}
              <LayersIcon className="size-[11px]" aria-hidden="true" />
              <span className="text-xs font-bold tabular-nums">{slots.length}</span>
            </Button>
          </PopoverAnchor>
        </TooltipTrigger>
        <TooltipContent side="right">{t("keepalive.title")}</TooltipContent>
      </Tooltip>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent
          // The dock button toggles on its own pointer-up (a drag ends without
          // a click), so a press on it must not count as an outside dismissal.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            if (buttonRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          // The dock is draggable while the menu is open; the default optimized
          // popper only repositions on scroll/resize, so a dragged anchor would
          // leave the panel behind. Per-frame updates keep the old co-movement.
          updatePositionStrategy="always"
          side="right"
          align="start"
          sideOffset={8}
          alignOffset={-18}
          role="menu"
          aria-label={t("keepalive.title")}
          className="max-h-[min(440px,62vh)] w-[min(320px,calc(100vw-56px))] overflow-y-auto overscroll-contain rounded-xl border-border/75 bg-background p-1.5"
        >
          <div className="flex flex-col">
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
                    "flex shrink-0 items-stretch rounded-md",
                    isSelected ? "bg-accent" : "hover:bg-secondary",
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 flex-col items-stretch justify-start gap-0.5 rounded-md px-2 py-[7px] text-left font-normal hover:bg-transparent hover:text-current"
                    onClick={() => {
                      if (!isSelected) onSelect(info);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate text-xs font-semibold text-foreground">{info.name || info.firstMessage || info.id}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {isRunning && <RunningSessionIndicator />}
                      {isUnread && <UnreadSessionIndicator />}
                      <span className={cn("shrink-0", isRunning ? "text-primary" : isUnread ? "text-success" : "")}>
                        {t(isRunning ? "keepalive.statusRunning" : isUnread ? "keepalive.statusDone" : "keepalive.statusIdle")}
                      </span>
                      <span>{t("sidebar.messagesCount", { count: info.messageCount })}</span>
                      <span title={info.modified}>{formatRelativeTime(info.modified, locale)}</span>
                    </span>
                    <PathLabel
                      text={info.cwd}
                      className="text-[10px] font-mono text-muted-foreground"
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="h-auto w-[30px] rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
            <div className="mt-1 border-t border-border px-1.5 pb-0.5 pt-1">
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start rounded-sm px-2 py-[5px] text-left text-xs font-normal text-muted-foreground hover:bg-destructive/[0.07] hover:text-destructive"
                onClick={() => { onDismissAll(); setOpen(false); }}
              >
                {t("keepalive.dismissAll")}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
