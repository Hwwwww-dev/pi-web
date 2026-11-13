/**
 * One tool call as a view model, so the chat's rows decide nothing.
 *
 * Every "what is this row" question lives here — which kind of call it is, what
 * its one-line title says, which sections its detail holds — and the components
 * only render. The shapes are read defensively: built-in tools, MCP servers and
 * extensions all produce `toolCall` blocks, and a third-party tool may borrow a
 * built-in's name without its input.
 */

import { applyPatchPreviewToFiles, applyPatchResultHasFailures, getApplyPatchInputText, parseApplyPatchInput } from "./apply-patch";
import { CODEMODE_TOOL_NAME, codemodeCalls, codemodeScript, stripCodemodeHeader, type CodemodeCallView } from "./codemode-view";
import { getLanguage } from "./file-types";
import { mcpToolLabel, mcpToolNameLabel, prettyMcpResultText, type McpToolLabel } from "./mcp-tool-display";
import { parseUnifiedPatch, type SplitDiffFile } from "./patch";
import { getToolCategory, getToolFilePaths, getToolPreviewText, TOOL_CATEGORY_LABEL_KEYS, isQuestionToolName, isSubagentToolName } from "./tool-categories";
import { EMPTY_FIELD_VALUE, toolFieldsOfInput, type ToolField } from "./tool-fields";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import type { ImageContent, ToolCallContent, ToolResultMessage } from "./types";
import type { TranslationParams } from "./i18n/types";

export type ToolViewKind =
  | "terminal"
  | "file-read"
  | "file-write"
  | "file-edit"
  | "search"
  | "compact"
  | "web"
  | "codemode"
  | "subagent"
  | "mcp"
  | "queue"
  | "question"
  | "generic";

export type ToolViewStatus = "running" | "error" | "pending" | "done";

/** One line inside a nested list (a script's calls, a to-do list). */
export interface ToolViewStep {
  title: string;
  status: ToolViewStatus;
  description?: string;
}

/** A block of the detail: the call's own input, then its result. */
export interface ToolViewSection {
  kind: "code" | "diff" | "markdown" | "fields" | "steps";
  /** Which half of the row this is, for the label the detail shows when both are on screen. */
  label?: "parameters" | "result";
  text?: string;
  language?: string;
  files?: SplitDiffFile[];
  fields?: ToolField[];
  steps?: ToolViewStep[];
}

export interface ToolViewSource {
  title: string;
  url: string;
}

export interface ToolView {
  kind: ToolViewKind;
  status: ToolViewStatus;
  /** One sentence, on one line. */
  title: string;
  /**
   * The thing the action applies to, in the line's own color: a command, a file.
   * It is what gets elided when the line is too narrow — never the action.
   */
  object?: string;
  /** Secondary text after the title: a path, a preview, a count. */
  description?: string;
  sections: ToolViewSection[];
  /** The call's own text when its detail shows it as a block (a shell command). */
  command?: string;
  /** The command/path/pattern a running or failed title wraps (硬规则 6). */
  target?: string;
  filePaths: string[];
  images: string[];
  /** A video or audio result: the browser's own player, never the bytes as text. */
  media?: { video?: string; audio?: string };
  sources?: ToolViewSource[];
  subagent?: { sessionId: string; label: string };
  diffStat?: { added: number; removed: number };
  /** The call's input is still streaming in: incomplete JSON, no usable detail. */
  streamingInput: boolean;
  error?: string;
  /** Identity of the row's open state. */
  foldKey: string;
}

export interface ToolViewInput {
  block: ToolCallContent;
  result?: ToolResultMessage;
  t: (key: string, params?: TranslationParams) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? "").trim();
}

/** Added and removed lines of a unified patch, for the row's `+n −n` badges. */
export function countDiffLines(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function resultDiffText(result: ToolResultMessage | undefined): string | null {
  if (!result || !isRecord(result.details)) return null;
  const patch = typeof result.details.patch === "string" ? result.details.patch : null;
  if (patch) return patch;
  const diff = typeof result.details.diff === "string" ? result.details.diff : null;
  return diff || null;
}

/** An image content block as a URL, whichever of the two shapes pi used. */
export function imageSource(image: ImageContent): string {
  return srcOf(image);
}

/** Any media block (image, video, audio) as a URL: pi's flat or nested source shape. */
function srcOf(block: unknown): string {
  const content = block as { source?: { type?: string; media_type?: string; data?: string; url?: string }; data?: string; mimeType?: string };
  if (content.source) {
    return content.source.type === "base64"
      ? `data:${content.source.media_type};base64,${content.source.data}`
      : content.source.url ?? "";
  }
  return content.data ? `data:${content.mimeType};base64,${content.data}` : "";
}

/** The image blocks of a message's content (a tool result or a custom message). */
export function getMessageImages(content: readonly { type: string }[] | string): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((block): block is ImageContent => block.type === "image");
}

function resultText(result: ToolResultMessage | undefined, dropCodemodeHeader: boolean): {
  text: string | null;
  images: string[];
  media: { video?: string; audio?: string } | null;
} {
  if (!result) return { text: null, images: [], media: null };
  const content = dropCodemodeHeader ? stripCodemodeHeader(result.content) : result.content;
  const text = content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const images = content
    .filter((block): block is ImageContent => block.type === "image")
    .map(imageSource)
    .filter((src) => src !== "");
  const media: { video?: string; audio?: string } = {};
  // SAFETY: pi's content union names only text and image blocks; a provider or
  // extension may still return media, so the block is read by its `type` field.
  const blocks = content as unknown as { type: string }[];
  for (const block of blocks) {
    // A provider or extension may return media the SDK's content type does not
    // name yet: read the block defensively instead of widening the union.
    // A provider or extension may return media the SDK's content type does not
    // name yet: read the block defensively instead of widening the union.
    if (block.type !== "video" && block.type !== "audio") continue;
    const src = srcOf(block);
    if (src) media[block.type] = src;
  }
  return { text, images, media: media.video || media.audio ? media : null };
}

/** `(no output)` and an empty string are the two ways pi says "nothing". */
function isEmptyResult(text: string | null): boolean {
  return text === null || text.trim() === "" || text.trim() === "(no output)";
}

function resultSections(text: string | null, language: string): ToolViewSection[] {
  if (isEmptyResult(text)) return [];
  return [{ kind: "code", label: "result", text: text ?? "", language }];
}

function fieldsSection(fields: ToolField[] | null): ToolViewSection[] {
  return fields ? [{ kind: "fields", label: "parameters", fields }] : [];
}

function jsonSection(text: string, language: string): ToolViewSection[] {
  return [{ kind: "code", label: "parameters", text: prettyJsonText(text, language), language }];
}

/** 可解析的 JSON 一律缩进展开：原文中的 `\\n` 转义会使参数挤在一行。 */
function prettyJsonText(text: string, language: string): string {
  if (language !== "json" || !/^\s*[[{]/.test(text)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * The URLs a search's result text names: Markdown links first, then bare
 * addresses, whose title is the line that introduced them — search output
 * prints `1. Title` above the address. Deduplicated by address, in the order
 * the text gave them.
 */
export function resultSources(text: string | null): ToolViewSource[] {
  if (!text) return [];
  const sources: ToolViewSource[] = [];
  const seen = new Set<string>();
  const push = (title: string, url: string) => {
    const clean = url.replace(/[),.;]+$/, "");
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    sources.push({ title: title.trim() || hostOf(clean), url: clean });
  };

  let introducedBy = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const links = [...line.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)];
    if (links.length > 0) {
      for (const match of links) push(match[1] ?? "", match[2] ?? "");
      introducedBy = "";
      continue;
    }
    const addresses = [...line.matchAll(/https?:\/\/[^\s<>()\]]+/g)];
    if (addresses.length === 0) {
      introducedBy = listItemText(line);
      continue;
    }
    addresses.forEach((match, index) => push(index === 0 ? introducedBy : "", match[0]));
    introducedBy = "";
  }
  return sources.slice(0, 20);
}

/** A line's text with numbering, bullets and bold markers removed, when it
 * reads as a title rather than a heading or another address. */
function listItemText(line: string): string {
  const text = line
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/^\s*[-*+•]\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  if (text.length < 2 || /^https?:\/\//i.test(text)) return "";
  if (/^(sources?|results?|links?)\b[\s:：]*\d*[\s:：]*$/i.test(text)) return "";
  return text;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * A to-do tool's items, when its input carries them in one of the shapes the
 * agents use: `todos[]` from the classic tool, `tasks[]` from pi's own `todo`
 * tool (`subject`/`status`, with `deleted` as a tombstone that is not shown).
 */
function todoSteps(input: unknown): ToolViewStep[] | null {
  if (!isRecord(input)) return null;
  const items = Array.isArray(input.todos)
    ? input.todos
    : Array.isArray(input.tasks)
      ? input.tasks
      : Array.isArray(input.updates) ? input.updates : null;
  if (!items) return null;
  const steps: ToolViewStep[] = [];
  for (const item of items) {
    if (!isRecord(item)) return null;
    const title = typeof item.content === "string"
      ? item.content
      : typeof item.title === "string"
        ? item.title
        : typeof item.subject === "string"
          ? item.subject
          : typeof item.task_id === "string" ? item.task_id : null;
    if (title === null) return null;
    if (item.status === "deleted") continue;
    const status: ToolViewStatus = item.status === "completed"
      ? "done"
      : item.status === "in_progress" || item.status === "running" ? "running" : "pending";
    steps.push({ title, status });
  }
  return steps.length > 0 ? steps : null;
}

/** The whole list a `todo` result reports back (`details.tasks`), not just this call's arguments. */
function todoStepsFromDetails(details: unknown): ToolViewStep[] | null {
  if (!isRecord(details) || !Array.isArray(details.tasks)) return null;
  return todoSteps({ todos: details.tasks });
}

function codemodeSteps(calls: CodemodeCallView[]): ToolViewStep[] {
  return calls.map((call) => ({
    title: call.name,
    status: call.status === "error" ? "error" : call.status === "running" ? "running" : "done",
    description: [call.args, call.error, call.durationMs !== undefined ? `${Math.round(call.durationMs)}ms` : ""]
      .filter(Boolean)
      .join(" · "),
  }));
}

/** A patch's file sections, from its own text or the result's preview. */
export function getPatchFiles(block: ToolCallContent, result?: ToolResultMessage): SplitDiffFile[] | null {
  const fromInput = parseApplyPatchInput(getApplyPatchInputText(block.input, block.rawInput));
  if (fromInput) return fromInput;
  const details = result && !result.isError ? result.details : undefined;
  if (!isRecord(details)) return null;
  // pi 的 edit 工具在 details.patch 中给出完整 unified diff；details.diff 是带行号的视图文本。
  if (typeof details.patch === "string") {
    const files = parseUnifiedPatch(details.patch);
    if (files && files.length > 0) return files;
  }
  return applyPatchPreviewToFiles(details.preview);
}

/** A write's file text in place of its JSON, when the call holds nothing else. */
const WRITE_VIEW_KEYS = new Set(["path", "file_path", "content"]);

export function getWrittenFileText(block: ToolCallContent): string | null {
  const { input } = block;
  if (!input || typeof input !== "object") return null;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => !WRITE_VIEW_KEYS.has(key))) return null;
  const text = input.content;
  return typeof text === "string" ? text : null;
}

/** The text a call's input would show as a preview: its command, a path, or a JSON head. */
function previewOf(block: ToolCallContent): string {
  return getToolPreviewText(block).slice(0, 160);
}

/** The last segment of a path, for a one-line title. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** A tool's name as a title: `get_search_content` reads as "Get search content". */
export function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/^mcp__[^_]+__/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

/** Everything the kind builders read, computed once. */
interface Prepared {
  block: ToolCallContent;
  t: (key: string, params?: TranslationParams) => string;
  inputStr: string;
  streamingInput: boolean;
  filePaths: string[];
  status: ToolViewStatus;
  isError: boolean;
  /** The result's text: codemode's repeated script dropped, MCP JSON indented. */
  text: string | null;
  details: unknown;
  images: string[];
  media: { video?: string; audio?: string } | null;
  fields: ToolField[] | null;
  preview: string;
  command: string | null;
  codemode: { code: string; calls: CodemodeCallView[]; omitted: number } | null;
  mcp: McpToolLabel | null;
  patchFiles: SplitDiffFile[] | null;
  diffText: string | null;
  writtenFileText: string | null;
  detail: (list: ToolViewSection[]) => ToolViewSection[];
}

function prepare({ block, result, t }: ToolViewInput): Prepared {
  const inputStr = block.rawInput ?? JSON.stringify(block.input, null, 2);
  const streamingInput = block.rawInput !== undefined;
  const mcp = mcpToolLabel(block.toolName, result?.details) ?? mcpToolNameLabel(block.toolName);
  const script = block.toolName === CODEMODE_TOOL_NAME && !streamingInput ? codemodeScript(block.input) : null;
  const codemode = script === null ? null : { code: script, ...codemodeCalls(result?.details) };
  // A codemode result repeats the script as its leading text; the row shows the
  // calls instead, so the copy is dropped.
  const { text: rawText, images, media } = resultText(result, codemode !== null);
  // edit 与 apply_patch 的结果均带补丁：解析为 files 后才按增删着色，否则按纯文本渲染。
  const patchFiles = isApplyPatchToolName(block.toolName) || isEditToolName(block.toolName)
    ? getPatchFiles(block, result)
    : null;
  const writtenFileText = getWrittenFileText(block);
  const command = getToolCategory(block.toolName) === "terminal" && !streamingInput && typeof block.input.command === "string"
    ? block.input.command
    : null;
  const isError = isFailedResult(block.toolName, result);
  return {
    block,
    t,
    inputStr,
    streamingInput,
    filePaths: getToolFilePaths(block.input),
    status: isError ? "error" : result ? "done" : "running",
    isError,
    text: mcp && rawText !== null ? prettyMcpResultText(rawText) : rawText,
    details: result?.details,
    images,
    media,
    // Flat arguments as rows instead of a JSON blob, unless the row has a view
    // of its own (a write's file text, codemode, an applied patch, a terminal pair).
    fields: !streamingInput && command === null && codemode === null && patchFiles === null && writtenFileText === null
      ? toolFieldsOfInput(block.input)
      : null,
    preview: previewOf(block),
    command,
    codemode,
    mcp,
    patchFiles,
    diffText: resultDiffText(result),
    writtenFileText,
    // A streamed call's input is incomplete JSON: the row shows its title and nothing else.
    detail: (list) => (streamingInput ? [] : list),
  };
}

/** Which row this call is. The first match wins, so a decorated name cannot fall through twice. */
function kindOf(p: Prepared): ToolViewKind {
  const name = p.block.toolName;
  if (p.mcp) return "mcp";
  if (isSubagentToolName(name)) return "subagent";
  if (p.codemode) return "codemode";
  // 仅依据工具名，不看已解析的 command：参数流式输入期间 command 尚未成形，
  // 按命令判断会使 bash 行在运行中显示通用图标、结束后变为终端图标。
  if (getToolCategory(name) === "terminal") return "terminal";
  if (isWriteToolName(name)) return "file-write";
  if (isEditToolName(name) || isApplyPatchToolName(name)) return "file-edit";
  const category = getToolCategory(name);
  if (category === "view") return "file-read";
  if (category === "search") return "search";
  if (category === "web") return "web";
  if (category === "plan") return "queue";
  // 提问与计划按工具名判定：参数仍在流式输入时 `todoSteps`/`questionSteps` 解析不出，
  // 行会在运行中退回通用图标与原始工具名，完成后再变样。
  if (questionSteps(p.block.input) || isQuestionToolName(name)) return "question";
  if (category === "compact") return "compact";
  return "generic";
}

/** Whether a result counts as failed: pi's own flag, or an applied patch that reported failures. */
export function isFailedResult(toolName: string, result: ToolResultMessage | undefined): boolean {
  if (!result) return false;
  return result.isError === true || (isApplyPatchToolName(toolName) && applyPatchResultHasFailures(result.details));
}

export function toToolView(input: ToolViewInput): ToolView {
  const p = prepare(input);
  // A title keeps its tense (硬规则 6): running says so, a failure says what failed.
  // 动作名构成行的名称：编辑/读取等 view 的 title 本身即动作，不能被“正在运行”替换。
  const view = createView(p);
  if (view.target && view.title === "") {
    if (view.status === "running") view.title = p.t("chat.trace.running", { target: view.target });
    else if (view.status === "error") view.title = p.t("chat.trace.failed", { target: view.target });
  }
  return view;
}

function createView(p: Prepared): ToolView {
  switch (kindOf(p)) {
    case "mcp": return mcpView(p);
    case "subagent": return subagentView(p);
    case "codemode": return codemodeView(p);
    case "terminal": return terminalView(p);
    case "file-write": return writeView(p);
    case "file-edit": return editView(p);
    case "file-read": return readView(p);
    case "search": return searchView(p);
    case "web": return webView(p);
    case "queue": return queueView(p);
    case "question": return questionView(p);
    case "compact": return compactView(p);
    default: return genericView(p);
  }
}

function baseView(p: Prepared): ToolView {
  const view: ToolView = {
    kind: "generic",
    status: p.status,
    title: "",
    sections: [],
    filePaths: p.filePaths,
    images: p.images,
    ...(p.media ? { media: p.media } : {}),
    streamingInput: p.streamingInput,
    foldKey: p.block.toolCallId,
  };
  if (p.command !== null) view.command = p.command;
  if (p.isError) view.error = firstLine(p.text ?? "") || p.t("chat.activity.failed");
  return view;
}

/** `server/tool`, the way pi's TUI labels an MCP call. */
function mcpView(p: Prepared): ToolView {
  const view = baseView(p);
  const label = p.mcp;
  view.kind = "mcp";
  view.title = label ? `${label.server}/${label.tool}` : humanizeToolName(p.block.toolName);
  view.sections = p.detail([...fieldsSection(p.fields), ...resultSections(p.text, "json")]);
  return view;
}

function subagentView(p: Prepared): ToolView {
  const view = baseView(p);
  const details = isRecord(p.details) ? p.details : null;
  const profile = details && typeof details.profile === "string" ? details.profile : "";
  const described = details && typeof details.description === "string" ? details.description : "";
  view.kind = "subagent";
  view.title = p.t("chat.trace.subagent");
  view.description = [profile, described].filter(Boolean).join(" · ") || undefined;
  if (details && typeof details.sessionId === "string") {
    view.subagent = { sessionId: details.sessionId, label: described || profile || view.title };
  }
  view.sections = p.detail(isEmptyResult(p.text)
    ? fieldsSection(p.fields)
    : [{ kind: "markdown", label: "result", text: p.text ?? "" }]);
  return view;
}

function codemodeView(p: Prepared): ToolView {
  const view = baseView(p);
  const codemode = p.codemode;
  view.kind = "codemode";
  view.title = p.t("chat.trace.script");
  view.description = codemode ? firstLine(codemode.code) || undefined : undefined;
  view.sections = p.detail(codemode === null ? [] : [
    { kind: "code", text: codemode.code.replace(/\r/g, "").trimEnd(), language: "typescript" },
    ...(codemode.calls.length > 0 ? [{ kind: "steps" as const, steps: codemodeSteps(codemode.calls) }] : []),
    ...resultSections(p.text, "text"),
  ]);
  return view;
}

function terminalView(p: Prepared): ToolView {
  const view = baseView(p);
  view.kind = "terminal";
  // The action stays whole; only the command may be elided (第 4 节).
  view.title = p.t("chat.trace.ranLabel");
  view.object = firstLine(p.command ?? "");
  view.target = firstLine(p.command ?? "");
  view.sections = p.detail(isEmptyResult(p.text) ? [] : [{ kind: "code", text: p.text ?? "", language: "text" }]);
  return view;
}

function writeView(p: Prepared): ToolView {
  const view = baseView(p);
  const language = getLanguage(p.filePaths[0] ?? "");
  view.kind = "file-write";
  view.title = p.t("chat.toolCategory.write");
  view.target = p.filePaths[0] ? baseName(p.filePaths[0]) : undefined;
  view.sections = p.detail([
    ...(p.writtenFileText === null
      ? [...fieldsSection(p.fields), ...(p.fields ? [] : jsonSection(p.inputStr, language === "text" ? "json" : language))]
      : [{ kind: "code" as const, label: "parameters" as const, text: p.writtenFileText, language }]),
    ...resultSections(p.text, "text"),
  ]);
  return view;
}

function editView(p: Prepared): ToolView {
  const view = baseView(p);
  const names = p.patchFiles ? p.patchFiles.map((file) => file.newPath || file.oldPath) : p.filePaths;
  view.kind = "file-edit";
  view.title = names.length > 1
    ? p.t("chat.trace.editedFiles", { count: names.length })
    : p.t(TOOL_CATEGORY_LABEL_KEYS.edit);
  view.target = names.length === 1 ? baseName(names[0] ?? "") : undefined;
  const patchText = p.patchFiles
    ? null
    : p.diffText ?? (isApplyPatchToolName(p.block.toolName) ? getApplyPatchInputText(p.block.input, p.block.rawInput) || null : null);
  view.sections = p.detail([
    ...(p.patchFiles ? [{ kind: "diff" as const, label: "parameters" as const, text: "", files: p.patchFiles }] : []),
    ...(patchText ? [{ kind: "diff" as const, label: p.patchFiles ? ("result" as const) : ("parameters" as const), text: patchText }] : []),
    // An edit's own arguments repeat what the patch already says; only a
    // streamed call (no patch yet) shows them.
    ...(p.streamingInput ? fieldsSection(p.fields) : []),
    // The patch is the answer: a result's "ok" beside it would only repeat.
    ...(p.patchFiles || patchText ? [] : resultSections(p.text, "text")),
  ]);
  if (patchText) view.diffStat = countDiffLines(patchText);
  return view;
}

function readView(p: Prepared): ToolView {
  const view = baseView(p);
  view.kind = "file-read";
  // 文件名由行内 chip 承担（可点击跳转），标题只写动作，避免同一名称重复出现。
  view.title = p.t(TOOL_CATEGORY_LABEL_KEYS.view);
  view.target = p.filePaths[0] ? baseName(p.filePaths[0]) : undefined;
  const structured = p.fields ? null : structuredArgSections(p.block.input);
  view.sections = p.detail([
    ...(p.fields ? fieldsSection(p.fields) : structured ?? jsonSection(p.inputStr, "json")),
    ...resultSections(p.text, getLanguage(p.filePaths[0] ?? "")),
  ]);
  return view;
}

function searchView(p: Prepared): ToolView {
  const view = baseView(p);
  const query = typeof p.block.input.pattern === "string"
    ? p.block.input.pattern
    : typeof p.block.input.query === "string" ? p.block.input.query : "";
  view.kind = "search";
  // 动作为标题，搜索词为对象：对象可截断，动作始终完整。
  view.title = p.t(TOOL_CATEGORY_LABEL_KEYS.search);
  view.object = query || p.preview || undefined;
  view.target = query || p.preview || undefined;
  view.sections = p.detail([...fieldsSection(p.fields), ...resultSections(p.text, "text")]);
  return view;
}

function webView(p: Prepared): ToolView {
  const view = baseView(p);
  const sources = /search/i.test(p.block.toolName) ? resultSources(p.text) : [];
  view.kind = "web";
  // 同上：动作单独成词，来源数量与地址置于对象位。
  view.title = sources.length > 0
    ? p.t("chat.trace.sources", { count: sources.length })
    : p.t(TOOL_CATEGORY_LABEL_KEYS.web);
  view.object = sources.length > 0 ? undefined : p.preview || undefined;
  view.target = p.preview || undefined;
  if (sources.length > 0) view.sources = sources;
  view.sections = p.detail(sources.length > 0
    ? []
    : [...fieldsSection(p.fields), ...(isEmptyResult(p.text)
      ? []
      : [{ kind: "markdown" as const, label: "result" as const, text: p.text ?? "" }])]);
  return view;
}

/** A question tool's prompts and choices as steps, so the card is not raw JSON. */
function questionSteps(input: unknown): ToolViewStep[] | null {
  if (!isRecord(input)) return null;
  const questions = Array.isArray(input.questions) ? input.questions : null;
  if (questions && questions.length > 0) {
    const steps: ToolViewStep[] = [];
    for (const question of questions) {
      if (!isRecord(question)) return null;
      const title = typeof question.question === "string"
        ? question.question
        : typeof question.header === "string" ? question.header : null;
      if (!title) return null;
      const options = Array.isArray(question.options) ? question.options : [];
      const description = options
        .map((option) => (isRecord(option) && typeof option.label === "string" ? option.label : null))
        .filter((label): label is string => label !== null)
        .join(" · ");
      steps.push({ title, status: "pending", ...(description ? { description } : {}) });
    }
    return steps;
  }
  if (typeof input.question === "string" && Array.isArray(input.options)) {
    const description = input.options
      .map((option) => (isRecord(option) && typeof option.label === "string" ? option.label : null))
      .filter((label): label is string => label !== null)
      .join(" · ");
    return [{ title: input.question, status: "pending", ...(description ? { description } : {}) }];
  }
  return null;
}

/** `"question"="answer"` pairs in a question tool's result — how pi reports the picks. */
function questionAnswers(text: string | null): Map<string, string> {
  const answers = new Map<string, string>();
  if (!text) return answers;
  const pair = /"([^"]*)"\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(text)) !== null) answers.set(match[1], match[2]);
  return answers;
}

/**
 * A question put to the operator: the prompt is the row's name, its choices are
 * the line's description, and the pick replaces them once the answer is in.
 * Deliberately not the plan pattern — a question has no progress to report.
 */
function questionView(p: Prepared): ToolView {
  const view = baseView(p);
  const answers = questionAnswers(p.text);
  const steps = (questionSteps(p.block.input) ?? []).map((step) => {
    const answer = answers.get(step.title);
    if (answer === undefined) return step;
    return { ...step, status: "done" as const, description: p.t("chat.trace.questionAnswer", { answer }) };
  });
  view.kind = "question";
  view.title = steps.length > 0
    ? p.t("chat.trace.questionNamed", { name: steps[0].title })
    : p.t("chat.trace.question");
  view.sections = p.detail([{ kind: "steps", steps }]);
  return view;
}

function queueView(p: Prepared): ToolView {
  const view = baseView(p);
  // create 的参数包含 tasks；update/list 的列表位于结果的 details.tasks 中，需展示完整清单。
  const steps = todoSteps(p.block.input) ?? todoStepsFromDetails(p.details) ?? [];
  const done = steps.filter((step) => step.status === "done").length;
  view.kind = "queue";
  // Plan pattern (第 4.2 节): the row names the task in progress, not the tool call.
  const current = steps.find((step) => step.status === "running") ?? steps.find((step) => step.status !== "done");
  view.title = current
    ? p.t("chat.trace.planNamed", { name: current.title })
    : p.t("chat.trace.plan");
  view.description = p.t("chat.trace.planProgress", { done, total: steps.length });
  view.sections = p.detail([{ kind: "steps", steps }]);
  return view;
}

/**
 * A compression call: the row names the range it folded, the detail shows the
 * summary as Markdown — not the raw arguments object.
 */
function compactView(p: Prepared): ToolView {
  const view = baseView(p);
  const input = p.block.input;
  const start = isRecord(input) && typeof input.startId === "string" ? input.startId : null;
  const end = isRecord(input) && typeof input.endId === "string" ? input.endId : null;
  const summaryText = isRecord(input) && typeof input.summary === "string" ? input.summary : null;
  const range = start && end ? `${start}–${end}` : start ?? end ?? null;
  view.kind = "compact";
  view.title = p.t("chat.trace.compact");
  view.target = range ?? undefined;
  view.sections = p.detail(summaryText
    ? [{ kind: "markdown" as const, label: "parameters" as const, text: summaryText }]
    : []);
  return view;
}

/** The keys a nested row leads with, most specific first. */
const ROW_TITLE_KEYS = ["title", "subject", "task_id", "id", "kind", "activeForm"] as const;
const ROW_STATUS_KEYS = ["status", "state"] as const;

function scalarText(value: unknown): string | null {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * A nested argument object as the detail's rows: flat keys become fields, an
 * array of records becomes steps (its own title/status keys), and anything
 * deeper is shown as its JSON. Returns `null` when nothing nests.
 */
function structuredArgSections(input: unknown): ToolViewSection[] | null {
  if (!isRecord(input)) return null;
  const fields: ToolField[] = [];
  const steps: ToolViewStep[] = [];
  const deeper: string[] = [];
  let nested = false;

  for (const [key, value] of Object.entries(input)) {
    const flat = scalarText(value);
    if (flat !== null) {
      fields.push({ key, value: flat === "" ? EMPTY_FIELD_VALUE : flat, multiline: flat.includes("\n") });
      continue;
    }
    if (Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item))) {
      nested = true;
      for (const item of value) {
        const entries = Object.entries(item);
        const title = ROW_TITLE_KEYS.map((name) => scalarText(item[name])).find((text) => text);
        const statusText = ROW_STATUS_KEYS.map((name) => scalarText(item[name])).find((text) => text);
        const description = entries
          .filter(([name, entry]) => scalarText(entry) !== null
            && name !== "status" && name !== "state"
            && !ROW_TITLE_KEYS.includes(name as (typeof ROW_TITLE_KEYS)[number]))
          .map(([name, entry]) => `${name}: ${scalarText(entry)}`)
          .join(" · ");
        if (!title) {
          deeper.push(`${key}: ${JSON.stringify(item)}`);
          continue;
        }
        steps.push({
          title,
          status: statusText === "complete" || statusText === "completed" || statusText === "done"
            ? "done"
            : statusText === "start" || statusText === "in_progress" || statusText === "running"
              ? "running"
              : statusText === "blocked" || statusText === "error" || statusText === "skipped"
                ? "error"
                : "pending",
          ...(description ? { description } : {}),
        });
      }
      continue;
    }
    nested = true;
    deeper.push(`${key}: ${JSON.stringify(value)}`);
  }

  if (!nested) return null;
  return [
    ...(fields.length > 0 ? [{ kind: "fields" as const, label: "parameters" as const, fields }] : []),
    ...(steps.length > 0 ? [{ kind: "steps" as const, label: "parameters" as const, steps }] : []),
    ...(deeper.length > 0 ? [{ kind: "code" as const, label: "parameters" as const, text: deeper.join("\n"), language: "json" }] : []),
  ];
}

function genericView(p: Prepared): ToolView {
  const view = baseView(p);
  view.kind = "generic";
  // 行上只写工具名，名称始终完整显示；参数与正文放入展开内容，
  // 避免输入首行预览占满整行。
  view.title = humanizeToolName(p.block.toolName);
  view.sections = p.detail([
    ...(p.fields ? fieldsSection(p.fields) : jsonSection(p.inputStr, "json")),
    ...resultSections(p.text, /^\s*[[{]/.test(p.text ?? "") ? "json" : "text"),
  ]);
  return view;
}
