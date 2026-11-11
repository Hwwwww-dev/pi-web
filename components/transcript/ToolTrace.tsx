"use client";

import { memo, type ReactNode } from "react";
import {
  BotIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  ListTodoIcon,
  PenIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { AnsiText } from "@/components/AnsiText";
import { Button } from "@/components/ui/button";
import { isTuiText } from "@/lib/ansi";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "@/components/ui/code-block";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { PatchDiffFiles } from "@/components/PatchDiffFiles";
import { SafeMarkdownBody } from "@/components/SafeMarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { baseName, type ToolView, type ToolViewKind, type ToolViewSection, type ToolViewStatus, type ToolViewStep } from "@/lib/tool-view";
import { TraceRow } from "./TraceRow";

/**
 * One tool call as a trace line (官方 `pattern_tool.md`): icon + title, the
 * arguments and the result inside the fold. The icon, title and content slot
 * follow `ToolView.kind`; nothing about the layout is per-tool.
 */

const KIND_ICONS: Record<ToolViewKind, ReactNode> = {
  terminal: <SquareTerminalIcon />,
  "file-read": <FileTextIcon />,
  "file-write": <PenIcon />,
  "file-edit": <PenIcon />,
  search: <SearchIcon />,
  web: <GlobeIcon />,
  codemode: <CodeIcon />,
  subagent: <BotIcon />,
  mcp: <WrenchIcon />,
  queue: <ListTodoIcon />,
  generic: <WrenchIcon />,
};

const STEP_ICONS: Record<ToolViewStatus, ReactNode> = {
  running: <CircleDotIcon className="text-warning" />,
  done: <CircleCheckIcon />,
  pending: <CircleIcon />,
  error: <CircleIcon className="text-destructive" />,
};

function CodeSection({ text, language, label, wrap = true }: {
  text: string;
  language?: string;
  label?: string;
  wrap?: boolean;
}) {
  return (
    <CodeBlock size="sm" data-language={language}>
      {label && <CodeBlockLine className="text-muted-foreground">{label}</CodeBlockLine>}
      <CodeBlockContent wrap={wrap} className="max-h-[var(--card-max-height)]" tabIndex={0}>
        {text}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function FieldsSection({ section }: { section: ToolViewSection }) {
  return (
    <CodeBlock size="sm">
      <CodeBlockContent wrap className="max-h-[var(--card-max-height)]">
        {(section.fields ?? []).map((field) => (
          <CodeBlockLine key={field.key}>
            <span className="text-muted-foreground">{field.key}</span>
            {": "}
            {field.value}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function StepsSection({ steps }: { steps: ToolViewStep[] }) {
  return (
    <Trace className="gap-1">
      {steps.map((step, index) => (
        <TraceLine key={index} status={step.status === "error" ? "error" : step.status === "pending" ? "pending" : step.status === "running" ? "running" : undefined}>
          <TraceIcon>{STEP_ICONS[step.status]}</TraceIcon>
          <TraceTitle>{step.title}</TraceTitle>
          {step.description && <TraceDescription>{step.description}</TraceDescription>}
        </TraceLine>
      ))}
    </Trace>
  );
}

/**
 * A section's content slot. Each kind picks an existing底座 — `CodeBlock`,
 * the patch view, Markdown — instead of a transcript-only look.
 */
export function ToolSection({ section }: { section: ToolViewSection }) {
  const isMobile = useIsMobile();
  switch (section.kind) {
    case "code":
      // TUI 输出（ANSI 转义）只能按终端文本渲染，code block 会原样显示转义序列。
      return isTuiText(section.text ?? "")
        ? <AnsiText text={section.text ?? ""} />
        : <CodeSection text={section.text ?? ""} language={section.language} label={section.label} />;
    case "diff":
      return section.files
        ? <PatchDiffFiles files={section.files} layout={isMobile ? "stacked" : "split"} />
        : <CodeSection text={section.text ?? ""} label={section.label} wrap={false} />;
    case "markdown":
      return <SafeMarkdownBody>{section.text ?? ""}</SafeMarkdownBody>;
    case "fields":
      return <FieldsSection section={section} />;
    case "steps":
      return <StepsSection steps={section.steps ?? []} />;
    default:
      return null;
  }
}

/** A row names at most this many files: a call that touches fifty would bury its own title. */
const MAX_FILE_CHIPS = 4;

/**
 * The files a call named (第 4.1 节): one chip each, opening the viewer at that
 * file. Chips only appear when the viewer can take them.
 */
function FileChips({ paths, onOpenFile }: { paths: string[]; onOpenFile: (path: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {paths.slice(0, MAX_FILE_CHIPS).map((path) => (
        <Button
          key={path}
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 font-mono text-[length:calc(11px+var(--chat-font-size-offset,0px))]"
          onClick={() => onOpenFile(path)}
          title={path}
        >
          <FileTextIcon className="size-3" />
          {baseName(path)}
        </Button>
      ))}
    </div>
  );
}

export const ToolTrace = memo(function ToolTrace({ view, trailing, usage, below, activityTool, onOpenFile }: {
  view: ToolView;
  /** Duration and usage belong to the turn, not the tool (第 8 节). */
  trailing?: ReactNode;
  /** A call's usage bars, above the sections. */
  usage?: ReactNode;
  /** Media the call produced, below the line. */
  below?: ReactNode;
  /** The pi tool name, kept as `data-activity-tool`. */
  activityTool?: string;
  /** Opens a file the call named (its chips). */
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useI18n();
  const chips = onOpenFile && view.filePaths.length > 0
    ? <FileChips paths={view.filePaths} onOpenFile={onOpenFile} />
    : null;
  const content = chips || view.sections.length > 0
    ? (
      <>
        {chips}
        {view.sections.map((section, index) => <ToolSection key={index} section={section} />)}
      </>
    )
    : undefined;

  return (
    <TraceRow
      icon={view.status === "running" ? <Spinner className="size-3.5" /> : KIND_ICONS[view.kind]}
      title={view.title}
      description={view.streamingInput ? t("chat.generatingToolInput") : view.description}
      status={view.status}
      foldKey={view.foldKey}
      trailing={trailing}
      usage={usage}
      below={below}
      activityTool={activityTool}
      content={content}
      ariaLabel={view.title}
    />
  );
});
