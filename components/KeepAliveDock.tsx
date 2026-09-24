"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { loadKeepAliveDockTopPct, saveKeepAliveDockTopPct, type KeepAliveSlot } from "@/lib/chat-keepalive";
import type { SessionInfo } from "@/lib/types";
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startTopPx: number; moved: boolean } | null>(null);
  const hasHydratedRef = useRef(false);

  // Restore the persisted position after hydration so SSR markup stays stable.
  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    setTopPct(loadKeepAliveDockTopPct());
  }, []);

  // Close on Escape and on pointer presses outside button + panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
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
    <div ref={rootRef} className="keepalive-dock" style={{ top: `${topPct}%` }}>
      <button
        ref={buttonRef}
        type="button"
        className={`keepalive-dock-button${open ? " is-open" : ""}${hasRunning ? " is-running" : ""}`}
        aria-expanded={open}
        aria-label={`${t("keepalive.title")} (${slots.length})`}
        title={t("keepalive.title")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {hasRunning && <span className="keepalive-dock-running"><RunningSessionIndicator /></span>}
        {!hasRunning && hasUnread && <span className="keepalive-dock-unread"><UnreadSessionIndicator /></span>}
        <span className="keepalive-dock-count">{slots.length}</span>
      </button>

      {open && (
        <div ref={panelRef} className="keepalive-dock-panel" role="menu" aria-label={t("keepalive.title")}>
          <div className="keepalive-dock-list">
            {slots.map((slot) => {
              // Counts and timing come from the live catalogue so this panel and
              // the session tree never disagree; the slot snapshot is only the
              // fallback while the list is being refreshed.
              const info = sessions.find((session) => session.id === slot.session.id) ?? slot.session;
              const isSelected = info.id === selectedSessionId;
              const isRunning = runningSessionIds.has(info.id);
              const isUnread = !isRunning && unreadSessionIds.has(info.id);
              return (
                <div key={info.id} className={`keepalive-dock-row${isSelected ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="keepalive-dock-open"
                    onClick={() => {
                      if (!isSelected) onSelect(info);
                      setOpen(false);
                    }}
                  >
                    <span className="keepalive-dock-name">{info.name || info.firstMessage || info.id}</span>
                    <span className="keepalive-dock-meta">
                      {isRunning && <RunningSessionIndicator />}
                      {isUnread && <UnreadSessionIndicator />}
                      <span className={`keepalive-dock-status${isRunning ? " is-running" : isUnread ? " is-done" : ""}`}>
                        {t(isRunning ? "keepalive.statusRunning" : isUnread ? "keepalive.statusDone" : "keepalive.statusIdle")}
                      </span>
                      <span>{t("sidebar.messagesCount", { count: info.messageCount })}</span>
                      <span title={info.modified}>{formatRelativeTime(info.modified, locale)}</span>
                    </span>
                    <PathLabel
                      text={info.cwd}
                      style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}
                    />
                  </button>
                  {!isSelected && (
                    <button
                      type="button"
                      className="keepalive-dock-close"
                      title={t("keepalive.close")}
                      aria-label={`${t("keepalive.close")}: ${info.name || info.id}`}
                      onClick={() => onDismiss(info.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {slots.some((slot) => slot.session.id !== selectedSessionId) && (
            <div className="keepalive-dock-footer">
              <button type="button" className="keepalive-dock-dismiss-all" onClick={() => { onDismissAll(); setOpen(false); }}>
                {t("keepalive.dismissAll")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
