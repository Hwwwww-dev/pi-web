"use client";

import type { ReactNode } from "react";
import { AtSign, WrapText } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { PathLabel } from "./PathLabel";

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
      <AtSign size={14} strokeWidth={1.8} />
    </button>
  );
}

interface Props<Mode extends string> {
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
  pathLabel, pathTitle, meta, metaTitle, live, modes = [], activeMode, onSelectMode, actions, wrapLines, onToggleWrapLines, download,
}: Props<Mode>) {
  const { t } = useI18n();

  return (
    <div className="file-viewer-toolbar flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-[5px] text-xs text-dim">
      <PathLabel className="file-viewer-path font-mono" text={pathLabel} title={pathTitle ?? pathLabel} />

      <span className="file-viewer-meta" title={metaTitle ?? meta}>{meta}</span>
      {live !== undefined && (
        <span
          title={live ? t("i18n.liveSync") : t("i18n.notWatching")}
          aria-label={live ? t("i18n.liveSync") : t("i18n.notWatching")}
          className={`file-viewer-live-indicator ${live ? "bg-success shadow-[0_0_4px_var(--color-success)]" : "bg-border"}`}
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
                  className={`file-viewer-mode-button ${active ? "bg-accent text-foreground" : "text-muted-foreground"}`}
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
              // The unlayered `.file-viewer-icon-button` rule sets background/color, so
              // the active state must stay an inline override to win over it (and keep
              // losing to its own :hover rule).
              style={wrapLines ? { background: "var(--bg-selected)", color: "var(--text)" } : undefined}
            >
              <WrapText size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {download}
    </div>
  );
}
