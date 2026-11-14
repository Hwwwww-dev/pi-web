"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { LayersIcon } from "lucide-react";
import { getFoldChoice } from "@/lib/tool-call-expansion";
import { useFoldAnchor, useTraceFold } from "./TraceRow";

/**
 * A whole turn (official `trace` doc, "Whole Turn"): the folded line above the
 * answer. It has no icon — the summary text is the whole line — and its content
 * is a `<Trace>` of the same rows the answer is made of.
 */
export function TurnTrace({ summary, foldKey, defaultOpen, reveal = false, justSettled = false, className, children }: {
  /** "处理详情 · 8 终端 · 2 文件". */
  summary: string;
  foldKey?: string;
  defaultOpen: boolean;
  /** A search hit sits inside: the fold opens and stays open while the hit is pending. */
  reveal?: boolean;
  /** 回合刚从流式切到完成：折叠行以展开态挂载（衔接原活动行），短暂停留后自动收起。 */
  justSettled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // settle 时首挂即展开：初始化在挂载帧生效，swap 帧活动行无塌落。
  // 历史导航中重挂载时选择已记录（getFoldChoice 优先），不会重放过渡。
  const { open, onOpenChange } = useTraceFold(foldKey, justSettled ? true : defaultOpen);
  // 与 TraceRow 同款：行顶锚定 + 贴底跟随抑制（reveal 是搜索行为，不走锚定）。
  const { rowRef, toggleFold } = useFoldAnchor(open || reveal, onOpenChange);
  const userToggledRef = useRef(false);
  const autoCollapsingRef = useRef(false);
  const settledOnceRef = useRef(false);
  useEffect(() => {
    if (!justSettled || settledOnceRef.current || userToggledRef.current) return;
    if (open) {
      // 展开态先画出来（挂载/展开动画到位），再折上；自动收起同样记录折叠选择。
      settledOnceRef.current = true;
      autoCollapsingRef.current = true;
      const timer = setTimeout(() => {
        autoCollapsingRef.current = false;
        onOpenChange(false);
      }, 240);
      return () => {
        clearTimeout(timer);
        autoCollapsingRef.current = false;
      };
    }
    if (getFoldChoice(foldKey) !== undefined) {
      settledOnceRef.current = true;
      return;
    }
    onOpenChange(true);
  }, [justSettled, open, foldKey, onOpenChange]);

  return (
    <Trace data-activity="turn" ref={rowRef} className={className}>
      <TraceCollapsible
        open={open || reveal}
        onOpenChange={(next) => {
          if (reveal) return;
          if (!autoCollapsingRef.current) userToggledRef.current = true;
          toggleFold(next);
        }}
      >
        <TraceCollapsibleTrigger aria-label={summary}>
          <TraceLine>
            <TraceIcon>
              <LayersIcon className="size-3.5" />
            </TraceIcon>
            <TraceTitle className="font-medium">{summary}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <Trace>{children}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
