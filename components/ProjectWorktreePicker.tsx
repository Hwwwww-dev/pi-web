"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { SidebarMenu, SIDEBAR_MENU_FOCUS_RING as FOCUS_RING, sidebarMenuBoxClassName, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { CheckIcon, GitBranchIcon, ChevronRightIcon, FolderIcon, PlusIcon, Trash2Icon } from "lucide-react";
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

/** The worktree menu's one opening: its anchor, its width, its body. The project menu is a DropdownMenu of its own. */
interface MenuState {
  /**
   * One per opening, and a new one for the "New worktree…" form: an answer
   * for an older one changes nothing. A removal's question keeps the id of
   * the list it came from.
   */
  id: number;
  anchor: SidebarMenuAnchor;
  opener: HTMLElement;
  width: number;
  /** In place of the worktree list (below it, or in the checkout's row). */
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

/**
 * A worktree menu's question for a checkout with changes, in that checkout's
 * row. Its buttons are Radix menu items (arrow keys reach them); Cancel takes
 * focus, so Enter does not discard the changes, and goes back to the list.
 */
function WorktreeConfirmRow({ busy, onForce, onCancel }: { busy: boolean; onForce: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const questionId = useId();
  return (
    <div className="sidebar-worktree-confirm flex items-center gap-1.5 px-2.5 py-[7px] bg-destructive/10">
      <span id={questionId} className="sidebar-worktree-confirm-text flex-1 min-w-0 overflow-hidden text-foreground text-xs text-ellipsis whitespace-nowrap" title={t("sidebar.forceRemoveCheckout")}>
        {t("sidebar.forceRemoveCheckout")}
      </span>
      <DropdownMenuItem
        disabled={busy}
        aria-describedby={questionId}
        data-sidebar-menu-item=""
        className={["focus:text-white dark:bg-destructive", "sidebar-worktree-force", "relative flex-none h-auto px-[9px] py-[3px] rounded-(--radius-sm) border border-destructive bg-destructive text-xs font-semibold text-white outline-hidden select-none cursor-pointer", FOCUS_RING].join(" ")}
        onSelect={(event) => {
          // 移除要留在菜单里看结果：阻止 Radix 的自动关闭。
          event.preventDefault();
          onForce();
        }}
      >
        {t("sidebar.force")}
      </DropdownMenuItem>
      <DropdownMenuItem
        data-sidebar-menu-item=""
        data-sidebar-menu-autofocus=""
        className={["sidebar-worktree-cancel", "relative flex-none h-auto px-[9px] py-[3px] rounded-(--radius-sm) border border-(--border) bg-secondary text-xs text-muted-foreground outline-hidden select-none cursor-pointer focus:bg-secondary focus:text-muted-foreground", FOCUS_RING].join(" ")}
        onSelect={(event) => {
          // 回列表而非关菜单。
          event.preventDefault();
          onCancel();
        }}
      >
        {t("sidebar.cancel")}
      </DropdownMenuItem>
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
  label,
  placeholder = "",
  homeDir,
  projectActivity,
  worktreeHint = null,
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
  // The project menu is a DropdownMenu of its own: controlled open, the
  // box's width measured off the button at each opening, one filter field's
  // text per opening.
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectWidth, setProjectWidth] = useState(260);
  const [projectQuery, setProjectQuery] = useState("");
  // An answer that arrives after the picker went away (the composer moved,
  // the first message went out) starts nothing: nobody asks for it any more.
  const mountedRef = useRef(false);
  // The newest props for an answer that arrives later.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // The files' picker, either way its boxes are laid out.
  const stacked = layout !== "inline";
  const inline = !stacked;
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
  const worktreeMenuOpen = menu !== null;
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

  const measureProjectWidth = () => {
    const rect = projectRef.current?.getBoundingClientRect();
    // At least as wide as its box, as main's dropdowns were.
    if (rect) setProjectWidth(Math.max(260, Math.round(rect.width)));
  };
  /** The DropdownMenu's controlled open, for clicks on the button (Radix drives it). */
  const handleProjectOpenChange = (next: boolean) => {
    if (next) {
      measureProjectWidth();
      setProjectQuery("");
    }
    setProjectOpen(next);
  };
  const openMenuAt = (kind: ProjectWorktreeControl, opener: HTMLElement) => {
    if (kind === "project") {
      measureProjectWidth();
      setProjectQuery("");
      setProjectOpen(true);
      return;
    }
    const rect = opener.getBoundingClientRect();
    // At least as wide as its box, as main's dropdowns were.
    const width = Math.max(STACKED_MENU_MIN_WIDTH, Math.round(rect.width));
    // In the row the worktree box is the right one, narrower than its menu:
    // the menu grows leftward from its right edge, over the sidebar rather
    // than past it over the chat.
    const align = layout === "row" ? "end" : "start";
    setMenu({
      id: nextId(),
      anchor: { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align },
      opener,
      width,
      body: null,
      removing: false,
    });
    // Worktrees come and go outside this page (the CLI, another window).
    onRefreshWorktrees();
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
    setMenu((state) => (state ? { ...state, id, body, removing: false } : state));
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

  // The project menu's rows (shadcn DropdownMenu, the picker's own): a
  // desktop shows the whole path, unless the user named the project — then
  // that name alone, in the same code type; the tooltip keeps the path.
  const projectChoicesForMenu = describeProjectChoices(projectChoices(context));
  const projectFilterMinChoices = 9;
  const wanted = projectQuery.trim().toLowerCase();
  const shownProjects = !wanted ? projectChoicesForMenu : projectChoicesForMenu.filter(({ choice, name, note }) => {
    const label = choice.alias === undefined ? displayPath(choice.root, homeDir) : name;
    return [label, note ?? undefined, choice.root].some((text) => text?.toLowerCase().includes(wanted));
  });
  const projectIconSlot = (checked: boolean) => [
    "inline-flex size-3.5 shrink-0 grow-0 items-center justify-center [&_svg]:size-3! [&_svg]:text-inherit!",
    checked ? "text-(--accent)" : "text-muted-foreground",
  ].join(" ");
  const projectRowClass = (checked: boolean) => [
    "relative flex w-full cursor-pointer items-center gap-2 rounded-xs py-2 pl-2.5 pr-2 text-left text-xs leading-[1.35] outline-hidden select-none",
    "pointer-coarse:min-h-9",
    // RadioItem 基类让出 8px 的指示器槽：隐掉其绝对定位圆点，校验勾自绘在行首。
    "[&>span:first-child]:hidden",
    checked ? "text-foreground focus:bg-secondary focus:text-foreground" : "text-muted-foreground focus:bg-secondary focus:text-foreground",
  ].join(" ");
  const projectLabelClass = [
    "flex-1 min-w-0 whitespace-nowrap font-mono text-xs",
    // 长路径：横向滚动而非省略（rtl 起始即尾部），悬停另有整条 title。
    "overflow-x-auto overflow-y-hidden text-left [direction:rtl] [text-overflow:clip] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>span]:[unicode-bidi:plaintext]",
  ].join(" ");
  const projectActionRowClass = [
    "relative flex w-full cursor-pointer items-center gap-2 rounded-xs px-2.5 py-2 text-left text-xs leading-[1.35] outline-hidden select-none text-foreground",
    "pointer-coarse:min-h-9 focus:bg-secondary focus:text-foreground",
  ].join(" ");
  const projectFilterField = projectChoicesForMenu.length >= projectFilterMinChoices;

  const branchItems = (): SidebarMenuItem[] => {
    const withoutCheckout = (branchList ?? []).filter((branch) => !(worktrees ?? []).some((worktree) => worktree.branch === branch));
    return [
      ...(withoutCheckout.length > 0 ? [{ type: "separator", id: "branch-separator" } as const] : []),
      ...withoutCheckout.map((branch): SidebarMenuItem => ({
        type: "item",
        id: `branch:${branch}`,
        label: branch,
        mono: true,
        path: true,
        disabled: branchBusy !== null,
        onSelect: () => { void activateBranch(branch); },
      })),
    ];
  };

  const worktreeItems = (): SidebarMenuItem[] => [
    ...(worktrees ?? []).map((worktree): SidebarMenuItem => body?.kind === "remove" && body.dirty && body.worktree.path === worktree.path ? {
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
      label: worktree.branch ?? displayPath(worktree.path, homeDir),
      mono: true,
      path: true,
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
    // No line of its own (the rows have theirs), and gone while its form shows below.
    ...(body?.kind === "create" ? [] : [{
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

  const body = menu?.body ?? null;
  let menuItems: SidebarMenuItem[] | undefined;
  // The form, or what went wrong, under the list.
  let menuFooter: ReactNode = null;
  if (menu) {
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
      menuFooter = <div className="sidebar-worktree-error m-0 px-2.5 pt-[5px] pb-2 text-destructive text-xs leading-[1.35] [overflow-wrap:anywhere]" role="alert">{body.error}</div>;
    }
  }
  const filter = { placeholder: t("sidebar.filterWorktrees"), emptyLabel: t("sidebar.noMatchingWorktrees") };
  // A dot in the files' project box: something runs or waits in another project.
  const otherActivity = stacked && projectActivity !== undefined && [...projectActivity].some(
    ([key, { running, unread }]) => key !== project?.key && (running > 0 || unread > 0),
  );

  // 盒子与文字样式由 app/globals.css 迁入。交互状态对齐 shadcn：files 的灰盒使用
  // ghost 的 hover:bg-accent，inline 的页面文字按钮 hover 到 secondary；aria-expanded 与
  // hover 同面（菜单展开时保持高亮）；焦点环来自 Button 自带的 focus-visible ring。
  // 尾部类通过 cn/twMerge 覆盖 ghost 的同名类。
  const boxClass = inline
    ? "inline-flex shrink min-w-0 items-center gap-1 h-[26px] px-1.5 rounded-(--radius-sm) text-left text-xs font-normal text-muted-foreground transition-colors hover:bg-secondary aria-expanded:bg-secondary dark:hover:bg-secondary dark:aria-expanded:bg-secondary pointer-coarse:min-h-9"
    : "inline-flex shrink min-w-0 items-center gap-1.5 h-[29px] px-2.5 border border-border rounded-(--radius-sm) bg-secondary text-left text-xs font-normal text-muted-foreground transition-colors aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:aria-expanded:bg-accent pointer-coarse:min-h-9";
  // 各布局中盒子的伸缩：inline 的两个按钮仅缩至自身最小宽度（分支的 shrink 系数极大，
  // 优先收缩）；files 的行布局中路径/分支占据剩余空间。
  const projectBoxFlex = inline ? "min-w-14" : layout === "row" ? "grow basis-0" : "w-full";
  const worktreeBoxFlex = inline ? "min-w-18 shrink-[1000000]" : layout === "row" ? "max-w-[55%]" : "w-full";
  // 路径/名称文本：files 的两种布局占满盒子，inline 截断到固定宽度。
  const pathFlex = stacked ? "flex-1" : "flex-[0_1_auto] max-w-[32ch]";
  const labelFlex = stacked ? "flex-1" : "";

  return (
    <div
      className={
        inline
          ? "project-picker is-inline flex min-w-0 items-center gap-0.5 text-xs leading-none font-normal"
          : layout === "row"
            ? "project-picker is-row flex flex-none flex-row min-w-0 items-center gap-1.5 text-xs leading-none font-normal"
            : "project-picker is-stacked flex flex-none flex-col min-w-0 items-stretch gap-1.5 text-xs leading-none font-normal"
      }
      role="group"
      aria-label={label}
    >
      <DropdownMenu open={projectOpen} onOpenChange={handleProjectOpenChange} modal={false}>
        <DropdownMenuTrigger asChild>
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
        </DropdownMenuTrigger>
        <DropdownMenuContent
          role="menu"
          aria-label={t("workspace.project")}
          className={sidebarMenuBoxClassName()}
          style={{ width: projectWidth }}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          onEscapeKeyDown={(event) => {
            // 有过滤词先清词，再按一次 Escape 才关菜单。
            if (wanted) {
              event.preventDefault();
              setProjectQuery("");
            }
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {projectFilterField && (
            <div className="sticky top-0 z-[1] bg-background px-2 py-1.5">
              <Input
                className="block h-auto w-full box-border border border-(--border) rounded-(--radius-sm) bg-background px-2 py-[5px] font-mono text-foreground outline-none [user-select:text] [-webkit-user-select:text] focus:border-(--accent) focus-visible:border-(--accent) focus-visible:ring-0"
                value={projectQuery}
                placeholder={t("sidebar.filterProjects")}
                aria-label={t("sidebar.filterProjects")}
                autoComplete="off"
                spellCheck={false}
                data-sidebar-menu-filter=""
                data-sidebar-menu-autofocus=""
                onChange={(event) => setProjectQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    event.stopPropagation();
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab") {
                    event.preventDefault();
                    event.stopPropagation();
                    const root = event.currentTarget.closest("[role='menu']");
                    const rows = root ? Array.from(root.querySelectorAll<HTMLElement>("[data-sidebar-menu-item]")).filter((row) => row.getAttribute("aria-disabled") !== "true") : [];
                    const last = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
                    (last ? rows[rows.length - 1] : rows[0])?.focus({ preventScroll: false });
                    return;
                  }
                  if (event.key.length === 1) event.stopPropagation();
                }}
              />
            </div>
          )}
          {projectFilterField && wanted && shownProjects.length === 0 && (
            <div role="status"><div className="px-2.5 py-2 text-muted-foreground text-xs">{t("sidebar.noMatchingProjects")}</div></div>
          )}
          <DropdownMenuRadioGroup value={project?.key ?? ""}>
            {shownProjects.map(({ choice, name, note }) => {
              const activity = projectActivity?.get(choice.key);
              const checked = choice.key === project?.key;
              // 整条路径为主文本，用户命名的项目用名字（note 为其父目录）。
              const wholePath = choice.alias === undefined;
              return (
                <DropdownMenuRadioItem
                  key={choice.key}
                  value={choice.key}
                  title={choice.root}
                  data-sidebar-menu-item=""
                  className={projectRowClass(checked)}
                  onSelect={() => {
                    // The owners ignore a pick of the folder already in use;
                    // Radix closes the menu either way.
                    if (!checked || !worktrees) onPick({ cwd: choice.root, projectKey: choice.key, projectRoot: choice.root }, "project");
                  }}
                >
                  <span className={projectIconSlot(checked)}>
                    {checked && <CheckIcon size={12} />}
                  </span>
                  <span className={projectLabelClass}>
                    {wholePath ? <span>{displayPath(choice.root, homeDir)}</span> : name}
                  </span>
                  {activity && <ActivitySummary running={activity.running} unread={activity.unread} t={t} />}
                  {!wholePath && note && <span className="shrink-0 max-w-[45%] overflow-hidden text-muted-foreground text-ellipsis whitespace-nowrap text-xs">{note}</span>}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          {/* No project yet (a first run): the two folder items alone, no line above them. */}
          {projectChoicesForMenu.length > 0 && <div className="sidebar-menu-separator h-px bg-(--border) my-1 mx-0" role="separator" />}
          <DropdownMenuItem className={projectActionRowClass} onSelect={() => onUseDefaultDirectory()}>
            <span className="inline-flex size-3.5 shrink-0 grow-0 items-center justify-center text-muted-foreground [&_svg]:size-3! [&_svg]:text-inherit!"><FolderIcon size={13} /></span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t("sidebar.useDefaultDirectory")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem className={projectActionRowClass} onSelect={() => onOpenFolder(projectRef.current)}>
            <span className="inline-flex size-3.5 shrink-0 grow-0 items-center justify-center text-muted-foreground [&_svg]:size-3! [&_svg]:text-inherit!"><PlusIcon size={13} /></span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t("sidebar.customPath")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {worktrees && (
        <Button
          ref={worktreeRef}
          type="button"
          variant="ghost"
          size="default"
          className={`project-picker-button ${boxClass} ${worktreeBoxFlex}`}
          title={current ? t("sidebar.worktreePath", { path: current.path }) : t("sidebar.switchWorktree")}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(event) => openMenu("worktree", event.currentTarget)}
        >
          {/* A linked checkout's branch icon in the primary, as the main checkout's is not. */}
          <GitBranchIcon size={11} className={current && !current.isMain ? "project-picker-icon is-linked size-[11px] shrink-0 text-primary" : "project-picker-icon size-[11px] shrink-0 text-muted-foreground"} />
          <span className={`project-picker-path min-w-0 overflow-hidden text-left text-ellipsis whitespace-nowrap font-mono text-foreground leading-[normal] [direction:rtl] ${pathFlex}`}><span className="[unicode-bidi:plaintext]">{current ? current.branch ?? displayPath(current.path, homeDir) : "…"}</span></span>
          {/* Only in the files tab: in the row the box is a share of a
              narrow sidebar and the branch needs the room; inline the
              branch is text on the page. The icon (the primary only for a
              linked checkout) still tells the main one. */}
          {current?.isMain && layout === "stacked" && <span className="project-picker-note text-xs leading-none flex-none text-muted-foreground">{t("sidebar.main")}</span>}
          {stacked && worktrees.length > 1 && <span className="project-picker-note text-xs leading-none flex-none text-muted-foreground">{worktrees.length}</span>}
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
        ariaLabel={t("sidebar.switchWorktree")}
        items={menuItems}
        filter={filter}
        onClose={closeMenu}
        returnFocusTo={menu?.opener ?? null}
        width={menu?.width}
        footer={menuFooter}
        focusKey={body ? `${body.kind}:${body.kind === "remove" && body.dirty}` : "list"}
        onBodyEscape={() => showBody(null)}
      />
    </div>
  );
}
