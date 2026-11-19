"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LayersIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useI18n } from "@/hooks/useI18n";
import { useStreamingSelector, selectStreamingMessage } from "@/hooks/useStreamingSelector";
import { createStreamingStore, type StreamingStore } from "@/lib/streaming-message";
import { formatTurnDuration } from "@/lib/turn-duration";
import { toToolView } from "@/lib/tool-view";
import { getToolCategory } from "@/lib/tool-categories";
import type { ActivityItem } from "@/lib/turn-view";
import type { ThinkingContent, ToolCallContent, ToolResultMessage } from "@/lib/types";
import { ReasoningTrace, ToolCategoryIcon, ToolRow } from "../ActivityRows";
import { RowObjectSpan } from "./TraceRow";
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

  // 标题的最新活动：先看正在流式的工具（它最新），没有再看已落盘的活动行。
  // 行内折叠直接显示最新工具行本身（2026-11-20 用户拍板）：工具自己的分类图标
  // + 动作 + 对象（如“运行 npm test”）；编辑附变更数（+N −M）在右侧时长旁边。
  const latestTool = (() => {
    if (streamingTools.length > 0) {
      const block = streamingTools[streamingTools.length - 1];
      return { block, view: toToolView({ block, t }) };
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "tool") {
        // 与 TraceRow 的行读法一致：动作 + 对象（如“运行 npm test”），
        // 只看标题的话所有终端工具都是同一个“运行”。
        return { block: item.block, view: toToolView({ block: item.block, result: item.result, t }) };
      }
    }
    return undefined;
  })();
  const toolCategory = latestTool ? getToolCategory(latestTool.block.toolName) : undefined;
  const diffStat = latestTool?.view.diffStat;

  // 思考进行中（流式末块是 thinking，或已落盘的最后一行是思考且没有更新的
  // 流式块）：标题直接嵌入思考行组件（2026-11-20 用户拍板：标题用对应组件，
  // 不再拼字符串）——内容尾打字机更新。工具进行中同理嵌入工具行形状。
  const streamingThinking = streamingTools.length === 0 && lastStreamingBlock?.type === "thinking";
  const lastItem = items.at(-1);
  const landedThinking = lastItem?.kind === "thinking" ? lastItem : undefined;
  const thinkingBlock: ThinkingContent | undefined = streamingThinking
    ? (lastStreamingBlock as ThinkingContent)
    : landedThinking?.block;

  // 秒表常驻右侧（2026-11-20）：内容没撑满时跟在标题后面，撑满时标题压缩、
  // 时长钉在右端（TraceLine 的 w-fit / max-w-full + TraceTitle truncate 实现）。
  // 起点用 pi 的时间戳，走动的一端只能取浏览器时钟——跨机时钟偏差由产品决策
  // 接受。回合结束组件即卸载，定时器随之清理。
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - (startTs ?? Date.now())));
  useEffect(() => {
    const tick = () => setElapsedMs(Math.max(0, Date.now() - (startTs ?? Date.now())));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startTs]);

  // 标题形态（2026-11-20 用户拍板）：展开=「工作中」（内容全在折叠体内，
  // 没必要再在标题里重复最新活动）；收起=最新活动（流式思考末行或最新工具）。
  // 展开体含全部已落盘活动行（children）+ 流式中的思考/工具行。
  // 展开态标题「工作中」；收起态 = 最新活动的行本身（工具行形状/思考行组件）。
  const title = open
    ? t("chat.activity.working")
    : latestTool
      ? (latestTool.view.object ? `${latestTool.view.title} ${latestTool.view.object}` : latestTool.view.title)
      : thinkingBlock
        ? t("i18n.thinking")
        : t("chat.activity.working");

  return (
    <Trace data-activity="turn">
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger aria-label={title}>
          {/* 行固定占 80% 宽（2026-11-20 用户拍板）：所有工具行/思考行/标题行
              同一形状，流式吐字时右侧时长不再左右晃。 */}
          <TraceLine status="running" className="w-full max-w-[80%]">
            {open || (!latestTool && !thinkingBlock) ? (
              <>
                <TraceIcon>
                  {toolCategory !== undefined
                    ? <ToolCategoryIcon category={toolCategory} active={open} />
                    : <LayersIcon className="size-3.5" />}
                </TraceIcon>
                <TraceTitle className="flex-1 truncate text-left">{t("chat.activity.working")}</TraceTitle>
              </>
            ) : latestTool ? (
              // 收起态标题 = 工具行本身（与 TraceRow 同一形状：图标+动作+对象
              // 截左保右），时长秒表仍钉右侧。
              <>
                <TraceIcon>
                  <ToolCategoryIcon category={toolCategory ?? "terminal"} />
                </TraceIcon>
                <TraceTitle className="shrink-0 whitespace-nowrap">{latestTool.view.title}</TraceTitle>
                {latestTool.view.object && (
                  <span className="relative min-w-0 flex-1" title={latestTool.view.object}>
                    <RowObjectSpan object={latestTool.view.object} />
                  </span>
                )}
              </>
            ) : (
              // 最新活动是思考：直接嵌思考行组件（内容尾打字机）。
              <ReasoningTrace
                asLine
                block={thinkingBlock as ThinkingContent}
                blockIndex={-1}
                active={streamingThinking}
                duration={landedThinking?.duration}
              />
            )}
            {diffStat && (
              <TraceDescription>
                <span className="text-success">+{diffStat.added}</span>{" "}
                <span className="text-destructive">−{diffStat.removed}</span>
              </TraceDescription>
            )}
            <TraceDescription>{formatTurnDuration(elapsedMs)}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <Trace>
            {children}
            {/* 正在流式的思考也进展开体（2026-11-20 用户反馈“展开后没有思考行”）:
                它同时是折叠标题；落盘的思考行由 children 的 TurnActivityBody 出。 */}
            {streamingThinking && lastStreamingBlock?.type === "thinking" && (
              <ReasoningTrace block={lastStreamingBlock as ThinkingContent} blockIndex={-1} active />
            )}
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
