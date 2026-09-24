"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface FileToolbarMode<Mode extends string = string> {
  mode: Mode;
  label: string;
  /** Tooltip for a mode whose meaning is not obvious from its label. */
  title?: string;
}

/** Mode labels shared by every file toolbar: git history and worktree files
 * name the same views the same way. */
export const FILE_MODE_LABELS: Record<string, string> = {
  source: "Source",
  preview: "Preview",
  diff: "Diff",
};

/** The @-mention action button, so both toolbars carry one identical control. */
export function FileMentionButton({ onClick, title, disabled }: { onClick: () => void; title: string; disabled?: boolean }) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={t("files.mention")}
      disabled={disabled}
      className="file-viewer-icon-button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
      </svg>
    </button>
  );
}

interface Props<Mode extends string> {
  /** Navigation or status chips rendered before the path (git diff: back button, status badge). */
  leading?: ReactNode;
  pathLabel: string;
  pathTitle?: string;
  meta: string;
  metaTitle?: string;
  /** Live-watch state for the dot; undefined hides it (deleted file, historical revision). */
  live?: boolean;
  modes?: FileToolbarMode<Mode>[];
  activeMode?: Mode;
  onSelectMode?: (mode: Mode) => void;
  /** Icon buttons; CSS `order: -1` places them before the mode switch. */
  actions?: ReactNode;
  /** Word-wrap state; pass together with `onToggleWrapLines` for a wrapable view. */
  wrapLines?: boolean;
  onToggleWrapLines?: () => void;
  download?: ReactNode;
}

/**
 * The one file toolbar shared by the file viewer and the git commit diff, so
 * both carry the same path/meta header, mode switch and action buttons.
 */
export function FileToolbar<Mode extends string = string>({
  leading, pathLabel, pathTitle, meta, metaTitle, live, modes = [], activeMode, onSelectMode, actions, wrapLines, onToggleWrapLines, download,
}: Props<Mode>) {
  const { t } = useI18n();

  return (
    <div
      className="file-viewer-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-dim)",
        background: "var(--bg)",
        flexShrink: 0,
      }}
    >
      {leading}
      <span className="file-viewer-path" style={{ fontFamily: "var(--font-mono)" }} title={pathTitle ?? pathLabel}>
        {pathLabel}
      </span>

      <span className="file-viewer-meta" title={metaTitle ?? meta}>{meta}</span>
      {live !== undefined && (
        <span
          title={live ? t("i18n.liveSync") : t("i18n.notWatching")}
          aria-label={live ? t("i18n.liveSync") : t("i18n.notWatching")}
          className="file-viewer-live-indicator"
          style={{
            background: live ? "#4ade80" : "var(--border)",
            boxShadow: live ? "0 0 4px #4ade80" : "none",
          }}
        />
      )}

      <div className="file-viewer-controls">
        {modes.length > 1 && activeMode !== undefined && onSelectMode && (
          <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
            {modes.map(({ mode, label, title }) => {
              const active = activeMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onSelectMode(mode)}
                  title={title}
                  aria-pressed={active}
                  className="file-viewer-mode-button"
                  style={{
                    background: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="file-viewer-actions">
          {actions}
          {onToggleWrapLines && (
            <button
              type="button"
              onClick={onToggleWrapLines}
              title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              aria-pressed={wrapLines}
              className="file-viewer-icon-button"
              style={{
                background: wrapLines ? "var(--bg-selected)" : "transparent",
                color: wrapLines ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                <path d="m16 16-2 2 2 2" />
                <path d="M3 18h7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {download}
    </div>
  );
}
