import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";

/**
 * Coarse activity categories used by the compact chat rows. A category decides
 * the icon, the localized row label, and which tool calls merge into one
 * collapsed group line ("编辑 · 2 个文件").
 */
export type ToolCategory =
  | "view"
  | "search"
  | "edit"
  | "terminal"
  | "subagent"
  | "plan"
  | "compact"
  | "web"
  | "other";

/** i18n key carrying the category's display label. */
export const TOOL_CATEGORY_LABEL_KEYS: Record<ToolCategory, string> = {
  view: "chat.toolCategory.view",
  search: "chat.toolCategory.search",
  edit: "chat.toolCategory.edit",
  terminal: "chat.toolCategory.terminal",
  subagent: "chat.toolCategory.subagent",
  plan: "chat.toolCategory.plan",
  compact: "chat.toolCategory.compact",
  web: "chat.toolCategory.web",
  other: "chat.toolCategory.other",
};

/**
 * Same decorated-form tolerance as lib/tool-names.ts: pi's built-in names get
 * prefixed / namespaced / suffixed variants from MCP servers and extensions.
 */
function matchesToolName(toolName: string, canonical: string): boolean {
  const name = toolName.toLowerCase();
  return name === canonical ||
    name.startsWith(`${canonical}_`) ||
    name.startsWith(`${canonical}-`) ||
    name.endsWith(`.${canonical}`) ||
    name.endsWith(`_${canonical}`) ||
    name.endsWith(`-${canonical}`);
}

export function isReadToolName(toolName: string): boolean {
  return matchesToolName(toolName, "read") || matchesToolName(toolName, "ls") || matchesToolName(toolName, "find");
}

export function isSearchToolName(toolName: string): boolean {
  return matchesToolName(toolName, "grep") || matchesToolName(toolName, "glob");
}

export function isTerminalToolName(toolName: string): boolean {
  return matchesToolName(toolName, "bash") || matchesToolName(toolName, "powershell");
}

export function isSubagentToolName(toolName: string): boolean {
  return matchesToolName(toolName, "agent") || matchesToolName(toolName, "get_subagent_result") || matchesToolName(toolName, "steer_subagent");
}

export function isPlanToolName(toolName: string): boolean {
  return matchesToolName(toolName, "todo_write") || matchesToolName(toolName, "todowrite") || matchesToolName(toolName, "todo");
}

export function isCompactToolName(toolName: string): boolean {
  return matchesToolName(toolName, "compress") || matchesToolName(toolName, "compact");
}

export function isWebToolName(toolName: string): boolean {
  return matchesToolName(toolName, "webfetch") || matchesToolName(toolName, "websearch") || matchesToolName(toolName, "fetch");
}

export function getToolCategory(toolName: string): ToolCategory {
  if (isTerminalToolName(toolName)) return "terminal";
  if (isEditToolName(toolName) || isWriteToolName(toolName) || isApplyPatchToolName(toolName)) return "edit";
  if (isReadToolName(toolName)) return "view";
  if (isSearchToolName(toolName)) return "search";
  if (isSubagentToolName(toolName)) return "subagent";
  if (isPlanToolName(toolName)) return "plan";
  if (isCompactToolName(toolName)) return "compact";
  if (isWebToolName(toolName)) return "web";
  return "other";
}

/**
 * File-path-valued input keys, ordered by preference. Tool inputs from
 * built-ins and MCP servers use a handful of conventional names.
 */
const FILE_PATH_INPUT_KEYS = ["path", "file_path", "filePath", "absolute_path", "notebook_path"] as const;

/** Extracts the file paths a tool call targets, for clickable file chips. */
export function getToolFilePaths(input: Record<string, unknown> | undefined): string[] {
  if (!input || typeof input !== "object") return [];
  const paths: string[] = [];
  for (const key of FILE_PATH_INPUT_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) paths.push(value.trim());
  }
  if (paths.length === 0 && Array.isArray(input.paths)) {
    for (const value of input.paths) {
      if (typeof value === "string" && value.trim()) paths.push(value.trim());
    }
  }
  return paths;
}

/**
 * Collapsed preview text for a tool call header. Non-primitive values are
 * JSON-stringified (compact) so an object/array argument can never render as
 * "[object Object]".
 */
export function getToolPreviewText(block: { input?: Record<string, unknown>; rawInput?: string }): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  if (typeof input.command === "string" && input.command) return input.command;
  for (const key of FILE_PATH_INPUT_KEYS) {
    if (typeof input[key] === "string" && input[key]) return input[key] as string;
  }
  if (typeof input.pattern === "string" && input.pattern) return input.pattern;
  if (typeof input.query === "string" && input.query) return input.query;
  if (typeof input.url === "string" && input.url) return input.url;

  const first = input[keys[0]];
  return previewValue(first);
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
