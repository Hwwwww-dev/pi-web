"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import type { BranchPreview, SessionEntry, SessionTreeNode } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import { HeaderFlyout } from "./HeaderFlyout";
import { cn } from "@/lib/utils";

interface Props {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** Anchor for the popover when the trigger button is hidden (e.g. the top bar) */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state */
  open?: boolean;
  /** Called when the open state should flip (trigger click or dismiss) */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** When inline, render icon-only (no text label) to save horizontal space */
  compact?: boolean;
  /** Hide the inline button while another control supplies the trigger */
  hideInlineButton?: boolean;
  /** The session is running: the tree stays readable but branches cannot be switched */
  locked?: boolean;
}

// Find the visible entry IDs on the path from root to activeLeafId.
// Iterative DFS: a linear session degrades into a chain whose depth equals the
// entry count, so a recursive search overflows the call stack. Walk with an
// explicit stack instead (paths accumulate depth, not the call stack).
export function buildActivePath(nodes: SessionTreeNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();
  const target = targetId;
  const stack: { node: SessionTreeNode; path: string[] }[] = nodes.map((n) => ({ node: n, path: [n.entry.id] }));
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node.entry.id === target || node.compressedEntryIds?.includes(target)) {
      return new Set(path);
    }
    for (const child of node.children) {
      stack.push({ node: child, path: [...path, child.entry.id] });
    }
  }
  return new Set();
}

// Transcript system messages hold the prompt, not a turn, so they never label a branch.
function isMessageEntry(entry: SessionEntry): boolean {
  return entry.type === "message" && "message" in entry && entry.message.role !== "system";
}

// Compress a visible linear chain into the first branching/leaf node.
// Server-side compressed IDs also count as skipped nodes.
// branchPreview is the bounded preview of the first message on the source
// chain. labelEntry keeps unprojected/test shapes working as a fallback.
export function compressChain(node: SessionTreeNode): {
  node: SessionTreeNode;
  skipped: number;
  branchPreview?: BranchPreview;
  labelEntry: SessionEntry;
} {
  let current = node;
  let branchPreview = current.branchPreview;
  let labelEntry: SessionEntry | null = isMessageEntry(current.entry) ? current.entry : null;
  let skipped = current.compressedEntryIds?.length ?? 0;
  while (current.children.length === 1) {
    current = current.children[0];
    branchPreview ??= current.branchPreview;
    if (!labelEntry && isMessageEntry(current.entry)) labelEntry = current.entry;
    skipped += 1 + (current.compressedEntryIds?.length ?? 0);
  }
  return { node: current, skipped, branchPreview, labelEntry: labelEntry ?? current.entry };
}

// Top-level rows of the panel: with multiple roots (a branch was started from
// the very first message) the roots themselves are the branches; otherwise the
// children of the first branching node.
export function selectTopLevelBranches(tree: SessionTreeNode[]): SessionTreeNode[] {
  if (tree.length > 1) return tree;
  if (tree.length === 0) return [];
  const first = compressChain(tree[0]).node;
  return first.children.length > 1 ? first.children : [];
}

function getLabel(entry: SessionEntry): string {
  if (entry.type === "message" && isMessageEntry(entry)) {
    const msg = entry.message as { role: string; content: unknown };
    const content = msg.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }
    if (text.length > 40) text = text.slice(0, 40) + "…";
    if (text) return text;
    if (msg.role === "assistant") return "[assistant]";
  }
  return entry.type;
}

// Does the tree have any branching at all? Iterative: a linear chain has no
// branching but recursing over it would overflow the stack, so walk with a stack.
export function hasSessionBranches(nodes: SessionTreeNode[]): boolean {
  // Sessions branched from the very first message have multiple root nodes.
  if (nodes.length > 1) return true;
  const stack: SessionTreeNode[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 1) return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

interface TreeNodeProps {
  node: SessionTreeNode;
  activePathIds: Set<string>;
  depth: number;
  isLast: boolean;
  parentLines: boolean[]; // whether ancestor at each depth has more siblings after
  /** Absent while switching is locked */
  onSelect?: (id: string) => void;
}

function TreeNodeView({ node, activePathIds, depth, isLast, parentLines, onSelect }: TreeNodeProps) {
  const { node: rep, skipped, branchPreview, labelEntry } = compressChain(node);
  const isActive = activePathIds.has(rep.entry.id);
  const isOnPath = activePathIds.has(node.entry.id) || activePathIds.has(rep.entry.id);
  const label = branchPreview?.text ?? getLabel(labelEntry);
  const role = branchPreview
    ? branchPreview.role ?? null
    : isMessageEntry(labelEntry)
      ? (labelEntry as { message: { role: string } }).message.role
      : null;

  return (
    <div>
      {/* This node row */}
      <div
        className={cn("flex h-6 items-center", onSelect ? "cursor-pointer" : "cursor-default")}
        onClick={onSelect ? () => onSelect(rep.entry.id) : undefined}
      >
        {/* Indent guide lines */}
        {parentLines.map((hasLine, i) => (
          <div key={i} className="relative h-full w-4 shrink-0 self-stretch">
            {hasLine && (
              <div className="absolute top-0 bottom-0 left-[7px] w-px bg-border" />
            )}
          </div>
        ))}

        {/* Branch connector */}
        <div className="relative h-full w-4 shrink-0 self-stretch">
          {/* vertical line up (to parent) */}
          <div className={cn("absolute top-0 left-[7px] w-px bg-border", isLast ? "bottom-1/2" : "bottom-0")} />
          {/* horizontal line to node */}
          <div className="absolute top-1/2 left-[7px] h-px w-[9px] bg-border" />
        </div>

        {/* Node marker: the official badge, not a self-drawn dot (第 4 节分支行). */}
        <Badge
          variant={isActive ? "default" : "outline"}
          aria-hidden
          className={cn(
            "mr-1.5 size-2 shrink-0 rounded-full p-0 transition-colors duration-100",
            !isActive && !isOnPath && "bg-border",
            !isActive && isOnPath && "border-muted-foreground/50 bg-muted-foreground",
          )}
        />

        {/* Role badge */}
        {role && (
          <span
            className={cn(
              "mr-[5px] shrink-0 rounded-[3px] border px-1 font-mono text-xs leading-4",
              role === "user"
                ? "border-primary/20 bg-primary/8 text-primary"
                : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {role === "user" ? "U" : "A"}
          </span>
        )}

        {/* Skipped indicator */}
        {skipped > 0 && (
          <span className="mr-[5px] shrink-0 text-xs text-muted-foreground">
            +{skipped}
          </span>
        )}

        {/* Label */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            isActive ? "font-medium text-foreground" : isOnPath ? "font-normal text-muted-foreground" : "font-normal text-muted-foreground/70",
          )}
        >
          {label}
        </span>
      </div>

      {/* Children */}
      {rep.children.map((child, idx) => (
        <TreeNodeView
          key={child.entry.id}
          node={child}
          activePathIds={activePathIds}
          depth={depth + 1}
          isLast={idx === rep.children.length - 1}
          parentLines={[...parentLines, !isLast]}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// The branch tree panel: the tree when there is something to switch to, the
// reason there is not otherwise. Exported for tests (Radix portals render
// nothing under renderToStaticMarkup).
export function BranchPanel({ topLevel, activePathIds, selectBranch, locked = false, noBranchReason }: {
  topLevel: SessionTreeNode[];
  activePathIds: Set<string>;
  /** Absent while switching is locked */
  selectBranch?: (id: string) => void;
  locked?: boolean;
  noBranchReason?: string | null;
}) {
  const { t } = useI18n();
  if (topLevel.length === 0 && !locked) {
    return (
      <div className="px-3 py-2.5 text-xs italic text-muted-foreground">
        {noBranchReason ?? t("i18n.noBranches")}
      </div>
    );
  }
  return (
    <div className="max-h-[260px] min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-2">
      {locked && (
        <div className="pt-0.5 pb-1 text-xs italic text-muted-foreground">
          {t("i18n.branchesLockedWhileRunning")}
        </div>
      )}
      {topLevel.map((child, idx) => (
        <TreeNodeView
          key={child.entry.id}
          node={child}
          activePathIds={activePathIds}
          depth={0}
          isLast={idx === topLevel.length - 1}
          parentLines={[]}
          onSelect={selectBranch}
        />
      ))}
    </div>
  );
}

export function BranchNavigator({ tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, compact, hideInlineButton, locked = false }: Props) {
  const { t } = useI18n();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;

  // 受控时（AppShell 面板状态机）开合均为对当前面板的一次 toggle；
  // 非受控时直接写入新值。
  const handleOpenChange = useCallback((next: boolean) => {
    if (openProp !== undefined) onToggle?.();
    else setOpenInternal(next);
  }, [openProp, onToggle]);

  const activePathIds = useMemo(
    () => buildActivePath(tree, activeLeafId),
    [tree, activeLeafId]
  );

  const handleSelect = useCallback((id: string) => {
    onLeafChange(id);
  }, [onLeafChange]);
  const selectBranch = locked ? undefined : handleSelect;

  const noBranchReason = !hasSession
    ? t("i18n.noActiveSession")
    : !hasSessionBranches(tree)
      ? t("i18n.noBranches")
      : null;

  const topLevel = selectTopLevelBranches(tree);
  const hasContent = !noBranchReason && topLevel.length > 0;

  const branchIcon = (
    <GitBranchIcon size={12} strokeWidth={2} className={cn("shrink-0", hasContent ? "text-primary" : "text-muted-foreground")} />
  );

  const chevron = (
    <ChevronDownIcon
      size={10}
      strokeWidth={1.8}
      className={cn("ml-auto text-muted-foreground transition-transform duration-150", open && "rotate-180")}
    />
  );

  const panel = (
    <BranchPanel
      topLevel={topLevel}
      activePathIds={activePathIds}
      selectBranch={selectBranch}
      locked={locked}
      noBranchReason={noBranchReason}
    />
  );

  const flyoutWidth = inline
    ? "w-max min-w-56 max-w-(--radix-popover-content-available-width)"
    : "w-(--radix-popover-trigger-width)";
  const flyoutClassName = "flex max-h-(--radix-popover-content-available-height) flex-col overflow-hidden p-0";

  if (inline) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        {hideInlineButton ? (
          // 触发按钮位于顶栏 ⋯ 菜单，弹层锚定 AppShell 提供的容器。
          <PopoverAnchor virtualRef={containerRef} />
        ) : (
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              title={t("i18n.branches")}
              aria-label={t("i18n.branches")}
              aria-pressed={open}
              className={cn(
                "h-full rounded-md border-0 border-t-2 px-3 py-0 text-xs font-normal",
                open ? "border-t-primary bg-accent text-foreground" : "border-t-transparent text-muted-foreground",
              )}
            >
              {branchIcon}
              {!compact && <span>{t("i18n.branches")}</span>}
            </Button>
          </PopoverTrigger>
        )}
        <HeaderFlyout
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          width={flyoutWidth} className={flyoutClassName}
        >
          {panel}
        </HeaderFlyout>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 w-full justify-start rounded-md px-3 text-xs font-normal text-muted-foreground"
        >
          {branchIcon}
          <span>{t("i18n.branches")}</span>
          {chevron}
        </Button>
      </PopoverTrigger>
      <HeaderFlyout
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        width={flyoutWidth} className={flyoutClassName}
      >
        {panel}
      </HeaderFlyout>
    </Popover>
  );
}
