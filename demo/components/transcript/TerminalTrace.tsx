"use client";

import { memo, useState, type ReactNode } from "react";
import { SquareTerminalIcon, WrapTextIcon } from "lucide-react";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
export const TerminalTrace = memo(function TerminalTrace({ view, trailing, usage, below, activityTool }: {
  view: ToolView;
  trailing?: ReactNode;
  /** A call's usage bars, above the command block. */
  usage?: ReactNode;
  /** Media the call produced, below the line. */
  below?: ReactNode;
  /** The pi tool name, kept as `data-activity-tool`. */
  activityTool?: string;
}) {
  const { t } = useI18n();
  const [wrap, setWrap] = useState(false);
  const command = view.command ?? "";
  const output = view.sections.find((section) => section.kind === "code")?.text ?? "";
  const failed = view.status === "error";

  return (
    <TraceRow
      icon={view.status === "running" ? <Spinner className="size-3.5" /> : <SquareTerminalIcon />}
      title={view.title}
      description={view.description}
      status={view.status}
      foldKey={view.foldKey}
      trailing={trailing}
      usage={usage}
      below={below}
      activityTool={activityTool}
      ariaLabel={view.title}
      content={(
        <CodeBlock size="sm" variant={failed ? "destructive" : "default"} className="max-w-full">
          <CodeBlockHeader>
            <CodeBlockTitle className={wrap ? "whitespace-pre-wrap break-words" : undefined}>{`$ ${command}`}</CodeBlockTitle>
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
          <CodeBlockContent wrap={wrap} className="max-h-[var(--card-max-height)]">
            {isTuiText(output) ? <AnsiText text={output} /> : <HighlightedCode code={output} />}
          </CodeBlockContent>
        </CodeBlock>
      )}
    />
  );
});
