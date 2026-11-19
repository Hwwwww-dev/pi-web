"use client";

import { BellRing, CheckCircle2, X } from "lucide-react";

export type SessionToastKind = "complete" | "attention";

/**
 * The in-page counterpart of the system notification: a small clickable card
 * (sonner renders it through `toast.custom`) announcing that a session not on
 * screen finished or needs input. Clicking anywhere on the card opens the
 * session; the X only dismisses. Both actions are provided by the caller —
 * the card itself knows nothing about sessions or routing.
 */
export function SessionEventToast({
  kind,
  sessionName,
  message,
  dismissLabel,
  onOpen,
  onClose,
}: {
  kind: SessionToastKind;
  sessionName: string;
  message: string;
  dismissLabel: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const Icon = kind === "complete" ? CheckCircle2 : BellRing;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="flex w-[340px] max-w-[calc(100vw-2rem)] cursor-pointer items-start gap-2.5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg transition-colors hover:bg-accent"
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.8}
        className={`mt-0.5 size-4 shrink-0 ${kind === "complete" ? "text-success" : "text-amber-600 dark:text-amber-400"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{sessionName}</div>
        <div className="truncate text-xs text-muted-foreground" title={message}>{message}</div>
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
