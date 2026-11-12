"use client";

import { memo, type ReactNode } from "react";
import {
  BotIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CodeXmlIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  ListTodoIcon,
  MessageCircleQuestionIcon,
  Minimize2Icon,
  NotebookPenIcon,
  PlugIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnsiText } from "@/components/AnsiText";
import { HighlightedCode } from "@/components/HighlightedCode";
import { Button } from "@/components/ui/button";
import { isTuiText } from "@/lib/ansi";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
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

const ICON_CLASS = "size-3.5";

/** 默认中性灰，图标本身不带颜色。 */
export const KIND_ICONS: Record<ToolViewKind, ReactNode> = {
  terminal: <SquareTerminalIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  "file-read": <FileTextIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  "file-write": <FilePenIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  "file-edit": <NotebookPenIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  search: <SearchIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  web: <GlobeIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  codemode: <CodeXmlIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  subagent: <BotIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  mcp: <PlugIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  queue: <ListTodoIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  question: <MessageCircleQuestionIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  compact: <Minimize2Icon className={cn(ICON_CLASS, "text-muted-foreground")} />,
  generic: <WrenchIcon className={cn(ICON_CLASS, "text-muted-foreground")} />,
};

/** 展开时换成这一类自己的颜色，不填黑、不加粗。 */
export const KIND_ACTIVE_ICONS: Record<ToolViewKind, ReactNode> = {
  terminal: <SquareTerminalIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  "file-read": <FileTextIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  "file-write": <FilePenIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  "file-edit": <NotebookPenIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  search: <SearchIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  web: <GlobeIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  codemode: <CodeXmlIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  subagent: <BotIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  mcp: <PlugIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  queue: <ListTodoIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  question: <MessageCircleQuestionIcon className={cn(ICON_CLASS, "text-primary/70")} />,
  compact: <Minimize2Icon className={cn(ICON_CLASS, "text-primary/70")} />,
  generic: <WrenchIcon className={cn(ICON_CLASS, "text-primary/70")} />,
};

const STEP_ICONS: Record<ToolViewStatus, ReactNode> = {
  running: <CircleDotIcon className="text-warning" />,
  done: <CircleCheckIcon />,
  pending: <CircleIcon />,
  error: <CircleIcon className="text-destructive" />,
};

function CodeSection({ text, language, wrap = true, lineNumbers = true }: {
  text: string;
  language?: string;
  wrap?: boolean;
  /** 代码文件的每一块都要有行号（用户要求）；行号与内容同一行高，所以带行号时不折行。 */
  lineNumbers?: boolean;
}) {
  const body = text.replace(/\n$/, "");
  const lineCount = body.split("\n").length;
  const gutter = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  const wrapped = lineNumbers ? false : wrap;
  // 裸代码块：行里已经写了动作和文件，“参数/结果”这种标签只制造两层卡。
  return (
    <CodeBlock size="sm" data-language={language}>
      <CodeBlockContent wrap={wrapped} className="max-h-[var(--card-max-height)]" tabIndex={0}>
        {lineNumbers ? (
          <span data-slot="code-gutter" className="flex min-w-0">
            <span
              aria-hidden="true"
              className="me-3 shrink-0 select-none whitespace-pre text-end tabular-nums text-muted-foreground"
            >
              {gutter}
            </span>
            <span className="min-w-0 whitespace-pre">
              <HighlightedCode code={text} language={language} />
            </span>
          </span>
        ) : (
          <HighlightedCode code={text} language={language} />
        )}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function FieldsSection({ section }: { section: ToolViewSection }) {
  const { t } = useI18n();
  return (
    <CodeBlock size="sm">
      {section.label && (
        <CodeBlockHeader className="min-h-9 items-center">
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
      // 源文件结果与文件预览同一形态：行号 + 不折行（用户：各种不统一、完全割裂）。
      return isTuiText(section.text ?? "")
        ? <AnsiText text={section.text ?? ""} />
        : (
          <CodeSection
            text={section.text ?? ""}
            language={section.language}
            wrap={section.language === undefined || section.language === "text"}
          />
        );
    case "diff":
      return section.files
        ? <PatchDiffFiles files={section.files} layout={isMobile ? "stacked" : "split"} />
        : <CodeSection text={section.text ?? ""} wrap={false} />;
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
    // 胶囊组占“剩下的空间”：以前是 shrink-0，名单一长就把行撑超宽，
    // 行又是 overflow-hidden，于是被裁掉的是前面的动作名（“编辑”只剩“编”）。
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {paths.slice(0, MAX_FILE_CHIPS).map((path) => {
        // A call names files relative to the session cwd; the viewer needs the absolute path.
        const resolved = resolveLocalFilePath(path, cwd);
        const label = baseName(resolved ?? path);
        return (
          <Button
            key={path}
            type="button"
            variant="outline"
            size="xs"
            disabled={!resolved}
            // 胶囊给名字留一个上限：手机上更窄（半个屏），超长文件名自己省略号，
            // 而不能把前面的动作名和后面的 +N/-N 挤出可见区。
            className="min-w-0 shrink gap-1 overflow-hidden rounded-full px-2 font-mono text-[length:calc(13px+var(--chat-font-size-offset,0px))]"
            title={resolved ?? path}
            aria-label={label}
            onClick={(event) => {
              // The row toggles on click; opening a file is not a toggle.
              event.stopPropagation();
              if (resolved) onOpenFile(resolved);
            }}
          >
            <FileTextIcon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
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
  // 对象同样不能和 chip 说两遍（“编辑 tool-view.ts [tool-view.ts]”）。
  const chipNamesObject = chips !== null && view.object !== undefined
    && view.filePaths.some((path) => baseName(path) === view.object || path === view.object);
  const description = view.streamingInput
    ? t("chat.generatingToolInput")
    : chips && repeatsChip ? undefined : view.description;
  // 读取/写入/编辑只给代码块：path、offset、limit 这些参数细节是工具的内部账，不是要读的东西。
  const hideFields = view.kind === "file-read" || view.kind === "file-write" || view.kind === "file-edit";
  const sections = hideFields ? view.sections.filter((section) => section.kind !== "fields") : view.sections;
  const content = sections.length > 0
    ? sections.map((section, index) => <ToolSection key={index} section={section} />)
    : undefined;

  return (
    <TraceRow
      icon={KIND_ICONS[view.kind]}
      activeIcon={KIND_ACTIVE_ICONS[view.kind]}
      title={view.title}
      object={chipNamesObject ? undefined : view.object}
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
