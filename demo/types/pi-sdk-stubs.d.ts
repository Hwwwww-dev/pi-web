// The demo only ships Pi Web's browser code. A few copied modules keep
// type-only (or server-only) imports from the pi SDK; declare the
// names they use loosely so the demo typechecks without the agent runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "@earendil-works/pi-coding-agent" {
  export type AgentSessionEvent = any;
  export type BashOperations = any;
  export type JsonAgentSessionEvent = any;
  export type LoadExtensionsResult = {
    extensions: { path: string; sourceInfo?: { source?: string; origin?: string }; tools: Map<string, unknown> }[];
    runtime: {
      pendingProviderRegistrations: { extensionPath: string }[];
      pendingNativeProviderRegistrations: { extensionPath: string }[];
      pendingVirtualModelRegistrations: { extensionPath: string }[];
    };
  };
  export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";
  export interface McpStdioServerConfig {
    type?: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    exposure?: McpExposure;
    description?: string;
    toolExposure?: Record<string, McpExposure>;
    enabled?: boolean;
    timeout?: number;
  }
  export interface McpRemoteServerConfig {
    type?: "http" | "sse" | string;
    url: string;
    headers?: Record<string, string>;
    oauth?: { clientId?: string; clientSecret?: string; scopes?: string[] };
    exposure?: McpExposure;
    description?: string;
    toolExposure?: Record<string, McpExposure>;
    enabled?: boolean;
    timeout?: number;
  }
  export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig;
  export type ResourceDiagnostic = any;
  export type SessionManager = any;
  export type SettingsManager = any;
  export type SlashCommandInfo = any;
  export type Theme = any;
  export function getAgentDir(): string;
}
declare module "@earendil-works/pi-agent-core" {
  export type AgentMessage = any;
  export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
declare module "@earendil-works/pi-ai" {
  export type ImageContent = any;
  export type TextContent = any;
}
