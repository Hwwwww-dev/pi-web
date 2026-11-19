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
import { formatTurnDuration } from "@/lib/turn-duration";
import { toToolView } from "@/lib/tool-view";
import type { ActivityItem } from "@/lib/turn-view";
import { useTraceFold } from "./TraceRow";

/**
 * 活跃回合的整轮折叠（2026-11-20 产品决策，替代旧的“流式平铺活动行”）：默认
 * 收起，行标题显示最新那个工具；展开后标题切换为“工作了 x”秒表（按秒刷新）。
 * 折叠键与完成态 TurnTrace 共用 `process:{entryId}`，settle 交换帧按已记录的
 * 选择原样接管展开/收起状态，不再有“先展开再自动收起”的过渡。
 */
export function LiveTurnTrace({ items, startTs, foldKey, children }: {
  items: ActivityItem[];
  /** 回合锚点（用户消息）的 pi 时间戳：秒表的起点。 */
  startTs?: number;
  /** 与完成态 TurnTrace 同键，折叠选择跨 settle 交换帧保留。 */
  foldKey?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { open, onOpenChange } = useTraceFold(foldKey, false);

  // 收起且已有工具可显示时，标题就是最新工具，秒表不跑也无需重渲染。
  const latestToolTitle = (() => {
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
  const showElapsed = open || latestToolTitle === undefined;

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

  const title = showElapsed
    ? t("chat.activity.workedFor", { duration: formatTurnDuration(elapsedMs) })
    : latestToolTitle;

  return (
    <Trace data-activity="turn">
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger aria-label={title}>
          <TraceLine>
            <TraceIcon>
              <LayersIcon className="size-3.5" />
            </TraceIcon>
            <TraceTitle className="font-medium">{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <Trace>{children}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
