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
import { TraceRow } from "./TraceRow";

/**
 * A shell command (官方 `pattern_terminal.md`): the command is the header, the
 * output is the block. Same 5.2 line, different content slot — the header is
 * what a terminal call has and a file read does not.
 */
export const TerminalTrace = memo(function TerminalTrace({ view, trailing, below, activityTool }: {
  view: ToolView;
  trailing?: ReactNode;
  /** Media the call produced, below the line. */
  below?: ReactNode;
  /** The pi tool name, kept as `data-activity-tool`. */
  activityTool?: string;
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
      ariaLabel={view.object ? `${view.title} ${view.object}` : view.title}
      content={(
        <CodeBlock size="sm" variant={failed ? "destructive" : "default"} className="max-w-full">
          <CodeBlockHeader>
            <CodeBlockTitle className="text-muted-foreground">{t("chat.trace.command")}</CodeBlockTitle>
            <CodeBlockActions>
              {/* 默认不换行（高度可控），需要看完整命令时再换行。 */}
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
          {/* 总数封顶在 --card-max-height 内：命令占 6 份、结果占 4 份，各自超出就自己滚。 */}
          <div className="flex max-h-[var(--card-max-height)] min-h-0 flex-col">
            <div className="max-h-[60%] min-h-0 overflow-auto p-2.5">
              <span className={cn(
                "font-mono text-[length:calc(13px+var(--chat-font-size-offset,0px))] text-foreground",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}>{`$ ${command}`}</span>
            </div>
            <Separator className="bg-border/60" />
            <div className="max-h-[40%] min-h-0 overflow-auto p-2.5">
              {isTuiText(output) ? <AnsiText text={output} /> : <HighlightedCode code={output} />}
            </div>
          </div>
        </CodeBlock>
      )}
    />
  );
});
