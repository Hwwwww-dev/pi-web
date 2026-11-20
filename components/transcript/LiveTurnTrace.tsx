"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { CollapseListButton } from "./CollapseListButton";
import { useStreamingSelector, selectStreamingMessage } from "@/hooks/useStreamingSelector";
import { createStreamingStore, type StreamingStore } from "@/lib/streaming-message";
import { formatTurnDuration } from "@/lib/turn-duration";
import { toToolView } from "@/lib/tool-view";
import { getToolCategory } from "@/lib/tool-categories";
import type { ActivityItem } from "@/lib/turn-view";
import type { ThinkingContent, ToolCallContent, ToolResultMessage } from "@/lib/types";
import { ReasoningTrace, ToolCategoryIcon, ToolRow } from "../ActivityRows";
import { FileChips } from "./ToolTrace";
import { RowObjectSpan } from "./TraceRow";
import { useTraceFold } from "./TraceRow";
import { baseName } from "@/lib/tool-view";
import type { AgentPhaseStore } from "@/lib/chat-phase-label";

// 空闲 store 兜底：hooks 不能条件调用，未传 store 时订阅它（恒为初始态）。
const IDLE_STREAMING_STORE = createStreamingStore();
const NOOP_SUBSCRIBE = () => () => {};
const NO_RUNNING_TOOLS = () => "";

/**
 * 正在跑的工具 id（按启动顺序）。`agentPhaseStore` 每次工具输出都会换值，这里
 * 只取 id 串快照：同一批工具在跑时快照不变，行标题不因输出流重渲染。
 */
function useRunningToolIds(phaseStore?: AgentPhaseStore): string[] {
  const subscribe = useCallback(
    (onChange: () => void) => (phaseStore ? phaseStore.subscribe(onChange) : NOOP_SUBSCRIBE()),
    [phaseStore],
  );
  const getSnapshot = useCallback(() => {
    const phase = phaseStore?.get();
    return phase?.kind === "running_tools" ? phase.tools.map((tool) => tool.id).join(",") : "";
  }, [phaseStore]);
  const ids = useSyncExternalStore(subscribe, getSnapshot, NO_RUNNING_TOOLS);
  return useMemo(() => (ids === "" ? [] : ids.split(",")), [ids]);
}

/**
 * 活跃回合的整轮折叠（2026-11-20 产品决策，替代旧的“流式平铺活动行”）：默认
 * 收起，行标题显示最新那个工具；展开后标题切换为“工作了 x”秒表（按秒刷新）。
 * 正在流式的工具块（还在 store 里、没落到 messages）也算最新工具：标题即时
 * 切到它，展开后在工具列表末尾以运行中行出现——否则每个工具都会先在气泡里
 * 平铺、message_end 后再“收进去”，视觉上折叠两次。折叠键与完成态 TurnTrace
 * 共用 `process:{entryId}`，settle 交换帧按已记录的选择原样接管展开/收起状态。
 */
/**
 * 折叠行标题的上滑换行（2026-11-20 用户）：标题换成另一个活动时，旧标题向上滑出、
 * 新标题从下方滑入（transform + opacity，行高不变）。同一活动的流式增长不动（key
 * 相同），思考的打字机不受影响。
 */
function SlidingTitleLine({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const lastKeyRef = useRef(swapKey);
  const lastChildrenRef = useRef<ReactNode>(children);
  const [leaving, setLeaving] = useState<ReactNode>(null);
  if (lastKeyRef.current !== swapKey) {
    // 上一帧的标题就是退场那一层：本次 render 捕获后在绝对定位层里淡出。
    lastKeyRef.current = swapKey;
    setLeaving(lastChildrenRef.current);
  }
  lastChildrenRef.current = children;
  // 退场那一层滑完就卸掉，不留永远隐形的死 DOM。
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setLeaving(null), 340);
    return () => clearTimeout(timer);
  }, [leaving]);
  return (
    <span className="relative flex min-w-0 shrink items-center gap-1 overflow-hidden">
      <span key={swapKey} className="flex min-w-0 items-center gap-1 motion-safe:animate-[trace-line-in_320ms_ease-out]">
        {children}
      </span>
      {leaving !== null && (
        <span
          key="leaving"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex min-w-0 items-center gap-1 opacity-0 motion-safe:animate-[trace-line-out_320ms_ease-in]"
        >
          {leaving}
        </span>
      )}
    </span>
  );
}

export function LiveTurnTrace({ items, startTs, foldKey, store, phaseStore, toolResults, cwd, onOpenFile, onOpenSubagent, mergeStreaming = false, children }: {
  items: ActivityItem[];
  /** 回合锚点（用户消息）的 pi 时间戳：秒表的起点。 */
  startTs?: number;
  /** 与完成态 TurnTrace 同键，折叠选择跨 settle 交换帧保留。 */
  foldKey?: string;
  /** 本会话的流式 store：读正在写的消息里的工具块。 */
  store?: StreamingStore;
  /** 运行阶段 store：正在跑的工具是权威（标题跟得上实际，而不是最后一个工具块）。 */
  phaseStore?: AgentPhaseStore;
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

  // 正在跑的工具（agentPhase 是权威）：一次 assistant 条目可含多个 toolCall，
  // 它们按顺序执行，末块不一定在跑；只看“最新工具”会显示上一个工具，看起来
  // 像滞后（2026-11-20 用户反馈）。只订阅 id 串，工具输出每秒几次不会重渲染本组件。
  const runningToolIds = useRunningToolIds(phaseStore);
  const runningTool = (() => {
    for (let i = runningToolIds.length - 1; i >= 0; i--) {
      const id = runningToolIds[i];
      const streamed = streamingTools.find((block) => block.toolCallId === id);
      if (streamed) return { block: streamed, view: toToolView({ block: streamed, t }) };
      for (let j = items.length - 1; j >= 0; j--) {
        const item = items[j];
        if (item.kind === "tool" && item.block.toolCallId === id) {
          return { block: item.block, view: toToolView({ block: item.block, result: item.result, t }) };
        }
      }
    }
    return undefined;
  })();

  // 标题的最新活动：先看正在跑的工具（权威），没有再看正在流式的工具，最后看
  // 已落盘的活动行。
  const latestTool = runningTool ?? (() => {
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

  // 思考进行中（流式末块是 thinking 且没有工具在跑，或最后一条已落盘的思考
  // 还在增长——时长未定）＝标题直接嵌入思考行组件，内容尾打字机更新。
  const streamingThinking = lastStreamingBlock?.type === "thinking";
  const streamingText = lastStreamingBlock?.type === "text";
  const lastItem = items.at(-1);
  const landedThinking = lastItem?.kind === "thinking" ? lastItem : undefined;
  // 末块是思考就是思考（同一消息里已流过的工具块不算“正在发生的事”）。
  const thinkingBlock: ThinkingContent | undefined = streamingThinking
    ? (lastStreamingBlock as ThinkingContent)
    : landedThinking?.block;
  // 思考行“活着”的判定（2026-11-20 用户：思考行折叠时就要以打字机显示末端
  // 内容）：没有工具在跑、也没有文字在写，而最后一样东西是思考。不判定它的话，
  // 思考落盘后的每段新增都直接跳到全文（已落盘且还在长也算——思考在写）。
  const thinkingLive = runningTool === undefined
    && !streamingText
    && (streamingThinking || (landedThinking !== undefined && lastStreamingBlock === undefined));
  // 展开体里有没有东西：「收起列表」只对真内容有意义（刚起步时两边都空）。
  const hasBody = items.length > 0 || streamingThinking || streamingTools.length > 0;

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
  // 没必要再在标题里重复最新活动）；收起=眼下正在发生的事：正在跑的工具 >
  // 正在写的思考 > 最新工具 > 最新思考 > 工作中。
  const titleTool = thinkingLive ? undefined : latestTool;
  const title = open
    ? t("chat.activity.working")
    : titleTool
      ? (titleTool.view.object ? `${titleTool.view.title} ${titleTool.view.object}` : titleTool.view.title)
      : thinkingBlock
        ? t("i18n.thinking")
        : t("chat.activity.working");
  // 标题换行的动画键：换成另一个活动（工具→工具、工具↔思考、工作中）才滑动，
  // 同一活动的流式增长不动。
  const titleSwapKey = open
    ? "working"
    : titleTool
      ? `tool:${titleTool.block.toolCallId ?? titleTool.view.title}`
      : thinkingBlock
        ? "thinking"
        : "working";
  // 打字机进度跟着折叠键走：段重组/列表重读重挂载后接着吐，不整段蹦出。
  const thinkingProgressKey = foldKey ? `${foldKey}:thinking` : undefined;
  const titleView = titleTool?.view;
  const titleCategory = titleView ? getToolCategory(titleTool.block.toolName) : undefined;
  // 折叠行标题只需三样（2026-11-20 用户）：动作、内容（最新的那一个文件/命令）、秒表。
  // 多文件只拿最后那个；胶囊已经写出的文件名不再重复写进对象位（与 ToolTrace 同规则）。
  const titlePath = titleView?.filePaths.at(-1);
  const titleObject = titleView?.object !== undefined && (titlePath === undefined || baseName(titlePath) !== titleView.object)
    ? titleView.object
    : undefined;

  return (
    <Trace data-activity="turn">
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger aria-label={title} className="w-full">
          {/* 行固定占 80% 宽（2026-11-20 用户拍板）：所有工具行/思考行/标题行
              同一形状，流式吐字时右侧时长不再左右晃。80% 落在触发区上（宽度
              确定），行本身 100% 铺满——之前两层都写 `w-full max-w-[80%]`，
              百分比在 fit-content 祖先上循环解析，短文本也被截成「工…」。 */}
          <TraceLine status="running" className="w-full">
            <SlidingTitleLine swapKey={titleSwapKey}>
            {open || (!titleTool && !thinkingBlock) ? (
              <>
                <TraceIcon>
                  {titleCategory !== undefined
                    ? <ToolCategoryIcon category={titleCategory} active={open} />
                    : <LayersIcon className="size-3.5" />}
                </TraceIcon>
                <TraceTitle className="min-w-0 truncate text-left">{t("chat.activity.working")}</TraceTitle>
              </>
            ) : titleTool ? (
              // 收起态标题 = 工具行本身（与 TraceRow 同一形状：图标+动作+对象
              // 一行贴尾），时长秒表仍钉右侧。
              <>
                <TraceIcon>
                  <ToolCategoryIcon category={titleCategory ?? "terminal"} />
                </TraceIcon>
                <TraceTitle className="shrink-0 whitespace-nowrap">{titleTool.view.title}</TraceTitle>
                {/* 文件名由可点击胶囊承担（读取/编辑的对象就是文件）：只画动作
                    的话标题只剩下“读取”（2026-11-20 用户：“读取什么？”）。 */}
                {titlePath !== undefined && (
                  <span className="flex min-w-0 items-center" onClick={(event) => event.stopPropagation()}>
                    <FileChips paths={[titlePath]} cwd={cwd} onOpenFile={(path) => onOpenFile?.(path)} />
                  </span>
                )}
                {titleObject !== undefined && (
                  <span className="relative min-w-0 shrink" title={titleObject}>
                    <RowObjectSpan object={titleObject} clip={titleView?.kind === "terminal"} />
                  </span>
                )}
              </>
            ) : (
              // 最新活动是思考：直接嵌思考行组件（内容尾打字机）。
              <ReasoningTrace
                asLine
                block={thinkingBlock as ThinkingContent}
                blockIndex={-1}
                active={thinkingLive}
                duration={landedThinking?.duration}
                progressKey={thinkingProgressKey}
              />
            )}
            </SlidingTitleLine>
            <TraceDescription>{formatTurnDuration(elapsedMs)}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="trace-fold-body trace-turn-body flex flex-col gap-2">
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
          {/* 运行中同样能原地收起（标题在视口上方时不必滚回去）。没有内容时
              （刚起步、还在等首块）不显示：按钮上方什么都没有，没有可收的东西。 */}
          {open && hasBody && (
            <CollapseListButton onClick={() => onOpenChange(false)} label={t("chat.collapseList")} />
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
