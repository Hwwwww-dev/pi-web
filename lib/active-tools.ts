import type { ToolResultMessage } from "./types";

/**
 * A run's in-flight tool results, outside React: every tool_execution_update
 * writes one entry under its toolCallId, and only the running tool's card
 * subscribes to that one value. Completed results live in the session
 * messages, so the map the message list derives from stays reference-stable
 * while output streams and the container never re-renders for a tool event.
 */
export interface ActiveToolsStore {
  get(toolCallId: string): ToolResultMessage | undefined;
  /** Subscribe to one toolCallId; the listener fires when that entry changes. */
  subscribe(toolCallId: string, listener: () => void): () => void;
  set(toolCallId: string, result: ToolResultMessage): void;
  remove(toolCallId: string): void;
  clear(): void;
}

export function createActiveToolsStore(): ActiveToolsStore {
  const results = new Map<string, ToolResultMessage>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (toolCallId: string) => {
    const set = listeners.get(toolCallId);
    if (!set) return;
    for (const listener of set) listener();
  };
  return {
    get: (toolCallId) => results.get(toolCallId),
    subscribe(toolCallId, listener) {
      let set = listeners.get(toolCallId);
      if (!set) {
        set = new Set();
        listeners.set(toolCallId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(toolCallId);
      };
    },
    set(toolCallId, result) {
      results.set(toolCallId, result);
      notify(toolCallId);
    },
    remove(toolCallId) {
      if (!results.delete(toolCallId)) return;
      notify(toolCallId);
    },
    clear() {
      if (results.size === 0) return;
      results.clear();
      for (const toolCallId of [...listeners.keys()]) notify(toolCallId);
    },
  };
}
