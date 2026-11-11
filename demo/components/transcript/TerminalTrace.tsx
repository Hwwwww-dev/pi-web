"use client";

import { memo, type ReactNode } from "react";
import { SquareTerminalIcon } from "lucide-react";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Spinner } from "@/components/ui/spinner";
import { AnsiText } from "@/components/AnsiText";
import { HighlightedCode } from "@/components/HighlightedCode";
import { isTuiText } from "@/lib/ansi";
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
            <CodeBlockTitle>{`$ ${command}`}</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton value={command} />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent wrap={false} className="max-h-[var(--card-max-height)]">
            {isTuiText(output) ? <AnsiText text={output} /> : <HighlightedCode code={output} />}
          </CodeBlockContent>
        </CodeBlock>
      )}
    />
  );
});
