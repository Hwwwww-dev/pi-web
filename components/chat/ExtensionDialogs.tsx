"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnsiText } from "@/components/AnsiText";
import { MarkdownBody } from "@/components/MarkdownBody";
import { TuiText } from "@/components/TuiText";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
} from "@/components/ui/questionnaire";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDialogMaxHeight } from "@/hooks/useDialogMaxHeight";
import { useI18n } from "@/hooks/useI18n";
import { isTuiText, normalizeCustomPanelLines, stripAnsi } from "@/lib/ansi";
import { EXTENSION_DIALOG_BASE_WIDTH, fitExtensionDialogWidth } from "@/lib/extension-dialog-fit";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import type { ExtensionUiRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 扩展弹窗（select / confirm / input / editor）与自定义面板：从 ChatWindow 搬出的纯展示层。 */

export type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function getExtensionDialogSummary(request: ExtensionDialogRequest): string | undefined {
  if (request.method === "select" && request.options.length > 0) return stripAnsi(request.options[0]);
  if (request.method === "confirm") {
    const firstLine = stripAnsi(request.message).split("\n").find((line) => line.trim());
    return firstLine?.trim();
  }
  return undefined;
}

// Extensions pack structured details (e.g. permission prompts: tool/command/paths)
// into the dialog title as "key : value" lines. Render those lines as a two-column
// table so the values align. ask_user_question's RPC path appends per-option
// preview blocks as "--- N. label preview ---" followed by raw markdown; those
// blocks render through MarkdownBody so the preview shows fully formatted.
const PREVIEW_HEADING_RE = /^--- (.+) preview ---$/;

type DialogTitleSegment =
  | { kind: "plain"; text: string }
  | { kind: "preview"; heading: string; markdown: string };

function parseDialogTitleSegments(title: string): DialogTitleSegment[] {
  const segments: DialogTitleSegment[] = [];
  let plain: string[] = [];
  let preview: { heading: string; lines: string[] } | null = null;
  const flushPlain = () => {
    if (plain.length > 0) segments.push({ kind: "plain", text: plain.join("\n") });
    plain = [];
  };
  const flushPreview = () => {
    if (preview) segments.push({ kind: "preview", heading: preview.heading, markdown: preview.lines.join("\n") });
    preview = null;
  };
  for (const line of title.split("\n")) {
    const match = PREVIEW_HEADING_RE.exec(line.trim());
    if (match) {
      flushPlain();
      flushPreview();
      preview = { heading: match[1], lines: [] };
    } else if (preview) {
      preview.lines.push(line);
    } else {
      plain.push(line);
    }
  }
  flushPlain();
  flushPreview();
  return segments;
}

function DialogTitlePlainText({ text }: { text: string }) {
  const [heading, ...rest] = text.split("\n");
  const headingClass = "text-sm font-semibold leading-[1.45] text-foreground";
  // Terminal text is laid out for a fixed width: render it verbatim so box
  // drawing, tables and progress bars keep their shape (see TuiText).
  const body = rest.join("\n").replace(/^\n+|\n+$/g, "");
  if (isTuiText(body)) {
    return (
      <div className="min-w-0">
        <div className={headingClass}>{heading}</div>
        <TuiText text={body} className="mt-1 text-xs leading-[1.45] text-muted-foreground" />
      </div>
    );
  }
  const rows: Array<{ label: string; value: string }> = [];
  const plain: string[] = [];
  for (const line of rest) {
    const match = /^\s*([^:\n]{1,48}?)\s*:\s*(.+)$/.exec(line);
    if (match) rows.push({ label: match[1].trim(), value: match[2].trim() });
    else plain.push(line.trim());
  }
  if (rows.length === 0) {
    return (
      <div className="whitespace-pre-wrap wrap-anywhere">
        <div className={headingClass}>{heading}</div>
        {plain.map((line, index) => (
          <div key={index} className="mt-0.5 text-xs text-muted-foreground">{line}</div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <div className={headingClass}>{heading}</div>
      {/* Flex rows, not a table: WebKit's auto table layout gives the value column
          only its min-content when overflow-wrap: anywhere is set, crushing values
          like "external_directory" into one character per line on narrow screens. */}
      <div className="mt-1.5 text-xs leading-[1.5]">
        {rows.map((row) => (
          <div key={row.label + row.value} className="flex items-baseline gap-3.5 py-[3px]">
            <div className="shrink-0 whitespace-nowrap text-muted-foreground">{row.label}</div>
            <div className="min-w-0 flex-1 font-mono text-foreground wrap-anywhere">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExtensionDialogTitle({ title }: { title: string }) {
  const segments = parseDialogTitleSegments(title);
  return (
    <div className="min-w-0">
      {segments.map((segment, index) =>
        segment.kind === "preview" ? (
          <div key={index} className="mt-2.5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {segment.heading}
            </div>
            {isTuiText(segment.markdown) ? (
              <TuiText
                text={segment.markdown}
                className="rounded-md bg-muted px-2 py-1.5 text-xs leading-[1.4] text-muted-foreground"
              />
            ) : (
              <MarkdownBody>{segment.markdown}</MarkdownBody>
            )}
          </div>
        ) : (
          <DialogTitlePlainText key={index} text={segment.text} />
        ),
      )}
    </div>
  );
}

// Permission-style options read as approve/deny; tint them so the choice
// is recognizable at a glance. Only matches at the start of the option text.
function extensionOptionTone(option: string): "affirmative" | "negative" | "neutral" {
  const text = option.trim().toLowerCase();
  if (/^(yes|y|ok|okay|allow|approve|accept|continue|always)\b/.test(text) || /^[是允禄确认同意好的]/.test(option.trim())) return "affirmative";
  if (/^(no|n|deny|reject|cancel|never|stop|don'?t)\b/.test(text) || /^[否不拒绝取消]/.test(option.trim())) return "negative";
  return "neutral";
}

// pi has no toggle RPC for multi-select questions: the host sends an
// input-method dialog whose title carries a numbered option list and asks
// for comma-separated numbers ("1,3") in the text field. Detect that shape
// so the web UI can offer real checkboxes instead of typed digits.
function parseMultiSelectPrompt(title: string): { question: string; options: Array<{ id: string; label: string }> } | null {
  const lines = title.split("\n");
  const hintIndex = lines.findIndex((line) => /enter the numbers/i.test(line));
  if (hintIndex < 0) return null;
  const options: Array<{ id: string; label: string }> = [];
  const question: string[] = [];
  for (let i = 0; i < hintIndex; i++) {
    const match = /^\s*(\d+)[.、)]\s*(.+)$/.exec(lines[i]);
    if (match) options.push({ id: match[1], label: match[2].trim() });
    else question.push(lines[i]);
  }
  if (options.length < 2) return null;
  return { question: question.join("\n"), options };
}

function ExtensionWaitingCount({ count }: { count: number }) {
  const { t } = useI18n();
  if (count <= 0) return null;
  return (
    <Badge variant="ghost" className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary">
      {t("chat.extensionMoreWaiting", { count })}
    </Badge>
  );
}

/** Corner brackets pointing outward; when expanded they point inward (restore). */
function ExtensionSizeIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded
        ? <path d="M3.5 1v2.5H1M6.5 1v2.5H9M6.5 9v-2.5H9M3.5 9v-2.5H1" />
        : <path d="M1 3.5V1h2.5M6.5 1H9v2.5M9 6.5V9H6.5M3.5 9H1V6.5" />}
    </svg>
  );
}

export function ExtensionDialog({
  request,
  waitingCount,
  onRespond,
  queueTotal,
  answered,
}: {
  request: ExtensionDialogRequest;
  /** Further dialogs queued behind this one; each opens after this one is answered. */
  waitingCount: number;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
  /** Requests still queued including this one — the ask tool sends several. */
  queueTotal?: number;
  answered?: Array<{ id: string; question: string; answer: string; cancelled?: boolean }>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const multiSelect = request.method === "input" ? parseMultiSelectPrompt(request.title) : null;
  // 选项型提问（select / multiSelect）用 shadcn base Questionnaire：radio/checkbox
  // 原生语义（方向键、空格内置），答案走 form 提交；底部确认按钮通过 form 属性
  // 关联回来。表单 id 必须每个实例唯一：keep-alive 把切走的会话都留在 DOM 里，
  // 字面量 id 会重名，而 `<Button form="…">` 只认文档里第一个——也就是另一个会话
  // 那个隐藏表单，于是「确认」提交到别处、自己的 onSubmit 一次也不跑。
  const formId = useId();
  const [collapsed, setCollapsed] = useState(false);
  // Multi-question asks page: ‹ › steps back through the answers already sent
  // (read-only review — those responses are with the agent) and forward to the
  // question awaiting a response.
  const totalQuestions = (answered?.length ?? 0) + (queueTotal ?? 1);
  const currentQuestionIndex = (answered?.length ?? 0) + 1;
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const reviewed = reviewIndex !== null ? answered?.[reviewIndex] : undefined;
  const stepToPrevious = () => {
    const count = answered?.length ?? 0;
    if (!count) return;
    setReviewIndex((current) => current === null ? count - 1 : Math.max(0, current - 1));
  };
  const stepToNext = () => {
    const count = answered?.length ?? 0;
    setReviewIndex((current) => current === null || current + 1 >= count ? null : current + 1);
  };
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The dialog is a Radix Dialog portaled into this panel, so it stays inside
  // the chat area instead of covering the whole app.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  // The panel this dialog is anchored in, not the visual viewport, is what
  // bounds it: on mobile the chat panel is far shorter than the viewport.
  const dialogMaxHeight = useDialogMaxHeight(wrapperRef);
  // Dialogs open at the historical width and grow only when their own content cannot
  // fit (a code block or table that would scroll sideways), so no extension has to ask
  // for room. The maximize button is the user's own override for this dialog (#947).
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => setFull((prev) => !prev), []);
  const [now, setNow] = useState(() => Date.now());

  const summary = getExtensionDialogSummary(request);
  const remainingSeconds = request.expiresAt === undefined
    ? null
    : Math.max(0, Math.ceil((request.expiresAt - now) / 1000));

  useLayoutEffect(() => {
    if (collapsed) return;
    const dialog = dialogRef.current;
    const body = bodyRef.current;
    if (!dialog || !body) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const blocks = body.querySelectorAll<HTMLElement>("pre, .markdown-table-wrap");
      if (blocks.length === 0) return;
      // Code fences wrap their long lines; measured unwrapped, they still widen
      // the dialog as far as the screen allows and wrap only past that. The
      // class is an attribute change, which the observer below does not watch.
      body.classList.add("extension-dialog-measuring");
      const overflows = Array.from(blocks, (block) => block.scrollWidth - block.clientWidth);
      body.classList.remove("extension-dialog-measuring");
      const needed = fitExtensionDialogWidth(dialog.offsetWidth, overflows);
      // Only ever grow: shrinking again would make the dialog jump while it is read.
      if (needed !== null) setFitWidth((prev) => (prev !== null && prev >= needed ? prev : needed));
    };
    fit();
    // Highlighted code replaces its plain fallback after the first paint, and a web
    // font can change glyph widths once it arrives.
    const mutations = new MutationObserver(fit);
    mutations.observe(body, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => {
      disposed = true;
      mutations.disconnect();
    };
  }, [collapsed]);

  useEffect(() => {
    if (request.expiresAt === undefined) return;
    // The server closes expired requests via extension_ui_closed.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);

  const countdown = remainingSeconds !== null && (
    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
      {t("chat.extensionExpiresIn", { seconds: remainingSeconds })}
    </span>
  );

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };
  // 单选提交：FormData 里唯一选中值即回复全文。
  const submitSelectForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = Array.from(new FormData(event.currentTarget).values()).map(String).find((v) => v.length > 0);
    if (selected !== undefined) onRespond(request, { value: selected });
  };
  // 多选提交：选中的序号按数值排序逗号连接；一个都没选时用自由输入文本。
  const submitMultiForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Array.from(new FormData(event.currentTarget).values()).map(String);
    const ids = values.filter((v) => multiSelect?.options.some((option) => option.id === v)).sort((a, b) => Number(a) - Number(b));
    const text = values.find((v) => !multiSelect?.options.some((option) => option.id === v)) ?? "";
    onRespond(request, { value: ids.length > 0 ? ids.join(",") : text });
  };

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        setPortalHost(node);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        // Reviewing a previous question: Escape returns to the live one
        // instead of cancelling a response the user did not intend.
        if (reviewIndex !== null) {
          setReviewIndex(null);
          return;
        }
        onRespond(request, { cancelled: true });
      }}
      className={cn("absolute inset-0 z-(--z-chat-float) flex justify-center p-5 pointer-events-none", collapsed ? "items-start" : "items-end")}
    >
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          className="pointer-events-auto flex h-auto w-full max-w-[min(560px,100%)] cursor-pointer items-center justify-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-left font-normal text-foreground shadow-lg hover:bg-background hover:text-foreground dark:hover:bg-background"
        >
          <span className="shrink-0 text-xs font-[650] text-primary">
            {t("chat.extensionPending")}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {stripAnsi(request.title)}
          </span>
          {summary && (
            <span className="max-w-[34%] shrink truncate text-xs text-muted-foreground">
              {summary}
            </span>
          )}
          <ExtensionWaitingCount count={waitingCount} />
          {countdown}
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("chat.extensionExpand")}
          </span>
        </Button>
      ) : (
      <Dialog open modal={false}>
      <DialogContent
        ref={dialogRef}
        container={portalHost}
        showCloseButton={false}
        overlayClassName="hidden"
        aria-label={stripAnsi(request.title)}
        className="pointer-events-auto static top-auto left-auto mx-auto translate-x-0 translate-y-0 flex max-w-none flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background p-0 shadow-2xl animate-[extension-drawer-in_0.22s_ease-out] duration-0 motion-reduce:animate-none"
        style={{
          // "Full" fills the content region above the composer: the overlay is inset:0 with
          // 20px padding, so 100% keeps that breathing room without covering the input.
          width: full ? "100%" : `min(${fitWidth ?? EXTENSION_DIALOG_BASE_WIDTH}px, 100%)`,
          // Bounded by the panel that holds it, so a tall option preview cannot
          // push the drawer past the chat area and clip its header.
          maxHeight: full ? "100%" : dialogMaxHeight,
        }}
      >
        <div className="flex shrink min-h-0 items-start gap-2 px-3.5 py-3 max-h-[180px] overflow-y-auto">
          <div className="min-w-0 flex-1">
            {/* Pi's TUI shows the title verbatim, newlines included; select/input have no
                separate message field, so extensions put multi-line text here. */}
            <ExtensionDialogTitle title={multiSelect ? stripAnsi(multiSelect.question || request.title) : stripAnsi(request.title)} />
            <div className="mt-[3px] flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground">
              <span>{t("chat.extensionRequest")}</span>
              {totalQuestions > 1 && (
                <span className="inline-flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    onClick={stepToPrevious}
                    disabled={!answered?.length || reviewIndex === 0}
                    aria-label={t("chat.question.previous")}
                    title={t("chat.question.previous")}
                    className="size-[18px] rounded-[4px] p-0"
                  >
                    <svg className="size-2 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="6.5 2 3 5 6.5 8" />
                    </svg>
                  </Button>
                  <span className={cn("tabular-nums", reviewIndex !== null ? "text-foreground" : "text-primary")}>
                    {t("chat.question.pager", { index: reviewIndex !== null ? reviewIndex + 1 : currentQuestionIndex, total: totalQuestions })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    onClick={stepToNext}
                    disabled={reviewIndex === null}
                    aria-label={t("chat.question.next")}
                    title={t("chat.question.next")}
                    className="size-[18px] rounded-[4px] p-0"
                  >
                    <svg className="size-2 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3.5 2 7 5 3.5 8" />
                    </svg>
                  </Button>
                </span>
              )}
              <ExtensionWaitingCount count={waitingCount} />
              {countdown}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={toggleFull}
            title={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
            aria-label={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
            className="size-7 shrink-0 rounded-md"
          >
            <ExtensionSizeIcon expanded={full} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => setCollapsed(true)}
            aria-expanded={true}
            title={t("chat.extensionCollapse")}
            aria-label={t("chat.extensionCollapse")}
            className="size-7 shrink-0 rounded-md"
          >
            <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2 3.5 5 6.5 8 3.5" />
            </svg>
          </Button>
        </div>

        <div
          ref={bodyRef}
          className="min-h-0 min-w-0 flex-[1_1_auto] overflow-y-auto p-3.5 extension-ask-body"
        >
          {reviewed ? (
            <div className="grid gap-2.5">
              <div className="text-sm font-semibold leading-[1.55] text-foreground wrap-anywhere">
                {`${(reviewIndex ?? 0) + 1}. ${reviewed.question}`}
              </div>
              <div className="rounded-sm border border-border bg-card px-2.5 py-2 text-sm leading-[1.6] text-foreground wrap-anywhere whitespace-pre-wrap">
                <span className="mb-1 block text-xs text-muted-foreground">
                  {reviewed.cancelled ? t("chat.question.answeredCancelled") : t("chat.question.answerLabel")}
                </span>
                {reviewed.answer}
              </div>
              <div className="text-xs text-muted-foreground">{t("chat.question.reviewHint")}</div>
            </div>
          ) : (
          <>
          {request.method === "confirm" && (
            <div className="text-sm leading-[1.6]">
              <MarkdownBody>{stripAnsi(request.message)}</MarkdownBody>
            </div>
          )}
          {request.method === "select" && (
            <Questionnaire
              id={formId}
              className="gap-3"
              items={[{ name: "answer", required: true, choices: request.options.map((option) => ({ value: option })) }]}
              onSubmit={submitSelectForm}
            >
              <QuestionnaireItem name="answer" required>
                <QuestionnaireChoices className="gap-1.5">
                  {request.options.map((option) => {
                    const tone = extensionOptionTone(option);
                    return (
                      <QuestionnaireChoice
                        key={option}
                        value={option}
                        className={cn(
                          "min-h-9 rounded-md px-2.5 py-1.5 text-xs wrap-anywhere scroll-m-[14px]",
                          tone === "affirmative" && "data-checked:border-success/40 data-checked:bg-success/[0.12] data-checked:text-success",
                          tone === "negative" && "data-checked:border-destructive/40 data-checked:bg-destructive/10 data-checked:text-destructive",
                          tone !== "neutral" && "font-semibold",
                        )}
                        onDoubleClick={() => onRespond(request, { value: option })}
                      >
                        <div inert>
                          <MarkdownBody>{stripAnsi(option)}</MarkdownBody>
                        </div>
                      </QuestionnaireChoice>
                    );
                  })}
                </QuestionnaireChoices>
              </QuestionnaireItem>
            </Questionnaire>
          )}
          {request.method === "input" && (multiSelect ? (
            <Questionnaire
              id={formId}
              className="gap-3"
              items={[{ name: "answer", choices: multiSelect.options.map((option) => ({ value: option.id })) }]}
              onSubmit={submitMultiForm}
            >
              <QuestionnaireItem name="answer" multiple>
                <QuestionnaireChoices className="gap-1.5">
                  {multiSelect.options.map((option) => (
                    <QuestionnaireChoice
                      key={option.id}
                      value={option.id}
                      className="min-h-9 rounded-md px-2.5 py-1.5 text-xs wrap-anywhere scroll-m-[14px]"
                    >
                      <span className="mr-1.5 font-semibold">{option.id}.</span>
                      {option.label}
                    </QuestionnaireChoice>
                  ))}
                  <QuestionnaireInput
                    placeholder={t("chat.extensionCustomAnswer")}
                    className="h-9 min-h-9 rounded-md bg-card px-2.5 text-xs"
                  />
                </QuestionnaireChoices>
              </QuestionnaireItem>
            </Questionnaire>
          ) : (
            <Input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) submitValue();
              }}
              className="rounded-sm border-border bg-card px-2.5"
            />
          ))}
          {request.method === "editor" && (
            <Textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) submitValue();
              }}
              className="min-h-[220px] rounded-sm border-border bg-card p-2.5 leading-[1.55] font-mono"
            />
          )}
          </>
          )}
        </div>

        {reviewed ? (
          <div className="flex shrink-0 justify-end gap-2 bg-card px-3.5 py-2.5">
            <Button type="button" onClick={() => setReviewIndex(null)}>
              {t("chat.question.backToCurrent")}
            </Button>
          </div>
        ) : (
        <div className="flex shrink-0 justify-end gap-2 bg-card px-3.5 py-2.5">
          <Button
            type="button"
            variant="outline"
            autoFocus={request.method === "confirm" || (request.method === "select" && request.options.length === 0)}
            onClick={() => onRespond(request, { cancelled: true })}
            className="text-muted-foreground"
          >
             {t("chat.cancel")}
          </Button>
          {request.method === "confirm" ? (
            <Button type="button" onClick={submitValue}>
               {t("chat.confirm")}
            </Button>
          ) : request.method === "select" || multiSelect ? (
            <Button
              type="submit"
              form={formId}
              autoFocus={request.method === "select" && request.options.length === 0}
            >
               {t("chat.confirm")}
            </Button>
          ) : (
            <Button type="button" onClick={submitValue}>
               {t("chat.submit")}
            </Button>
          )}
        </div>
        )}
      </DialogContent>
      </Dialog>
      )}
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export function ExtensionCustomPanel({
  request,
  waitingCount,
  onInput,
}: {
  request: ExtensionCustomRequest;
  /** Further custom panels queued behind this one; each opens after this one closes. */
  waitingCount: number;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Same panel-anchored official Dialog as the request drawer.
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const dialogMaxHeight = useDialogMaxHeight(wrapperRef);
  const displayLines = normalizeCustomPanelLines(request.lines);
  const summary = displayLines.map(stripAnsi).find((line) => line.trim())?.trim();

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus();
  }, [collapsed]);

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        setPortalHost(node);
      }}
      className={cn("absolute inset-0 z-(--z-chat-float-raised) flex justify-center p-5 pointer-events-none", collapsed ? "items-start" : "items-center")}
    >
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          className="pointer-events-auto flex h-auto w-full max-w-[min(920px,100%)] cursor-pointer items-center justify-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-left font-normal text-foreground shadow-lg hover:bg-background hover:text-foreground dark:hover:bg-background"
        >
          <span className="shrink-0 text-xs font-[650] text-primary">
            {t("chat.extensionPending")}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("chat.extensionPanel")}
          </span>
          {summary && (
            <span className="max-w-[34%] shrink truncate text-xs text-muted-foreground">
              {summary}
            </span>
          )}
          <ExtensionWaitingCount count={waitingCount} />
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("chat.extensionExpand")}
          </span>
        </Button>
      ) : (
      <Dialog open modal={false}>
      <DialogContent
        container={portalHost}
        showCloseButton={false}
        overlayClassName="hidden"
        aria-label={t("chat.extensionPanel")}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        // The extension already wrapped its lines to the width it asked for; show them
        // whole when that is wider than the usual 920px instead of scrolling sideways.
        className="pointer-events-auto static top-auto left-auto mx-auto translate-x-0 translate-y-0 flex w-max min-w-[min(920px,100%)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background shadow-2xl outline-none"
        style={{
          // Bounded by the panel that holds it, so a tall editor cannot push the
          // drawer past the chat area and clip its header.
          maxHeight: dialogMaxHeight,
        }}
      >
        <Textarea
          ref={inputRef}
           aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          className="absolute h-px min-h-0 w-px border-0 p-0 opacity-0 shadow-none pointer-events-none"
        />
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2.5">
           <div className="text-sm font-[650] text-foreground">{t("chat.extensionPanel")}</div>
          <div className="flex items-center gap-2">
            <ExtensionWaitingCount count={waitingCount} />
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              title={t("chat.extensionCollapse")}
              aria-label={t("chat.extensionCollapse")}
              className="size-7 shrink-0 rounded-md"
            >
              <svg className="size-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onInput(request, "\x03")}
              className="text-muted-foreground"
            >
               {t("chat.close")}
            </Button>
          </div>
        </div>
        <pre className="m-0 min-h-0 overflow-auto bg-card p-3.5 text-sm leading-[1.45] text-foreground font-mono whitespace-pre">
          <AnsiText text={displayLines.join("\n")} />
        </pre>
      </DialogContent>
      </Dialog>
      )}
    </div>
  );
}
