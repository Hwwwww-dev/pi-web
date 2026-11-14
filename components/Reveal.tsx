"use client";

import { useRef, type ReactNode } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useDelayedUnmount } from "@/hooks/useDelayedUnmount";

/**
 * Generic height reveal for blocks that would otherwise pop in or out:
 * banners, pills, search boxes — anything whose mount/unmount currently
 * snaps the layout. The height animates 0fr ↔ 1fr with the same keyframes
 * the trace folds use (trace-fold-down/up in globals.css), and Radix keeps
 * the content mounted until the closing animation has run.
 *
 * Children may come straight from a condition (a banner cleared together
 * with its error): the last non-null children stay rendered through the
 * exit animation, so the content fades with the collapse instead of
 * vanishing a frame early.
 *
 * Reduced motion: the fold keyframes are disabled per element (same
 * motion-reduce guards as ui/trace.tsx), leaving the instant switch.
 */
export function Reveal({ open, children, className, contentClassName }: {
  open: boolean;
  children: ReactNode;
  /** The reveal's own footprint classes (margins, flex placement). */
  className?: string;
  /** Classes for the inner body wrapper (rounds, overflow, backgrounds). */
  contentClassName?: string;
}) {
  const lastRef = useRef<ReactNode>(children);
  if (children !== null && children !== undefined) lastRef.current = children;
  // 从未打开过就不挂载：在 flex-col + gap 的父容器里，一个恒在的 0 高包裹层
  // 仍会占一个 gap 槽位（幽灵间隙）；退场动画播完（160ms）再卸载。
  const mounted = useDelayedUnmount(open, 170);
  if (!mounted) return null;
  return (
    <Collapsible open={open} data-slot="reveal" className={cn("min-w-0", className)}>
      <CollapsibleContent
        data-slot="reveal-content"
        className="grid min-w-0 grid-rows-[0fr] data-[state=open]:grid-rows-[1fr] data-[state=open]:animate-[trace-fold-down_180ms_ease-out] data-[state=closed]:animate-[trace-fold-up_160ms_ease-in] motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
      >
        <div data-slot="reveal-clip" className="min-h-0 min-w-0 overflow-hidden">
          <div data-slot="reveal-body" className={cn("min-w-0", contentClassName)}>
            {lastRef.current}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
