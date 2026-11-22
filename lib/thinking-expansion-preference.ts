import { advancedValue } from "@/lib/advanced-values";

const STORAGE_KEY = "pi-thinking-expanded";
// Broadcast so already-mounted ThinkingBlock instances update when the
// preference changes in the settings panel.
export const THINKING_EXPANDED_EVENT = "pi-thinking-expanded-changed";

export function isThinkingExpandedByDefault(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // localStorage 优先（通用设置里的旧开关）；没存过时跟随 Settings › 高级参数。
    if (stored !== null) return stored === "true";
  } catch {
    // 存储不可用（隐私模式）：当作没存过，回退到参数默认值。
  }
  return advancedValue<boolean>("thinkingDefaultExpanded");
}

export function setThinkingExpandedByDefault(expanded: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(expanded));
  } catch {
    // Nothing was saved, so there is no change to announce.
    return;
  }
  window.dispatchEvent(new Event(THINKING_EXPANDED_EVENT));
}
