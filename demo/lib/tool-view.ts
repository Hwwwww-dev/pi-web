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
import { mcpToolLabel, prettyMcpResultText, type McpToolLabel } from "./mcp-tool-display";
import type { SplitDiffFile } from "./patch";
import { getToolCategory, getToolFilePaths, getToolPreviewText, TOOL_CATEGORY_LABEL_KEYS, isSubagentToolName } from "./tool-categories";
import { toolFieldsOfInput, type ToolField } from "./tool-fields";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import type { ImageContent, ToolCallContent, ToolResultMessage } from "./types";
import type { TranslationParams } from "./i18n/types";

export type ToolViewKind =
  | "terminal"
  | "file-read"
  | "file-write"
  | "file-edit"
  | "search"
  | "web"
  | "codemode"
  | "subagent"
  | "mcp"
  | "queue"
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
  /** Secondary text after the title: a path, a preview, a count. */
  description?: string;
  sections: ToolViewSection[];
  /** The call's own text when its detail shows it as a block (a shell command). */
  command?: string;
  filePaths: string[];
  images: string[];
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
  // SAFETY: pi's image blocks come flat (`data` + `mimeType`) or nested (`source`); both fields are optional and checked below.
  const flat = image as unknown as { data?: string; mimeType?: string };
  if (image.source) {
    return image.source.type === "base64"
      ? `data:${image.source.media_type};base64,${image.source.data}`
      : image.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function resultText(result: ToolResultMessage | undefined, dropCodemodeHeader: boolean): {
  text: string | null;
  images: string[];
} {
  if (!result) return { text: null, images: [] };
  const content = dropCodemodeHeader ? stripCodemodeHeader(result.content) : result.content;
  const text = content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const images = content
    .filter((block): block is ImageContent => block.type === "image")
    .map(imageSource)
    .filter((src) => src !== "");
  return { text, images };
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
  return [{ kind: "code", label: "parameters", text, language }];
}

/**
 * The URLs a search's result text names: Markdown links first, then bare
 * addresses. Deduplicated by address, in the order the text gave them.
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
  for (const match of text.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)) push(match[1] ?? "", match[2] ?? "");
  for (const match of text.matchAll(/https?:\/\/[^\s<>()\]]+/g)) push("", match[0]);
  return sources.slice(0, 20);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A to-do tool's items, when its input carries them in the conventional shape. */
function todoSteps(input: unknown): ToolViewStep[] | null {
  if (!isRecord(input) || !Array.isArray(input.todos)) return null;
  const steps: ToolViewStep[] = [];
  for (const item of input.todos) {
    if (!isRecord(item)) return null;
    const title = typeof item.content === "string" ? item.content : typeof item.title === "string" ? item.title : null;
    if (title === null) return null;
    const status: ToolViewStatus = item.status === "completed"
      ? "done"
      : item.status === "in_progress" ? "running" : "pending";
    steps.push({ title, status });
  }
  return steps.length > 0 ? steps : null;
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
function applyPatchFiles(block: ToolCallContent, result?: ToolResultMessage): SplitDiffFile[] | null {
  const fromInput = parseApplyPatchInput(getApplyPatchInputText(block.input, block.rawInput));
  if (fromInput) return fromInput;
  const details = result && !result.isError ? result.details : undefined;
  if (!isRecord(details)) return null;
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
function baseName(path: string): string {
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
  const mcp = mcpToolLabel(block.toolName, result?.details);
  const script = block.toolName === CODEMODE_TOOL_NAME && !streamingInput ? codemodeScript(block.input) : null;
  const codemode = script === null ? null : { code: script, ...codemodeCalls(result?.details) };
  // A codemode result repeats the script as its leading text; the row shows the
  // calls instead, so the copy is dropped.
  const { text: rawText, images } = resultText(result, codemode !== null);
  const patchFiles = isApplyPatchToolName(block.toolName) ? applyPatchFiles(block, result) : null;
  const writtenFileText = getWrittenFileText(block);
  const command = getToolCategory(block.toolName) === "terminal" && !streamingInput && typeof block.input.command === "string"
    ? block.input.command
    : null;
  const isError = (result?.isError ?? false)
    || (isApplyPatchToolName(block.toolName) && applyPatchResultHasFailures(result?.details));
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
  if (p.command !== null) return "terminal";
  if (isWriteToolName(name)) return "file-write";
  if (isEditToolName(name) || isApplyPatchToolName(name)) return "file-edit";
  const category = getToolCategory(name);
  if (category === "view") return "file-read";
  if (category === "search") return "search";
  if (category === "web") return "web";
  if (category === "plan" && todoSteps(p.block.input)) return "queue";
  return "generic";
}

export function toToolView(input: ToolViewInput): ToolView {
  const p = prepare(input);
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
  view.title = p.t("chat.trace.ran", { command: firstLine(p.command ?? "") });
  view.sections = p.detail(isEmptyResult(p.text) ? [] : [{ kind: "code", text: p.text ?? "", language: "text" }]);
  return view;
}

function writeView(p: Prepared): ToolView {
  const view = baseView(p);
  const language = getLanguage(p.filePaths[0] ?? "");
  view.kind = "file-write";
  view.title = p.filePaths[0]
    ? p.t("chat.trace.wrote", { path: baseName(p.filePaths[0]) })
    : p.t(TOOL_CATEGORY_LABEL_KEYS.edit);
  view.description = p.writtenFileText === null ? p.preview || undefined : undefined;
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
  view.title = names.length === 1
    ? p.t("chat.trace.edited", { path: baseName(names[0] ?? "") })
    : names.length > 1
      ? p.t("chat.trace.editedFiles", { count: names.length })
      : p.t(TOOL_CATEGORY_LABEL_KEYS.edit);
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
  view.title = p.filePaths[0]
    ? p.t("chat.trace.read", { path: baseName(p.filePaths[0]) })
    : p.t(TOOL_CATEGORY_LABEL_KEYS.view);
  view.description = p.filePaths[0] ? undefined : p.preview || undefined;
  view.sections = p.detail([
    ...(p.fields ? fieldsSection(p.fields) : jsonSection(p.inputStr, "json")),
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
  view.title = p.t("chat.trace.searched", { pattern: query || p.preview || p.t(TOOL_CATEGORY_LABEL_KEYS.search) });
  view.sections = p.detail([...fieldsSection(p.fields), ...resultSections(p.text, "text")]);
  return view;
}

function webView(p: Prepared): ToolView {
  const view = baseView(p);
  const sources = /search/i.test(p.block.toolName) ? resultSources(p.text) : [];
  view.kind = "web";
  view.title = sources.length > 0
    ? p.t("chat.trace.sources", { count: sources.length })
    : p.t("chat.trace.fetched", { target: p.preview || p.t(TOOL_CATEGORY_LABEL_KEYS.web) });
  if (sources.length > 0) view.sources = sources;
  view.sections = p.detail(sources.length > 0
    ? []
    : [...fieldsSection(p.fields), ...(isEmptyResult(p.text)
      ? []
      : [{ kind: "markdown" as const, label: "result" as const, text: p.text ?? "" }])]);
  return view;
}

function queueView(p: Prepared): ToolView {
  const view = baseView(p);
  const steps = todoSteps(p.block.input) ?? [];
  const open = steps.filter((step) => step.status !== "done").length;
  view.kind = "queue";
  view.title = open > 0
    ? p.t("chat.trace.todoOpen", { count: open })
    : p.t("chat.trace.todoDone", { count: steps.length });
  view.sections = p.detail([{ kind: "steps", steps }]);
  return view;
}

function genericView(p: Prepared): ToolView {
  const view = baseView(p);
  view.kind = "generic";
  view.title = humanizeToolName(p.block.toolName);
  view.description = p.preview || undefined;
  view.sections = p.detail([
    ...(p.fields ? fieldsSection(p.fields) : jsonSection(p.inputStr, "json")),
    ...resultSections(p.text, /^\s*[[{]/.test(p.text ?? "") ? "json" : "text"),
  ]);
  return view;
}
