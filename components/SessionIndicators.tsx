"use client";

import { useI18n } from "@/hooks/useI18n";
import { Spinner } from "@/components/ui/spinner";

/**
 * Per-session status indicators shared by the sidebar tree and the
 * keep-alive dock: a spinning running arc and a pulsing unread dot.
 */
export function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-primary"
    >
      {/* sidebar-spin (the retired app/sidebar-menu.css, folded here). */}
      <Spinner className="sidebar-spin size-3.5 shrink-0 [animation-duration:0.9s]" strokeWidth={2.8} aria-hidden="true" />
    </span>
  );
}

export function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-primary"
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <span className="absolute size-2 rounded-full bg-primary opacity-40 motion-safe:animate-ping" />
        <span className="relative size-[5px] rounded-full bg-primary" />
      </span>
    </span>
  );
}
