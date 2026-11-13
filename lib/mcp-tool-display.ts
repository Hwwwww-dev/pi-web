// Display names for MCP tools. pi registers them as `mcp__<server>__<tool>`,
// sanitized to `[A-Za-z0-9_-]` and given a hash suffix past 64 characters or
// when another tool already has the name, so the registered name cannot be
// split back into the server's names: `docs.v2` / `search.pages` and
// `docs_v2` / `search_pages` sanitize alike, and either part may hold `__`. pi's TUI labels them `server/tool` from the tool
// definition; the browser has those names only in a result's details
// (`{ server, tool }`). Without a result a call keeps its registered name,
// which is also the name codemode scripts call it by.

/** Larger results are shown as the server sent them. */
const PRETTY_JSON_MAX_CHARS = 200_000;
const MCP_TOOL_PREFIX = "mcp__";

export interface McpToolLabel {
  server: string;
  tool: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server and tool an MCP call's result names, or null when there is none to go by. */
export function mcpToolLabel(toolName: string, details?: unknown): McpToolLabel | null {
  if (!toolName.startsWith(MCP_TOOL_PREFIX) || !isRecord(details)) return null;
  const { server, tool } = details;
  return typeof server === "string" && typeof tool === "string" && server && tool ? { server, tool } : null;
}

/**
 * A running MCP call has no result yet, so it is labelled from the registered
 * name `mcp__<server>__<tool>`. That name is sanitized, so the split is best
 * effort: it applies only when the name has exactly three segments.
 */
export function mcpToolNameLabel(toolName: string): McpToolLabel | null {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return null;
  const parts = toolName.slice(MCP_TOOL_PREFIX.length).split("__");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { server: parts[0], tool: parts[1] };
}

/**
 * MCP servers often answer with one JSON document as text, compacted. Show it
 * indented; anything else, including JSON surrounded by other text, as sent.
 */
export function prettyMcpResultText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length > PRETTY_JSON_MAX_CHARS || !/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}
