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
import { HighlightedCode } from "@/components/HighlightedCode";
import { Button } from "@/components/ui/button";
import { isTuiText } from "@/lib/ansi";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { PatchDiffFiles } from "@/components/PatchDiffFiles";
import { SafeMarkdownBody } from "@/components/SafeMarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { resolveLocalFilePath } from "@/lib/file-links";
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
  label?: ToolViewSection["label"];
  wrap?: boolean;
}) {
  const { t } = useI18n();
  // 官方形状：标签是 CodeBlock 自己的 header，不是浮在卡片外的一行文字。
  return (
    <CodeBlock size="sm" data-language={language}>
      {label && (
        <CodeBlockHeader>
          <CodeBlockTitle>{t(`chat.activity.${label}`)}</CodeBlockTitle>
        </CodeBlockHeader>
      )}
      <CodeBlockContent wrap={wrap} className="max-h-[var(--card-max-height)]" tabIndex={0}>
        <HighlightedCode code={text} language={language} />
      </CodeBlockContent>
    </CodeBlock>
  );
}

function FieldsSection({ section }: { section: ToolViewSection }) {
  const { t } = useI18n();
  return (
    <CodeBlock size="sm">
      {section.label && (
        <CodeBlockHeader>
          <CodeBlockTitle>{t(`chat.activity.${section.label}`)}</CodeBlockTitle>
        </CodeBlockHeader>
      )}
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
    <Trace>
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
        : <CodeSection text={section.text ?? ""} language={section.language} label={section.label} wrap={true} />;
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
 * The files a call named (第 4 节): one official outline pill each, opening the
 * viewer at that file. Pills only appear when the viewer can take them.
 */
function FileChips({ paths, cwd, onOpenFile }: { paths: string[]; cwd?: string; onOpenFile: (path: string) => void }) {
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5">
      {paths.slice(0, MAX_FILE_CHIPS).map((path) => {
        // A call names files relative to the session cwd; the viewer needs the absolute path.
        const resolved = resolveLocalFilePath(path, cwd);
        const label = baseName(resolved ?? path);
        return (
          <Button
            key={path}
            type="button"
            variant="outline"
            size="sm"
            disabled={!resolved}
            className="max-w-[12rem] shrink-0 gap-1 rounded-full px-2 font-mono text-[length:calc(11px+var(--chat-font-size-offset,0px))]"
            title={resolved ?? path}
            aria-label={label}
            onClick={(event) => {
              // The row toggles on click; opening a file is not a toggle.
              event.stopPropagation();
              if (resolved) onOpenFile(resolved);
            }}
          >
            <FileTextIcon className="size-3 shrink-0" />
            <span className="truncate">{label}</span>
          </Button>
        );
      })}
    </span>
  );
}

export const ToolTrace = memo(function ToolTrace({ view, trailing, below, activityTool, cwd, onOpenFile }: {
  view: ToolView;
  /** Duration belongs to the turn, not the tool (第 8 节). */
  trailing?: ReactNode;
  /** Media the call produced, below the line. */
  below?: ReactNode;
  /** The pi tool name, kept as `data-activity-tool`. */
  activityTool?: string;
  /** The session directory a chip's relative path resolves against. */
  cwd?: string;
  /** Opens a file the call named (its chips). */
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useI18n();
  // chip 就是文件名本身（标题只说动作），点它打开文件。
  const chips = onOpenFile && view.filePaths.length > 0
    ? <FileChips paths={view.filePaths} cwd={cwd} onOpenFile={onOpenFile} />
    : null;
  // The chip already carries the name; a description that repeats it is noise (第 4 节).
  const repeatsChip = view.filePaths.some((path) =>
    path === view.description || baseName(path) === view.description);
  const description = view.streamingInput
    ? t("chat.generatingToolInput")
    : chips && repeatsChip ? undefined : view.description;
  const content = view.sections.length > 0
    ? view.sections.map((section, index) => <ToolSection key={index} section={section} />)
    : undefined;

  return (
    <TraceRow
      icon={view.status === "running" ? <Spinner className="size-3.5" /> : KIND_ICONS[view.kind]}
      title={view.title}
      object={view.object}
      chips={chips}
      description={description}
      status={view.status}
      foldKey={view.foldKey}
      trailing={trailing}
      below={below}
      activityTool={activityTool}
      content={content}
      ariaLabel={view.object ? `${view.title} ${view.object}` : view.title}
    />
  );
});
