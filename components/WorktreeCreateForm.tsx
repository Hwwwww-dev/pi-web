"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SIDEBAR_MENU_FOCUS_RING as FOCUS_RING } from "./SidebarMenu";

/**
 * A worktree menu's "New worktree…" body (components/ProjectWorktreePicker.tsx,
 * in the files tab and the bar above a fresh composer): a branch name and
 * Create. On a phone the sheet brings its own Cancel and title; in the files
 * tab's classic menu it shows under the list, as on main.
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
  const submit = () => {
    if (trimmed && !busy) onCreate(trimmed);
  };
  return (
    // The classic menu's look, the sheet's and the desktop bar's arrive as
    // variants over one class string (the retired app/sidebar-menu.css,
    // folded here); the menu's `is-classic` box and the sheet's ancestors
    // pick them.
    <div className="sidebar-worktree-form px-1 pt-0.5 pb-1 [.is-classic_&]:px-2 [.is-classic_&]:py-1.5 [.sidebar-sheet_&]:px-4 [.sidebar-sheet_&]:pt-2.5 [.sidebar-sheet_&]:pb-1">
      {heading && <div className="sidebar-menu-header overflow-hidden text-(--text-dim) text-ellipsis whitespace-nowrap px-2 pt-1.5 pb-1 text-[11px] [.sidebar-sheet_&]:px-4 [.sidebar-sheet_&]:pt-2 [.sidebar-sheet_&]:pb-1 [.sidebar-sheet_&]:text-xs">{heading}</div>}
      <input
        className="sidebar-worktree-input block w-full h-7 px-2 box-border border border-(--accent) rounded-(--radius-sm) outline-none bg-(--bg) text-(--text) font-mono text-[11.5px] [user-select:text] [-webkit-user-select:text] [.is-classic_&]:h-auto [.is-classic_&]:py-[5px] [.is-classic_&]:text-[11px] [.sidebar-sheet_&]:h-10 [.sidebar-sheet_&]:text-sm"
        data-sidebar-menu-autofocus=""
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
      <div className="sidebar-worktree-form-buttons flex gap-1.5 mt-1.5 [.is-classic_&]:gap-[5px] [.is-classic_&]:mt-[5px]">
        <button type="button" className={["sidebar-worktree-create", "flex-1 h-[26px] border border-(--accent) rounded-(--radius-sm) bg-(--accent) text-(--accent-contrast) text-xs font-semibold cursor-pointer", "disabled:cursor-not-allowed disabled:opacity-50", FOCUS_RING, "[.is-classic_&]:h-auto [.is-classic_&]:py-1 [.is-classic_&]:text-[11px] [.sidebar-sheet_&]:h-10 [.sidebar-sheet_&]:text-sm"].join(" ")} disabled={busy || !trimmed} onClick={submit}>
          {busy ? t("sidebar.creating") : t("sidebar.create")}
        </button>
        {showCancel && (
          <button type="button" className={["sidebar-worktree-cancel", "flex-1 h-[26px] border border-(--border) rounded-(--radius-sm) bg-(--bg) text-(--text-muted) text-xs cursor-pointer hover:bg-(--bg-hover)", FOCUS_RING, "[.is-classic_&]:h-auto [.is-classic_&]:py-1 [.is-classic_&]:bg-(--bg-hover) [.is-classic_&]:text-[11px] [.sidebar-sheet_&]:h-10 [.sidebar-sheet_&]:text-sm"].join(" ")} onClick={onCancel}>
            {t("sidebar.cancel")}
          </button>
        )}
      </div>
      {error && <div className="sidebar-worktree-error mt-1.5 text-(--danger) text-[11px] leading-[1.35] [overflow-wrap:anywhere] [.is-classic_&]:mt-[5px]">{error}</div>}
    </div>
  );
}
