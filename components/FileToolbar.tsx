"use client";

import type { ReactNode } from "react";
import { AtSign, WrapText } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={t("files.mention")}
      disabled={disabled}
    >
      <AtSign strokeWidth={1.8} />
    </Button>
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
    <div className="flex min-h-[35px] min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-[5px] text-xs text-dim max-[380px]:gap-1.5 max-[380px]:px-2">
      <PathLabel className="min-w-12 flex-[1_1_auto] overflow-hidden font-mono" text={pathLabel} title={pathTitle ?? pathLabel} />

      <span className="min-w-0 truncate [flex:0_1_auto] max-[640px]:hidden" title={metaTitle ?? meta}>{meta}</span>
      {live !== undefined && (
        <span
          title={live ? t("i18n.liveSync") : t("i18n.notWatching")}
          aria-label={live ? t("i18n.liveSync") : t("i18n.notWatching")}
          className={`size-[7px] shrink-0 rounded-full ${live ? "bg-success shadow-[0_0_4px_var(--color-success)]" : "bg-border"}`}
        />
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {modes.length > 1 && activeMode !== undefined && onSelectMode && (
          <ToggleGroup
            type="single"
            variant="outline"
            value={activeMode}
            // Radix hands back "" when the active item is clicked again; keep the mode.
            onValueChange={(value) => { if (value) onSelectMode(value as Mode); }}
            aria-label={t("i18n.fileViewMode")}
          >
            {modes.map(({ mode, label, title }) => (
              <ToggleGroupItem
                key={mode}
                value={mode}
                title={title}
                className="h-6 border-border px-2 text-xs font-medium max-[380px]:px-1.5"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        <div className="order-first flex h-6 shrink-0 items-center gap-1">
          {actions}
          {onToggleWrapLines && (
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={onToggleWrapLines}
              title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              aria-pressed={wrapLines}
              className={wrapLines ? "bg-accent text-foreground" : undefined}
            >
              <WrapText strokeWidth={1.8} />
            </Button>
          )}
        </div>
      </div>

      {download}
    </div>
  );
}
