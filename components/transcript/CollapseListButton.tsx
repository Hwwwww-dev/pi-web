"use client";

import { ChevronUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 回合体大折叠末尾的「收起列表」：展开体不限高，读者滚到底部后不必再滚回
 * 标题才能收起（2026-11-20 用户要求）。视觉上是一行弱化的按钮，不抢内容。
 */
export function CollapseListButton({ label, onClick, className }: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground",
        "transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <ChevronUpIcon className="size-3.5" />
      {label}
    </button>
  );
}
