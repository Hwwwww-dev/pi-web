"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse } from "@/lib/session-search";

export function SessionSearch({ open, query, children, selectedSessionId, onSelectSession, archivedSessionIds }: {
  open: boolean;
  query: string;
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
  /** Ids of every session in an archived family: their results are tagged, not hidden. */
  archivedSessionIds?: ReadonlySet<string>;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ query: string; response?: SessionSearchResponse; failed?: boolean }>({ query: "" });
  const search = query.trim();
  const response = state.query === search ? state.response : undefined;
  const failed = state.query === search && state.failed;

  // Re-runs only when the query changes. It deliberately does not depend on the
  // session-list version: ordinary agent activity bumps that version every few
  // seconds, which used to refetch (and re-order) results while they were being
  // read.
  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setState({ query: search });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/search?${new URLSearchParams({ q: search })}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as SessionSearchResponse;
        if (!controller.signal.aborted) setState({ query: search, response: data });
      } catch {
        if (!controller.signal.aborted) setState({ query: search, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  return !open || !search ? children : (
    <div className="min-h-20 flex-1 overflow-y-auto" aria-busy={!response && !failed}>
      <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
        {failed ? t("sidebar.sessionSearchFailed") : !response ? t("sidebar.sessionSearching")
          : response.results.length === 0 ? t("sidebar.sessionSearchEmpty")
          : t("sidebar.sessionSearchCount", { count: response.results.length })}
      </div>
      {response?.truncated && (
        <div role="status" className="px-3 pb-2 text-xs text-muted-foreground">{t("sidebar.sessionSearchPartial")}</div>
      )}
      {response?.results.map(({ session, entryId, blockIndex, titleMatch, before, match, after }) => (
        <Button
          key={session.id}
          type="button"
          variant="ghost"
          size="default"
          onClick={() => onSelectSession(session, entryId, blockIndex)}
          aria-current={session.id === selectedSessionId ? "true" : undefined}
          className={`h-auto justify-start rounded-none font-normal whitespace-normal block w-full cursor-pointer border-b border-border px-3 py-2 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-0 focus-visible:border-transparent ${session.id === selectedSessionId ? "bg-accent" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-xs font-medium text-foreground">
              {titleMatch ? <>{before}<mark className="rounded-sm bg-primary/20 text-foreground">{match}</mark>{after}</> : session.name || session.firstMessage}
            </span>
            {archivedSessionIds?.has(session.id) && (
              <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] leading-[14px] text-muted-foreground">{t("sidebar.archived")}</span>
            )}
          </span>
          <span className="mt-1 flex min-w-0 gap-2 text-[10px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" title={session.cwd}>{session.cwd}</span>
            <span className="shrink-0">{formatRelativeTime(session.modified, locale)}</span>
          </span>
          {!titleMatch && (
            <span className="mt-1 block text-xs leading-relaxed wrap-anywhere text-muted-foreground">
              {before}<mark className="rounded-sm bg-primary/20 text-foreground">{match}</mark>{after}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
