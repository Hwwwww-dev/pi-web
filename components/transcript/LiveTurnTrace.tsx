"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LayersIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useI18n } from "@/hooks/useI18n";
import { useStreamingSelector, selectStreamingMessage } from "@/hooks/useStreamingSelector";
import { createStreamingStore, type StreamingStore } from "@/lib/streaming-message";
import { formatTurnDuration } from "@/lib/turn-duration";
import { toToolView } from "@/lib/tool-view";
import type { ActivityItem } from "@/lib/turn-view";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { ToolRow } from "../ActivityRows";
import { useTraceFold } from "./TraceRow";

// 空闲 store 兜底：hooks 不能条件调用，未传 store 时订阅它（恒为初始态）。
const IDLE_STREAMING_STORE = createStreamingStore();

/**
 * 活跃回合的整轮折叠（2026-11-20 产品决策，替代旧的“流式平铺活动行”）：默认
 * 收起，行标题显示最新那个工具；展开后标题切换为“工作了 x”秒表（按秒刷新）。
 * 正在流式的工具块（还在 store 里、没落到 messages）也算最新工具：标题即时
 * 切到它，展开后在工具列表末尾以运行中行出现——否则每个工具都会先在气泡里
 * 平铺、message_end 后再“收进去”，视觉上折叠两次。折叠键与完成态 TurnTrace
 * 共用 `process:{entryId}`，settle 交换帧按已记录的选择原样接管展开/收起状态。
 */
export function LiveTurnTrace({ items, startTs, foldKey, store, toolResults, cwd, onOpenFile, onOpenSubagent, mergeStreaming = false, children }: {
  items: ActivityItem[];
  /** 回合锚点（用户消息）的 pi 时间戳：秒表的起点。 */
  startTs?: number;
  /** 与完成态 TurnTrace 同键，折叠选择跨 settle 交换帧保留。 */
  foldKey?: string;
  /** 本会话的流式 store：读正在写的消息里的工具块。 */
  store?: StreamingStore;
  toolResults?: Map<string, ToolResultMessage>;
  cwd?: string;
  onOpenFile?: (filePath: string, options?: { page?: number; line?: number }) => void;
  onOpenSubagent?: (sessionId: string, label: string) => void;
  /** 只有最后一段折叠并入流式工具（它才是“最新”）；旧段不订阅流式变化。 */
  mergeStreaming?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const { open, onOpenChange } = useTraceFold(foldKey, false);
  const streamingMessage = useStreamingSelector(mergeStreaming ? (store ?? IDLE_STREAMING_STORE) : IDLE_STREAMING_STORE, selectStreamingMessage);
  const streamingBlocks = streamingMessage?.content ?? [];
  const streamingTools = streamingBlocks.filter(
    (block): block is ToolCallContent => block.type === "toolCall",
  );
  const lastStreamingBlock = streamingBlocks.length > 0 ? streamingBlocks[streamingBlocks.length - 1] : undefined;

  // 标题的最新动作：先看正在流式的工具（它最新），没有再看已落盘的活动行。
  const latestToolTitle = (() => {
    if (streamingTools.length > 0) {
      const view = toToolView({ block: streamingTools[streamingTools.length - 1], t });
      return view.object ? `${view.title} ${view.object}` : view.title;
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "tool") {
        // 与 TraceRow 的行读法一致：动作 + 对象（如“运行 npm test”），
        // 只看标题的话所有终端工具都是同一个“运行”。
        const view = toToolView({ block: item.block, result: item.result, t });
        return view.object ? `${view.title} ${view.object}` : view.title;
      }
    }
    return undefined;
  })();

  // 思考进行中（流式末块是 thinking，或已落盘的最后一行是思考且没有更新的
  // 流式块）：标题切“思考+秒表”（2026-11-20 用户确认），首条 assistant 条目
  // 还没落盘时这是折叠行唯一的内容。已落盘的思考行用自身时长，不再走秒表。
  const streamingThinking = streamingTools.length === 0 && lastStreamingBlock?.type === "thinking";
  const lastItem = items.at(-1);
  const landedThinking = lastItem?.kind === "thinking" ? lastItem : undefined;

  // 秒表走动的场景：展开态、还没有任何工具标题、或思考正在流式。
  const showElapsed = open || latestToolTitle === undefined || streamingThinking;

  // 展开态（或还没有任何工具时）标题走秒表：起点用 pi 的时间戳，走动的一端
  // 只能取浏览器时钟——跨机时钟偏差由产品决策接受（旧“全程只用 pi 时钟”的
  // 规则仅对完成态时长保留）。回合结束组件即卸载，定时器随之清理。
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - (startTs ?? Date.now())));
  useEffect(() => {
    if (!showElapsed) return;
    const tick = () => setElapsedMs(Math.max(0, Date.now() - (startTs ?? Date.now())));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [showElapsed, startTs]);

  const thinkingTitle = streamingThinking
    ? `${t("i18n.thinking")} ${formatTurnDuration(elapsedMs)}`
    : landedThinking
      ? `${t("i18n.thinking")} ${formatTurnDuration((landedThinking.duration ?? 0) * 1000)}`
      : undefined;
  const title = streamingThinking || (latestToolTitle === undefined && thinkingTitle !== undefined)
    ? thinkingTitle
    : latestToolTitle ?? t("chat.activity.workedFor", { duration: formatTurnDuration(elapsedMs) });

  return (
    <Trace data-activity="turn">
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger aria-label={title}>
          <TraceLine>
            <TraceIcon>
              <LayersIcon className="size-3.5" />
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <Trace>
            {children}
            {streamingTools.map((block) => (
              <ToolRow
                key={`streaming-${block.toolCallId ?? block.toolName}`}
                block={block}
                // 结果还没落盘：行内订阅活跃结果，输出事件只更新它自己。
                result={toolResults?.get(block.toolCallId ?? "")}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onOpenSubagent={onOpenSubagent}
              />
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
