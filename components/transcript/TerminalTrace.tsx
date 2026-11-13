"use client";

import { memo, useState, type ReactNode } from "react";
import { SquareTerminalIcon, WrapTextIcon } from "lucide-react";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { AnsiText } from "@/components/AnsiText";
import { HighlightedCode } from "@/components/HighlightedCode";
import { isTuiText } from "@/lib/ansi";
import { useI18n } from "@/hooks/useI18n";
import type { ToolView } from "@/lib/tool-view";
import type { StepUsage } from "@/lib/turn-view";
import { TraceRow } from "./TraceRow";

/**
 * A shell command (official `pattern_terminal.md`): the command is the header, the
 * output is the block. Same 5.2 line, different content slot — the header is
 * what a terminal call has and a file read does not.
 */
export const TerminalTrace = memo(function TerminalTrace({ view, trailing, below, activityTool, stepUsage }: {
  view: ToolView;
  trailing?: ReactNode;
  /** Media the call produced, below the line. */
  below?: ReactNode;
  /** The pi tool name, kept as `data-activity-tool`. */
  activityTool?: string;
  /** The issuing request's usage: the expanded card's first line (TraceRow draws it). */
  stepUsage?: StepUsage;
}) {
  const { t } = useI18n();
  const [wrap, setWrap] = useState(true);
  const command = view.command ?? "";
  const output = view.sections.find((section) => section.kind === "code")?.text ?? "";
  const failed = view.status === "error";

  return (
    <TraceRow
      icon={<SquareTerminalIcon className="size-3.5" />}
      title={view.title}
      object={view.object}
      description={view.description}
      status={view.status}
      foldKey={view.foldKey}
      trailing={trailing}
      below={below}
      activityTool={activityTool}
      stepUsage={stepUsage}
      ariaLabel={view.object ? `${view.title} ${view.object}` : view.title}
      content={(
        <CodeBlock size="sm" variant={failed ? "destructive" : "default"} className="max-w-full">
          <CodeBlockHeader className="min-h-9 items-center pt-1.5 pb-1.5 group-data-[size=sm]/code-block:pt-1.5 group-data-[size=sm]/code-block:pb-1.5">
            <CodeBlockTitle className="text-muted-foreground">{t("chat.trace.command")}</CodeBlockTitle>
            <CodeBlockActions>
              {/* 默认不换行（高度可控），需查看完整命令时再切换换行。 */}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={wrap ? t("chat.trace.unwrap") : t("chat.trace.wrap")}
                title={wrap ? t("chat.trace.unwrap") : t("chat.trace.wrap")}
                aria-pressed={wrap}
                data-active={wrap || undefined}
                onClick={() => setWrap((value) => !value)}
              >
                <WrapTextIcon />
              </Button>
              <CodeBlockCopyButton value={command} />
            </CodeBlockActions>
          </CodeBlockHeader>
          {/* 高度总计封顶于 --card-max-height：命令占 6 份、结果占 4 份，超出部分各自滚动。
              百分比 max-height 需要确定高度的父元素，而此盒子仅有 max-height，
              百分比无法解析，命令会占据整张卡，故按总上限计算长度。 */}
          <div className="flex max-h-[var(--card-max-height)] min-h-0 flex-col">
            <div className="max-h-[calc(var(--card-max-height)*0.6)] min-h-0 overflow-auto p-2.5">
              <span className={cn(
                "font-mono text-[length:calc(13px+var(--chat-font-size-offset,0px))] text-foreground",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}>{`$ ${command}`}</span>
            </div>
            <Separator className="bg-border/60" />
            <div className="max-h-[calc(var(--card-max-height)*0.4)] min-h-0 overflow-auto p-2.5">
              {/* 结果的行内换行属于内容本身（图形、表格与对齐依赖空格与换行），
                  故最内层须自带 whitespace-pre*：HighlightedCode 仅输出 token，
                  不含 <pre>，缺少该层会被折叠为一段。 */}
              <div className={cn(
                "font-mono text-[length:calc(13px+var(--chat-font-size-offset,0px))] text-muted-foreground",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}>
                {isTuiText(output) ? <AnsiText text={output} /> : <HighlightedCode code={output} />}
              </div>
            </div>
          </div>
        </CodeBlock>
      )}
    />
  );
});
