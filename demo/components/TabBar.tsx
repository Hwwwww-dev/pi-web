"use client";

import { useEffect, useRef } from "react";
import { getFileIcon } from "./FileIcons";
import { BotIcon, GitBranchIcon, MessagesSquareIcon, TerminalIcon, XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal" | "git" | "agent" | "side";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  /** PDF page requested by the link that opened this tab (`#page=N`). */
  page?: number;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);

  // The strip has no scrollbar (globals.css), so a vertical wheel scrolls it
  // sideways. Non-passive: the page must not scroll as well.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);

  // Bring an opened or selected tab into view by moving the strip only:
  // scrollIntoView could also scroll the panels around it.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const strip = list.getBoundingClientRect();
    const { left, right } = tab.getBoundingClientRect();
    if (left < strip.left) list.scrollLeft -= strip.left - left;
    else if (right > strip.right) list.scrollLeft += right - strip.right;
  }, [activeTabId, tabs.length]);

  // The shadcn Tabs shape: one muted track, the active tab is a raised
  // background segment — no floating per-tab pills. The scrollbar is hidden
  // (globals.css .tabbar-scroll): it would squeeze the tabs or clip their
  // tops (#1225).
  return (
    <div
      ref={listRef}
      role="tablist"
      className="tabbar-scroll flex h-[46px] shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-2"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-label={tab.kind === "terminal" ? t("terminal.tabLabel", { name: tab.label }) : tab.kind === "git" ? t("gitPanel.title") : tab.kind === "agent" ? t("subagent.tabLabel", { name: tab.label }) : tab.kind === "side" ? t("sideChat.tabLabel") : tab.label}
            aria-selected={isActive}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                onSelectTab(tabs[next].id);
                (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
              }
            }}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
            className={cn(
              "flex h-7 min-w-20 max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md py-0 pr-1 pl-2.5 whitespace-nowrap text-xs transition-colors",
              isActive
                ? "bg-background font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <span className={cn("flex shrink-0 items-center", isActive ? "opacity-100" : "opacity-70")}>
              {tab.kind === "terminal" ? (
                <TerminalIcon className="size-[13px]" strokeWidth={2} />
              ) : tab.kind === "git" ? (
                <GitBranchIcon className="size-[13px]" strokeWidth={2} />
              ) : tab.kind === "agent" ? (
                <BotIcon className="size-[13px]" strokeWidth={2} />
              ) : tab.kind === "side" ? (
                <MessagesSquareIcon className="size-[13px]" strokeWidth={2} />
              ) : getFileIcon(tab.label, 13)}
            </span>
            <span
              className={cn("min-w-0 flex-1 truncate font-mono text-[11.5px]", isActive ? "font-medium" : "font-normal")}
              title={tab.filePath}
            >
              {tab.kind === "git" ? t("gitPanel.title") : tab.label}
            </span>
            <button
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
              aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.kind === "git" ? t("gitPanel.title") : tab.label}`}
            >
              <XIcon className="size-[11px]" strokeWidth={1.8} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
