"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * A worktree menu's "New worktree…" body (components/ProjectWorktreePicker.tsx,
 * in the files tab and the bar above a fresh composer): a branch name and
 * Create, shown under the menu's list.
 */
export function WorktreeCreateForm({
  heading,
  busy,
  error,
  showCancel,
  onCreate,
  onCancel,
}: {
  heading: string | null;
  busy: boolean;
  error: string | null;
  showCancel: boolean;
  onCreate: (branch: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [branch, setBranch] = useState("");
  const trimmed = branch.trim();
  const invalid = error !== null;
  const submit = () => {
    if (trimmed && !busy) onCreate(trimmed);
  };
  return (
    // The look arrives as variants over one class string (the retired
    // app/sidebar-menu.css, folded here).
    <div className="sidebar-worktree-form px-2 py-1.5">
      {heading && <div className="sidebar-menu-header overflow-hidden text-muted-foreground text-ellipsis whitespace-nowrap px-2 pt-1.5 pb-1 text-xs">{heading}</div>}
      <Field className="gap-0">
        <Input
          className="sidebar-worktree-input h-auto py-[5px] px-2 rounded-(--radius-sm) bg-background border-(--accent) font-mono text-foreground shadow-none [user-select:text] [-webkit-user-select:text]"
          data-sidebar-menu-autofocus=""
          aria-invalid={invalid || undefined}
          value={branch}
          readOnly={busy}
          placeholder={t("sidebar.branchName")}
          aria-label={t("sidebar.branchName")}
          onChange={(event) => setBranch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            submit();
          }}
        />
      </Field>
      <div className="sidebar-worktree-form-buttons flex gap-[5px] mt-[5px]">
        <Button
          type="button"
          className="sidebar-worktree-create flex-1 h-auto py-1 rounded-(--radius-sm) text-xs font-semibold"
          disabled={busy || !trimmed}
          onClick={submit}
        >
          {busy ? t("sidebar.creating") : t("sidebar.create")}
        </Button>
        {showCancel && (
          <Button
            type="button"
            variant="outline"
            className="sidebar-worktree-cancel flex-1 h-auto py-1 rounded-(--radius-sm) text-xs text-muted-foreground hover:text-muted-foreground bg-secondary"
            onClick={onCancel}
          >
            {t("sidebar.cancel")}
          </Button>
        )}
      </div>
      {error && (
        <FieldError className="sidebar-worktree-error mt-[5px] text-xs leading-[1.35] [overflow-wrap:anywhere]">
          {error}
        </FieldError>
      )}
    </div>
  );
}
