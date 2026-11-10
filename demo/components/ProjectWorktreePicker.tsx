"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import {
  currentWorktreeOf,
  describeProjectChoices,
  projectChoices,
  type NewSessionTarget,
  type ProjectChoice,
  type ProjectWorktreeContext,
  type WorktreeChoice,
} from "@/lib/new-session-context";
import { projectNameOf } from "@/lib/session-tree";
import { ActivitySummary } from "./SessionTree";
import { SidebarMenu, SIDEBAR_MENU_FOCUS_RING as FOCUS_RING, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { GitBranchIcon, ChevronRightIcon, FolderIcon, FolderPlusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { WorktreeCreateForm } from "./WorktreeCreateForm";

/** The picker's two controls. A pick names the one it came from. */
export type ProjectWorktreeControl = "project" | "worktree";

/** How a linked checkout's removal went: a checkout with changes waits for a force. */
export type WorktreeRemoval = "removed" | "dirty" | { error: string };

/** What the owner reaches through `handleRef`. */
export interface ProjectWorktreePickerHandle {
  /** The control's button, while it is shown. */
  button(control: ProjectWorktreeControl): HTMLButtonElement | null;
  /** Opens the control's menu below its button (the sessions tab's "Open another project…"). */
  openMenu(control: ProjectWorktreeControl): void;
}

type MenuBody =
  | { kind: "create"; busy: boolean; error: string | null }
  /** A removal that needs an answer: a checkout with changes (force?), or one that failed. */
  | { kind: "remove"; worktree: WorktreeChoice; dirty: boolean; busy: boolean; error: string | null };

interface MenuState {
  /**
   * One per opening, and a new one for the "New worktree…" form: an answer
   * for an older one changes nothing. A removal's question keeps the id of
   * the list it came from.
   */
  id: number;
  kind: ProjectWorktreeControl;
  anchor: SidebarMenuAnchor;
  opener: HTMLElement;
  width: number;
  /** In place of the worktree list (classic: below it, or in the checkout's row). */
  body: MenuBody | null;
  /** A checkout is being removed from the list: the remove buttons wait. */
  removing: boolean;
}

interface Props {
  /**
   * "inline": the bar above a fresh composer, the project's name and the
   * worktree's branch as text on the page (no path, no notes).
   * The files' own: "stacked", full width, one under the other (the files
   * tab); "row", side by side in one row (the files below the sessions).
   * Both have the files' boxes (the whole path, the worktree's notes) and
   * extras: the activity dot, the worktree hint, the menus' minimum width.
   */
  layout: "inline" | "stacked" | "row";
  context: ProjectWorktreeContext;
  mobile: boolean;
  /** The group's accessible name. */
  label: string;
  /** The project button's text while there is no project. */
  placeholder?: string;
  /** Shown as ~ in the boxes' paths. */
  homeDir?: string;
  /** Running and unread counts by project key: badges in the project menu, and a dot in the files' project box for activity elsewhere. */
  projectActivity?: ReadonlyMap<string, { running: number; unread: number }>;
  /** The files' (stacked or row), without a worktree list: a disabled box saying why (a subdirectory of a checkout, still checking). None for a folder outside git: the project box alone. */
  worktreeHint?: { label: string; title: string } | null;
  /** The "New worktree…" form's title. */
  newWorktreeTitle: string;
  handleRef?: Ref<ProjectWorktreePickerHandle>;
  /** A project or checkout other than the one in use was picked, or a checkout was just created. */
  onPick: (target: NewSessionTarget, from: ProjectWorktreeControl) => void;
  onUseDefaultDirectory: () => void;
  /** "Open another project…": the folder picker. Focus goes back to `opener` when nothing moves. */
  onOpenFolder: (opener: HTMLElement | null) => void;
  onRefreshWorktrees: () => void;
  onCreateWorktree: (project: ProjectChoice, branch: string) => Promise<{ path: string } | { error: string }>;
  /** Given, each linked checkout has a remove button (the files tab). */
  onRemoveWorktree?: (project: ProjectChoice, path: string, force: boolean) => Promise<WorktreeRemoval>;
}

/** Narrower than this, a files box's menu keeps this width instead of the box's. */
const STACKED_MENU_MIN_WIDTH = 220;

/** Substitute the home dir prefix with ~ (display only; the boxes cut the path at its left). */
function displayPath(path: string, homeDir?: string): string {
  return homeDir && path.startsWith(homeDir) ? `~${path.slice(homeDir.length)}` : path;
}

function worktreeLabel(worktree: WorktreeChoice): string {
  return worktree.branch ?? projectNameOf(worktree.path);
}

/**
 * A removal's body: the question for a checkout with changes, else what went
 * wrong. Focus starts on a Cancel, so Enter does not discard the checkout's
 * changes: this one on a desktop, the sheet's own on a phone (`focusCancel`).
 */
export function WorktreeRemoveForm({
  heading,
  dirty,
  busy,
  error,
  showCancel,
  onForce,
  onCancel,
}: {
  heading: string | null;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  showCancel: boolean;
  onForce: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    // The sheet's look arrives as variants (the retired app/sidebar-menu.css,
    // folded here); the body only ever shows in a sheet.
    <div className="sidebar-worktree-form px-1 pt-0.5 pb-1 [.sidebar-sheet_&]:px-4 [.sidebar-sheet_&]:pt-2.5 [.sidebar-sheet_&]:pb-1">
      {heading && <div className="sidebar-menu-header overflow-hidden text-muted-foreground text-ellipsis whitespace-nowrap px-2 pt-1.5 pb-1 text-[11px] [.sidebar-sheet_&]:px-4 [.sidebar-sheet_&]:pt-2 [.sidebar-sheet_&]:pb-1 [.sidebar-sheet_&]:text-xs">{heading}</div>}
      {dirty && <div className="sidebar-worktree-message pt-0.5 px-1 text-foreground text-xs leading-[1.4]">{t("sidebar.forceRemoveCheckout")}</div>}
      {(dirty || showCancel) && (
        <div className="sidebar-worktree-form-buttons flex gap-1.5 mt-1.5">
          {dirty && (
            <Button
              type="button"
              variant="destructive"
              size="default"
              className={["px-0 py-0 disabled:pointer-events-auto focus-visible:ring-0 focus-visible:border-transparent dark:bg-destructive", "sidebar-worktree-force", "flex-1 h-[26px] border border-destructive rounded-(--radius-sm) bg-destructive text-white text-xs font-semibold cursor-pointer", "disabled:cursor-not-allowed disabled:opacity-50", FOCUS_RING, "[.sidebar-sheet_&]:h-10 [.sidebar-sheet_&]:text-sm"].join(" ")}
              disabled={busy}
              onClick={onForce}
            >
              {t("sidebar.force")}
            </Button>
          )}
          {showCancel && (
            <Button
              type="button"
              variant="outline"
              size="default"
              className={["px-0 py-0 focus-visible:ring-0 focus-visible:border-(--border)", "sidebar-worktree-cancel", "flex-1 h-[26px] border border-(--border) rounded-(--radius-sm) bg-background text-muted-foreground text-xs cursor-pointer hover:bg-accent", FOCUS_RING, "[.sidebar-sheet_&]:h-10 [.sidebar-sheet_&]:text-sm"].join(" ")}
              data-sidebar-menu-autofocus=""
              onClick={onCancel}
            >
              {t("sidebar.cancel")}
            </Button>
          )}
        </div>
      )}
      {error && <div className="sidebar-worktree-error mt-1.5 text-destructive text-[11px] leading-[1.35] [overflow-wrap:anywhere]" role="alert">{error}</div>}
    </div>
  );
}

/**
 * A classic worktree menu's question for a checkout with changes, in that
 * checkout's row as on main. Its buttons are the menu's items (arrow keys
 * reach them); Cancel takes focus, so Enter does not discard the changes,
 * and goes back to the list.
 */
function WorktreeConfirmRow({ busy, onForce, onCancel }: { busy: boolean; onForce: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const questionId = useId();
  return (
    <div className="sidebar-worktree-confirm flex items-center gap-1.5 px-2.5 py-[7px] border-b border-(--border) bg-destructive/10">
      <span id={questionId} className="sidebar-worktree-confirm-text flex-1 min-w-0 overflow-hidden text-foreground text-[11px] text-ellipsis whitespace-nowrap" title={t("sidebar.forceRemoveCheckout")}>
        {t("sidebar.forceRemoveCheckout")}
      </span>
      <Button
        type="button"
        variant="destructive"
        size="default"
        role="menuitem"
        tabIndex={-1}
        data-sidebar-menu-item=""
        aria-describedby={questionId}
        aria-disabled={busy ? true : undefined}
        className={["focus-visible:ring-0 focus-visible:border-transparent dark:bg-destructive", "sidebar-worktree-force", "flex-none h-auto px-[9px] py-[3px] border border-destructive rounded-(--radius-sm) bg-destructive text-white text-[11px] font-semibold", "aria-disabled:cursor-not-allowed aria-disabled:opacity-50", FOCUS_RING].join(" ")}
        onClick={() => { if (!busy) onForce(); }}
      >
        {t("sidebar.force")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="default"
        role="menuitem"
        tabIndex={-1}
        data-sidebar-menu-item=""
        data-sidebar-menu-autofocus=""
        className={["focus-visible:ring-0 focus-visible:border-(--border)", "sidebar-worktree-cancel", "flex-none h-auto px-[9px] py-[3px] border border-(--border) rounded-(--radius-sm) bg-secondary text-muted-foreground text-[11px] cursor-pointer", FOCUS_RING].join(" ")}
        onClick={onCancel}
      >
        {t("sidebar.cancel")}
      </Button>
    </div>
  );
}

/**
 * The project and worktree in use, and the two menus that change them: the
 * files' (stacked in the files tab, a row below the sessions) and the bar's
 * above a fresh composer (inline). The
 * owner keeps the cwd; the picker only reports what was chosen. Picking the
 * checkout in use does nothing, and so does picking the project in use while
 * its worktrees are listed: that would move a worktree back to the root.
 * Without the list (a removed checkout, a subdirectory) the project is the way
 * back to its root.
 */
export function ProjectWorktreePicker({
  layout,
  context,
  mobile,
  label,
  placeholder = "",
  homeDir,
  projectActivity,
  worktreeHint = null,
  newWorktreeTitle,
  handleRef,
  onPick,
  onUseDefaultDirectory,
  onOpenFolder,
  onRefreshWorktrees,
  onCreateWorktree,
  onRemoveWorktree,
}: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const menuIdRef = useRef(0);
  const projectRef = useRef<HTMLButtonElement>(null);
  const worktreeRef = useRef<HTMLButtonElement>(null);
  // An answer that arrives after the picker went away (the composer moved,
  // the first message went out) starts nothing: nobody asks for it any more.
  const mountedRef = useRef(false);
  // The newest props for an answer that arrives later.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // The files' picker, either way its boxes are laid out.
  const stacked = layout !== "inline";
  const inline = !stacked;
  // The menus on a desktop look as main's dropdowns did: whole paths,
  // "Custom path…", the "New worktree…" form under the list, a dirty
  // checkout's question in its row. A phone keeps the sheet.
  const classic = !mobile;
  const { project, worktrees } = context;
  const current = currentWorktreeOf(context);
  // Inline, the project's name as the menus name it: its display name, else
  // its folder's, with the parent folder only where two projects share it.
  const projectName = inline && project
    ? describeProjectChoices(projectChoices(context)).find(({ choice }) => choice.key === project.key)
    : undefined;

  // Branches with no checkout yet, fetched when the worktree menu opens: the
  // menu lists them below its worktree rows; picking one moves the project
  // there by creating (or reusing) that branch's worktree.
  const [branchList, setBranchList] = useState<string[] | null>(null);
  const [branchBusy, setBranchBusy] = useState<string | null>(null);
  const worktreeMenuOpen = menu?.kind === "worktree";
  const branchCwd = current?.path ?? project?.root ?? null;
  useEffect(() => {
    if (!worktreeMenuOpen || !branchCwd) return;
    let cancelled = false;
    setBranchList(null);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(branchCwd)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ branches?: unknown }>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!cancelled) setBranchList(Array.isArray(data.branches) ? data.branches.filter((branch): branch is string => typeof branch === "string") : null);
      })
      .catch(() => {
        if (!cancelled) setBranchList(null);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreeMenuOpen, branchCwd]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const nextId = () => {
    menuIdRef.current += 1;
    return menuIdRef.current;
  };
  const closeMenu = () => setMenu(null);

  const openMenuAt = (kind: ProjectWorktreeControl, opener: HTMLElement) => {
    const rect = opener.getBoundingClientRect();
    // At least as wide as its box, as main's dropdowns were.
    const width = Math.max(stacked ? STACKED_MENU_MIN_WIDTH : kind === "project" ? 260 : 240, Math.round(rect.width));
    // In the row the worktree box is the right one, narrower than its menu:
    // the menu grows leftward from its right edge, over the sidebar rather
    // than past it over the chat.
    const align = layout === "row" && kind === "worktree" ? "end" : "start";
    setMenu({
      id: nextId(),
      kind,
      anchor: { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align },
      opener,
      width,
      body: null,
      removing: false,
    });
    // Worktrees come and go outside this page (the CLI, another window).
    if (kind === "worktree") onRefreshWorktrees();
  };
  // A programmatic open (the sidebar menu's project-list entry) can fire while
  // the files section is still unfolding: the not-yet-laid-out opener's rect is
  // all zeros and the menu would land in the viewport's top-left corner. Wait
  // for a real layout box (bounded, ~1s) instead of opening blind.
  const openMenu = (kind: ProjectWorktreeControl, opener: HTMLElement) => {
    const rect = opener.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      let tries = 0;
      const wait = () => {
        if (!opener.isConnected) return;
        const next = opener.getBoundingClientRect();
        if (next.width > 0 || next.height > 0) {
          openMenuRef.current(kind, opener);
        } else if (tries++ < 60) {
          requestAnimationFrame(wait);
        }
      };
      requestAnimationFrame(wait);
      return;
    }
    openMenuAt(kind, opener);
  };
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;

  useImperativeHandle(handleRef, () => ({
    button: (control) => (control === "worktree" ? worktreeRef : projectRef).current,
    openMenu: (control) => {
      const button = (control === "worktree" ? worktreeRef : projectRef).current;
      if (button) openMenuRef.current(control, button);
    },
  }), []);

  /** Changes the menu if it is still the one `id` names. */
  const updateMenu = (id: number, change: (state: MenuState) => MenuState | null) => {
    setMenu((state) => (state?.id === id ? change(state) : state));
  };

  // A new body is a new menu: what the list was still waiting for is dropped.
  const showBody = (body: MenuBody | null) => {
    const id = nextId();
    setMenu((state) => (state?.kind === "worktree" ? { ...state, id, body, removing: false } : state));
  };

  const createWorktree = async (branch: string) => {
    const state = menuRef.current;
    if (!state || state.body?.kind !== "create" || !project) return;
    const { id } = state;
    const setForm = (busy: boolean, error: string | null) => {
      updateMenu(id, (menuState) => ({ ...menuState, body: { kind: "create", busy, error } }));
    };
    setForm(true, null);
    let result: { path: string } | { error: string };
    try {
      result = await onCreateWorktree(project, branch);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!mountedRef.current) return;
    if ("error" in result) {
      setForm(false, result.error);
      return;
    }
    // Closed meanwhile: the worktree exists, and the sidebar lists it, but
    // nobody asked to move there any more.
    if (menuRef.current?.id !== id) return;
    setMenu(null);
    onPickRef.current({ cwd: result.path, projectKey: project.key, projectRoot: project.root }, "worktree");
  };

  // A branch row: create (or reuse) that branch's worktree and move there.
  // The create form body doubles as the error surface; branchBusy disables
  // the rows while a checkout is being made.
  const activateBranch = async (branch: string) => {
    if (!project || branchBusy) return;
    const id = menuRef.current?.id;
    setBranchBusy(branch);
    let result: { path: string } | { error: string };
    try {
      result = await onCreateWorktree(project, branch);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!mountedRef.current) return;
    setBranchBusy(null);
    if ("error" in result) {
      showBody({ kind: "create", busy: false, error: result.error });
      return;
    }
    if (menuRef.current?.id !== id) return;
    setMenu(null);
    onPickRef.current({ cwd: result.path, projectKey: project.key, projectRoot: project.root }, "worktree");
  };

  const removeWorktree = async (worktree: WorktreeChoice, force: boolean) => {
    const state = menuRef.current;
    if (!state || !project || !onRemoveWorktree) return;
    const { id } = state;
    updateMenu(id, (menuState) => ({
      ...menuState,
      removing: true,
      body: menuState.body?.kind === "remove" ? { ...menuState.body, busy: true, error: null } : menuState.body,
    }));
    let result: WorktreeRemoval;
    try {
      result = await onRemoveWorktree(project, worktree.path, force);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!mountedRef.current) return;
    updateMenu(id, (menuState) => {
      // Removed: back to the list, which the owner fetches again.
      if (result === "removed") return { ...menuState, removing: false, body: null };
      const dirty = result === "dirty" || (menuState.body?.kind === "remove" && menuState.body.dirty);
      return {
        ...menuState,
        removing: false,
        body: { kind: "remove", worktree, dirty, busy: false, error: result === "dirty" ? null : result.error },
      };
    });
  };

  const projectItems = (): SidebarMenuItem[] => {
    const choices = describeProjectChoices(projectChoices(context)).map(({ choice, name, note }): SidebarMenuItem => {
      const activity = projectActivity?.get(choice.key);
      // A desktop shows the whole path, unless the user named the project:
      // then that name alone, in the same code type; the tooltip keeps the path.
      const wholePath = classic && choice.alias === undefined;
      return {
        type: "item",
        id: `project:${choice.key}`,
        label: wholePath ? displayPath(choice.root, homeDir) : name,
        note: wholePath ? undefined : note ?? undefined,
        mono: classic,
        path: wholePath,
        title: choice.root,
        checked: choice.key === project?.key,
        badge: activity ? <ActivitySummary running={activity.running} unread={activity.unread} t={t} /> : undefined,
        // The owners ignore a pick of the folder already in use.
        onSelect: () => {
          if (choice.key !== project?.key || !worktrees) onPick({ cwd: choice.root, projectKey: choice.key, projectRoot: choice.root }, "project");
        },
      };
    });
    // No project yet (a first run): the two folder items alone, no line above them.
    const separator: SidebarMenuItem[] = choices.length > 0 ? [{ type: "separator", id: "separator" }] : [];
    return [
      ...choices,
      ...separator,
      {
        type: "item",
        id: "default-directory",
        label: t("sidebar.useDefaultDirectory"),
        icon: <FolderIcon size={13} />,
        onSelect: () => onUseDefaultDirectory(),
      },
      {
        type: "item",
        id: "open-folder",
        label: t(classic ? "sidebar.customPath" : "sidebar.openOtherProject"),
        icon: classic ? <PlusIcon size={13} /> : <FolderPlusIcon size={13} />,
        onSelect: () => onOpenFolder(menu?.opener ?? null),
      },
    ];
  };

  const branchItems = (): SidebarMenuItem[] => {
    const withoutCheckout = (branchList ?? []).filter((branch) => !(worktrees ?? []).some((worktree) => worktree.branch === branch));
    return [
      ...(withoutCheckout.length > 0 ? [{ type: "separator", id: "branch-separator" } as const] : []),
      ...withoutCheckout.map((branch): SidebarMenuItem => ({
        type: "item",
        id: `branch:${branch}`,
        label: branch,
        mono: classic,
        path: classic,
        disabled: branchBusy !== null,
        onSelect: () => { void activateBranch(branch); },
      })),
    ];
  };

  const worktreeItems = (): SidebarMenuItem[] => [
    ...(worktrees ?? []).map((worktree): SidebarMenuItem => classic && body?.kind === "remove" && body.dirty && body.worktree.path === worktree.path ? {
      type: "custom",
      id: `worktree:${worktree.path}`,
      content: (
        <WorktreeConfirmRow
          busy={body.busy}
          onForce={() => { void removeWorktree(worktree, true); }}
          onCancel={() => showBody(null)}
        />
      ),
    } : {
      type: "item",
      id: `worktree:${worktree.path}`,
      label: classic ? worktree.branch ?? displayPath(worktree.path, homeDir) : worktreeLabel(worktree),
      mono: classic,
      path: classic,
      note: worktree.isMain ? t("sidebar.main") : undefined,
      title: worktree.path,
      checked: worktree.path === current?.path,
      secondary: onRemoveWorktree && !worktree.isMain ? {
        label: t("sidebar.removeWorktreeTitle", { path: worktree.path }),
        icon: <Trash2Icon size={12} />,
        danger: true,
        disabled: menu?.removing,
        onSelect: ({ keepOpen }) => {
          keepOpen();
          void removeWorktree(worktree, false);
        },
      } : undefined,
      onSelect: () => {
        if (project && worktree.path !== current?.path) {
          onPick({ cwd: worktree.path, projectKey: project.key, projectRoot: project.root }, "worktree");
        }
      },
    }),
    // Branches with no checkout yet: one row each; picking it moves the
    // project there by creating (or reusing) that branch's worktree.
    ...branchItems(),
    // Classic: no line of its own (the rows have theirs), and gone while its form shows below.
    ...(classic ? [] : [{ type: "separator", id: "separator" } as const]),
    ...(classic && body?.kind === "create" ? [] : [{
      type: "item",
      id: "new-worktree",
      label: t("sidebar.newWorktree"),
      icon: <PlusIcon size={13} />,
      onSelect: ({ keepOpen }) => {
        keepOpen();
        showBody({ kind: "create", busy: false, error: null });
      },
    } satisfies SidebarMenuItem]),
  ];

  const body = menu?.kind === "worktree" ? menu.body : null;
  let menuTitle = "";
  let menuItems: SidebarMenuItem[] | undefined;
  // The form or question in place of the list, as one child that is null for
  // a list: the menu would take two side by side (an array) for a body.
  let menuBody: ReactNode = null;
  // Classic: the form, or what went wrong, under the list.
  let menuFooter: ReactNode = null;
  if (classic && menu?.kind === "worktree") {
    menuTitle = t("sidebar.switchWorktree");
    menuItems = worktreeItems();
    if (body?.kind === "create") {
      // Escape inside the form goes back to the list, like its Cancel.
      menuFooter = (
        <div data-sidebar-menu-esc-to-body="" className="contents">
          <WorktreeCreateForm
            heading={null}
            busy={body.busy}
            error={body.error}
            showCancel
            onCreate={(branch) => { void createWorktree(branch); }}
            onCancel={() => showBody(null)}
          />
        </div>
      );
    } else if (body?.kind === "remove" && body.error) {
      menuFooter = <div className="sidebar-worktree-error mt-1.5 text-destructive text-[11px] leading-[1.35] [overflow-wrap:anywhere] [.is-classic_&]:m-0 [.is-classic_&]:px-2.5 [.is-classic_&]:pt-[5px] [.is-classic_&]:pb-2" role="alert">{body.error}</div>;
    }
  } else if (body?.kind === "create") {
    menuTitle = newWorktreeTitle;
    // Escape inside the form goes back to the list, not out of the menu.
    menuBody = (
      <div data-sidebar-menu-esc-to-body="" className="contents">
        <WorktreeCreateForm
          heading={mobile ? null : menuTitle}
          busy={body.busy}
          error={body.error}
          showCancel={!mobile}
          onCreate={(branch) => { void createWorktree(branch); }}
          onCancel={closeMenu}
        />
      </div>
    );
  } else if (body?.kind === "remove") {
    menuTitle = t("sidebar.removeWorktreeHeading", { name: worktreeLabel(body.worktree) });
    menuBody = (
      <WorktreeRemoveForm
        heading={mobile ? null : menuTitle}
        dirty={body.dirty}
        busy={body.busy}
        error={body.error}
        showCancel={!mobile}
        onForce={() => { void removeWorktree(body.worktree, true); }}
        onCancel={closeMenu}
      />
    );
  } else if (menu?.kind === "project") {
    menuTitle = t("workspace.project");
    menuItems = projectItems();
  } else if (menu?.kind === "worktree") {
    menuTitle = t("sidebar.switchWorktree");
    menuItems = worktreeItems();
  }
  const filter = menu?.kind === "project"
    // Main showed the projects' field only past 8 of them, the worktrees' from 8.
    ? { placeholder: t("sidebar.filterProjects"), emptyLabel: t("sidebar.noMatchingProjects"), minChoices: classic ? 9 : undefined }
    : { placeholder: t("sidebar.filterWorktrees"), emptyLabel: t("sidebar.noMatchingWorktrees") };
  // A dot in the files' project box: something runs or waits in another project.
  const otherActivity = stacked && projectActivity !== undefined && [...projectActivity].some(
    ([key, { running, unread }]) => key !== project?.key && (running > 0 || unread > 0),
  );

  // 盒子与文字的样式批 4 自 app/globals.css 迁入。交互面对齐 shadcn：files 的
  // 灰盒沿用 ghost 的 hover:bg-accent，inline 的页面文字按钮 hover 到 secondary；
  // aria-expanded 与 hover 同面（菜单开着时保持高亮）；焦点环是 Button 自带的
  // focus-visible ring。尾部类经 cn/twMerge 覆盖 ghost 的同名面。
  const boxClass = inline
    ? "inline-flex shrink min-w-0 items-center gap-1 h-[26px] px-1.5 rounded-(--radius-sm) text-left text-xs font-normal text-muted-foreground transition-colors hover:bg-secondary aria-expanded:bg-secondary dark:hover:bg-secondary dark:aria-expanded:bg-secondary pointer-coarse:min-h-9"
    : "inline-flex shrink min-w-0 items-center gap-1.5 h-[29px] px-2.5 border border-border rounded-(--radius-sm) bg-secondary text-left text-[11px] font-normal text-muted-foreground transition-colors aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:aria-expanded:bg-accent pointer-coarse:min-h-9";
  // 每个布局里盒子的伸缩：inline 的两个按钮只缩到自己的最小宽度（一个百万
  // 倍的 shrink 系数让分支先让路），files 的行里路径/分支吃满剩下的空间。
  const projectBoxFlex = inline ? "min-w-14" : layout === "row" ? "grow basis-0" : "w-full";
  const worktreeBoxFlex = inline ? "min-w-18 shrink-[1000000]" : layout === "row" ? "max-w-[55%]" : "w-full";
  // 路径/名字文本：files 的两种布局吃满盒子，inline 截到定长。
  const pathFlex = stacked ? "flex-1" : "flex-[0_1_auto] max-w-[32ch]";
  const labelFlex = stacked ? "flex-1" : "";

  return (
    <div
      className={
        inline
          ? "project-picker is-inline flex min-w-0 items-center gap-0.5 text-xs leading-none font-normal"
          : layout === "row"
            ? "project-picker is-row flex flex-none flex-row min-w-0 items-center gap-1.5 text-[11px] leading-none font-normal"
            : "project-picker is-stacked flex flex-none flex-col min-w-0 items-stretch gap-1.5 text-[11px] leading-none font-normal"
      }
      role="group"
      aria-label={label}
    >
      <Button
        ref={projectRef}
        type="button"
        variant="ghost"
        size="default"
        className={[
          "project-picker-button is-project",
          boxClass,
          projectBoxFlex,
          project
            ? ""
            : [
                "is-empty font-mono",
                inline
                  ? ""
                  : "border-primary/40 bg-primary/[0.06] hover:bg-primary/[0.06] hover:text-muted-foreground dark:hover:bg-primary/[0.06] dark:hover:text-muted-foreground",
              ].join(" "),
        ].join(" ")}
        title={project?.root ?? ""}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "project"}
        onClick={(event) => openMenu("project", event.currentTarget)}
      >
        {/* Inline: a folder icon, the name (cut at its end) and a chevron;
            the tooltip is the path. The files': the whole path, cut at its
            left (the folder name at its end is what tells paths apart), no
            icon and no chevron: the path is the box. A project the user
            named shows that name; the tooltip keeps the path. */}
        {inline && <FolderIcon size={12} className="project-picker-icon size-3 shrink-0 text-muted-foreground" />}
        {/* A twin's parent folder is cut before its name, the "/" never. */}
        {inline && project ? (
          <span className="project-picker-name inline-flex min-w-0 max-w-[28ch] overflow-hidden whitespace-nowrap font-mono text-muted-foreground leading-[normal]">
            {project.alias === undefined && projectName?.note && <><span className="project-picker-parent min-w-0 flex-[0_1000000_auto] overflow-hidden text-ellipsis">{projectName.note}</span>/</>}
            <span className="project-picker-leaf min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis text-foreground">{project.alias ?? projectName?.name ?? projectNameOf(project.root)}</span>
          </span>
        ) : project?.alias !== undefined ? (
          <span className={`project-picker-label is-alias min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[normal] font-mono text-foreground ${labelFlex}`}>{project.alias}</span>
        ) : project ? (
          <span className={`project-picker-path min-w-0 overflow-hidden text-left text-ellipsis whitespace-nowrap font-mono text-foreground leading-[normal] [direction:rtl] ${pathFlex}`}><span className="[unicode-bidi:plaintext]">{displayPath(project.root, homeDir)}</span></span>
        ) : (
          <span className={`project-picker-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[normal] ${labelFlex}`}>{placeholder}</span>
        )}
        {otherActivity && (
          <span className="project-picker-activity size-2 flex-none rounded-full bg-primary" role="img" title={t("sidebar.newActivity")} aria-label={t("sidebar.newActivity")} />
        )}
        {inline && <ChevronRightIcon size={9} className="project-picker-chevron size-[9px] shrink-0 rotate-90 text-muted-foreground" />}
      </Button>
      {worktrees && (
        <Button
          ref={worktreeRef}
          type="button"
          variant="ghost"
          size="default"
          className={`project-picker-button ${boxClass} ${worktreeBoxFlex}`}
          title={current ? t("sidebar.worktreePath", { path: current.path }) : t("sidebar.switchWorktree")}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "worktree"}
          onClick={(event) => openMenu("worktree", event.currentTarget)}
        >
          {/* A linked checkout's branch icon in the primary, as the main checkout's is not. */}
          <GitBranchIcon size={11} className={current && !current.isMain ? "project-picker-icon is-linked size-[11px] shrink-0 text-primary" : "project-picker-icon size-[11px] shrink-0 text-muted-foreground"} />
          <span className={`project-picker-path min-w-0 overflow-hidden text-left text-ellipsis whitespace-nowrap font-mono text-foreground leading-[normal] [direction:rtl] ${pathFlex}`}><span className="[unicode-bidi:plaintext]">{current ? current.branch ?? displayPath(current.path, homeDir) : "…"}</span></span>
          {/* Only in the files tab: in the row the box is a share of a
              narrow sidebar and the branch needs the room; inline the
              branch is text on the page. The icon (the primary only for a
              linked checkout) still tells the main one. */}
          {current?.isMain && layout === "stacked" && <span className="project-picker-note text-[10px] leading-none flex-none text-muted-foreground">{t("sidebar.main")}</span>}
          {stacked && worktrees.length > 1 && <span className="project-picker-note text-[10px] leading-none flex-none text-muted-foreground">{worktrees.length}</span>}
          <ChevronRightIcon size={9} className="project-picker-chevron size-[9px] shrink-0 rotate-90 text-muted-foreground" />
        </Button>
      )}
      {!worktrees && stacked && worktreeHint && (
        <Button type="button" variant="ghost" size="default" aria-disabled="true" tabIndex={-1} title={worktreeHint.title} className={`project-picker-button is-inactive ${boxClass} w-full cursor-default opacity-[0.82] hover:bg-secondary hover:text-muted-foreground dark:hover:bg-secondary dark:hover:text-muted-foreground`}>
          <GitBranchIcon size={11} className="project-picker-icon size-[11px] shrink-0 text-muted-foreground" />
          <span className={`project-picker-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[normal] ${labelFlex}`}>{worktreeHint.label}</span>
        </Button>
      )}
      <SidebarMenu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        sheet={mobile}
        ariaLabel={menuTitle}
        title={menuTitle}
        items={menuItems}
        filter={filter}
        cancelLabel={t("sidebar.cancel")}
        focusCancel={body?.kind === "remove"}
        onClose={closeMenu}
        returnFocusTo={menu?.opener ?? null}
        width={menu?.width}
        classic={classic}
        footer={menuFooter}
        focusKey={body ? `${body.kind}:${body.kind === "remove" && body.dirty}` : "list"}
        onBodyEscape={() => showBody(null)}
      >
        {menuBody}
      </SidebarMenu>
    </div>
  );
}
