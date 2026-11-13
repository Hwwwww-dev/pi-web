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
import type { StepUsage } from "@/lib/turn-view";
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
 * One tool call as a trace line (official `pattern_tool.md`): icon + title, the
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

/** 展开态使用该类别自身的颜色，不加粗、不用纯黑。 */
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
  /** 代码段一律显示行号；行号与内容行高一致，故带行号时不折行。 */
  lineNumbers?: boolean;
}) {
  const body = text.replace(/\n$/, "");
  const lineCount = body.split("\n").length;
  const gutter = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  const wrapped = lineNumbers ? false : wrap;
  // 裸代码块：行内已包含动作与文件，「参数/结果」标签只会叠加一层容器。
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

/** Tool outputs can reach hundreds of KB (browse or shell dumps). Feeding
 * that through ansi_up or the markdown parser stalls the frame the section
 * renders in, so the view shows head and tail around an omission notice. */
const SECTION_TEXT_HEAD_CHARS = 60_000;
const SECTION_TEXT_TAIL_CHARS = 20_000;

function clampSectionText(text: string): { text: string; omittedChars: number } {
  if (text.length <= SECTION_TEXT_HEAD_CHARS + SECTION_TEXT_TAIL_CHARS) return { text, omittedChars: 0 };
  const omittedChars = text.length - SECTION_TEXT_HEAD_CHARS - SECTION_TEXT_TAIL_CHARS;
  return {
    text: `${text.slice(0, SECTION_TEXT_HEAD_CHARS)}\n\n${text.slice(-SECTION_TEXT_TAIL_CHARS)}`,
    omittedChars,
  };
}

/**
 * A section's content slot. Each kind reuses an existing block — `CodeBlock`,
 * the patch view, Markdown — instead of a transcript-only look.
 */
export function ToolSection({ section }: { section: ToolViewSection }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const { text, omittedChars } = clampSectionText(section.text ?? "");
  const body = (() => {
    switch (section.kind) {
      case "code":
        // TUI 输出（含 ANSI 转义）只能按终端文本渲染，code block 会原样显示转义序列。
        // 源文件结果与文件预览形态一致：行号 + 不折行。
        return isTuiText(text)
          ? (
              // 与 code 段同一限高：TUI 文本没有自己的滚动容器，长输出直接撑开卡片。
              <div className="max-h-[var(--card-max-height)] overflow-y-auto overscroll-contain">
                <AnsiText text={text} />
              </div>
            )
          : (
            <CodeSection
              text={text}
              language={section.language}
              wrap={section.language === undefined || section.language === "text"}
            />
          );
      case "diff":
        return section.files
          ? <PatchDiffFiles files={section.files} layout={isMobile ? "stacked" : "split"} />
          : <CodeSection text={text} wrap={false} />;
      case "markdown":
        // 与 code/fields 段同一限高：fetch/web 的正文过去不封顶，长结果把整轮撑出视野。
        return (
          <div className="max-h-[var(--card-max-height)] overflow-y-auto overscroll-contain">
            <SafeMarkdownBody>{text}</SafeMarkdownBody>
          </div>
        );
      case "fields":
        return <FieldsSection section={section} />;
      case "steps":
        return <StepsSection steps={section.steps ?? []} />;
      default:
        return null;
    }
  })();
  return (
    <>
      {body}
      {omittedChars > 0 && (
        <p className="px-[13px] pb-2 text-xs text-muted-foreground">
          {t("i18n.toolOutputTruncated", { count: omittedChars })}
        </p>
      )}
    </>
  );
}

/** A row names at most this many files: a call that touches fifty would bury its own title. */
const MAX_FILE_CHIPS = 4;

/**
 * The files a call named (第 4 节): one official outline pill each, opening the
 * viewer at that file. Pills only appear when the viewer can take them.
 */
function FileChips({ paths, cwd, onOpenFile }: { paths: string[]; cwd?: string; onOpenFile: (path: string) => void }) {
  return (
    // 胶囊组不参与 grow：行是 `w-fit`，grow 子项会把行的固有宽度按 0 计算，
    // 导致行宽小于内容、胶囊提前省略。`flex: 0 1 auto` 先按完整文件名撑到 `max-w-full`，排不下才收缩。
    <span className="flex min-w-0 items-center gap-1.5">
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
            // 胶囊为文件名设定上限：手机端更窄（约半屏），超长文件名自身省略，
            // 避免将前置动作名与后置 +N/-N 挤出可见区。
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

export const ToolTrace = memo(function ToolTrace({ view, trailing, below, stepUsage, activityTool, cwd, onOpenFile }: {
  view: ToolView;
  /** The issuing request's usage: the expanded card's first line, in the same shape as the turn's meta line. */
  stepUsage?: StepUsage;
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
  // chip 内容即文件名（标题只描述动作），点击打开对应文件。
  const chips = onOpenFile && view.filePaths.length > 0
    ? <FileChips paths={view.filePaths} cwd={cwd} onOpenFile={onOpenFile} />
    : null;
  // The chip already carries the name; a description that repeats it is noise (第 4 节).
  const repeatsChip = view.filePaths.some((path) =>
    path === view.description || baseName(path) === view.description);
  // object 同样不得与 chip 重复（例如“编辑 tool-view.ts [tool-view.ts]”）。
  const chipNamesObject = chips !== null && view.object !== undefined
    && view.filePaths.some((path) => baseName(path) === view.object || path === view.object);
  const description = view.streamingInput
    ? t("chat.generatingToolInput")
    : chips && repeatsChip ? undefined : view.description;
  // 读取/写入/编辑仅显示代码块：path、offset、limit 属于工具内部参数，不是阅读内容。
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
      stepUsage={stepUsage}
      content={content}
      ariaLabel={view.object ? `${view.title} ${view.object}` : view.title}
    />
  );
});
