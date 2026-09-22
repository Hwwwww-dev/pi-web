import type { InlineExtension } from "@earendil-works/pi-coding-agent";

const EXTENSION_NAME = "pi-web-exact-system-prompt";

/**
 * Force an exact system prompt on every provider request.
 *
 * Since pi 0.87 `agent.state.systemPrompt` is a read-only replay of the
 * transcript's system messages, so the prompt can no longer be assigned
 * directly. The SDK's supported path is a `before_agent_start` handler that
 * returns `systemPrompt`: the session projects that exact text onto the
 * request head (with the current tools) without touching the transcript.
 */
export function createExactSystemPromptExtension(getPrompt: () => string | undefined): InlineExtension {
  return {
    name: EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", () => {
        const systemPrompt = getPrompt();
        return systemPrompt === undefined ? undefined : { systemPrompt };
      });
    },
  };
}
