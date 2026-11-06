"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import type { BranchPreview, SessionEntry, SessionTreeNode } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { useOutsideDismiss } from "@/hooks/useOutsideDismiss";
import { cn } from "@/lib/utils";

interface Props {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** When inline, use this ref's bounding rect to size/position the dropdown */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state for inline mode */
  open?: boolean;
  /** Called when the button is clicked in inline mode */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** When inline, render icon-only (no text label) to save horizontal space */
  compact?: boolean;
  /** Keep the inline dropdown mounted while another control supplies its trigger */
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

        {/* Node dot */}
        <div
          className={cn(
            "mr-1.5 size-[7px] shrink-0 rounded-full transition-colors duration-100",
            isActive ? "border-0 bg-primary" : isOnPath ? "border border-muted-foreground/50 bg-muted-foreground" : "border border-muted-foreground/50 bg-border",
          )}
        />

        {/* Role badge */}
        {role && (
          <span
            className={cn(
              "mr-[5px] shrink-0 rounded-[3px] border px-1 font-mono text-[10px] leading-4",
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
          <span className="mr-[5px] shrink-0 text-[10px] text-muted-foreground">
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

export function BranchNavigator({ tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, compact, hideInlineButton, locked = false }: Props) {
  const { t } = useI18n();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // 点空白关闭：浮层与触发钮（data-outside-dismiss-ignore）之外的一次
  // pointerdown 都算关闭请求，交给 onToggle 收起。
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const setDropdownEl = useCallback((el: HTMLDivElement | null) => { dropdownRef.current = el; }, []);
  useOutsideDismiss(open, dropdownRef, useCallback(() => {
    if (openProp !== undefined) onToggle?.();
    else setOpenInternal(false);
  }, [openProp, onToggle]));

  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? btnRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [open, inline, containerRef]);

  const activePathIds = useMemo(
    () => buildActivePath(tree, activeLeafId),
    [tree, activeLeafId]
  );

  const handleSelect = useCallback((id: string) => {
    onLeafChange(id);
  }, [onLeafChange]);
  const selectBranch = locked ? undefined : handleSelect;

  const lockedNotice = locked && (
    <div className="pt-0.5 pb-1 text-xs italic text-muted-foreground">
      {t("i18n.branchesLockedWhileRunning")}
    </div>
  );

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
      className={cn("ml-0.5 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
    />
  );

  const treeScrollClass = "max-h-[260px] overflow-y-auto px-3 pt-1 pb-2";
  const emptyNoticeClass = "px-4 py-2.5 text-xs italic text-muted-foreground";

  const renderTreeRows = () =>
    topLevel.map((child, idx) => (
      <TreeNodeView
        key={child.entry.id}
        node={child}
        activePathIds={activePathIds}
        depth={0}
        isLast={idx === topLevel.length - 1}
        parentLines={[]}
        onSelect={selectBranch}
      />
    ));

  if (inline) {
    return (
      <div className="flex h-full items-stretch">
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          data-outside-dismiss-ignore="true"
          className={cn(
            "h-full cursor-pointer items-center gap-1.5 border-0 border-r border-r-border border-t-2 px-3 text-xs whitespace-nowrap transition-colors duration-100",
            "outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            open
              ? "flex border-t-primary bg-accent text-foreground"
              : "flex border-t-transparent bg-transparent text-muted-foreground",
            hideInlineButton && "hidden",
          )}
          title={t("i18n.branches")}
          aria-label={t("i18n.branches")}
          aria-pressed={open}
        >
          {branchIcon}
           {!compact && <span>{t("i18n.branches")}</span>}
        </button>
        {open && dropdownPos && (
          // top/left/width 锚定自触发器的 getBoundingClientRect（测量值），保留 inline style。
          <div
            ref={setDropdownEl}
            className="fixed z-[500] border-b border-border bg-card"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          >
            {hasContent ? (
              <div className={treeScrollClass}>
                {lockedNotice}
                {renderTreeRows()}
              </div>
            ) : (
              <div className={emptyNoticeClass}>
                {noBranchReason}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative shrink-0 border-b border-border bg-background">
      {/* Header toggle */}
      <button
        onClick={() => setOpenInternal((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3 py-[5px] text-left text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {branchIcon}
         <span className="text-muted-foreground">{t("i18n.branches")}</span>
        {chevron}
      </button>

      {/* Tree panel - overlay */}
      {open && (
        <div className="absolute top-full right-0 left-0 z-[100] border-b border-border bg-background shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
          {hasContent ? (
            <div className={treeScrollClass}>
              {lockedNotice}
              {renderTreeRows()}
            </div>
          ) : (
            <div className={emptyNoticeClass}>
              {noBranchReason ?? t("i18n.noBranches")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
