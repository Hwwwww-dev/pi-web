import {
  defaultAdvancedSettings,
  type AdvancedSettingValue,
  type AdvancedSettings,
} from "@/lib/advanced-settings";

/**
 * 「高级参数」的客户端 store。
 *
 * 放在普通模块里（不是 hook）：页面要订阅它，接线点（取页、入队、滚动事件）
 * 要在回调里同步读当前值，两端读的是同一份。React 那一侧见
 * `hooks/useAdvancedSettings.ts`，它只负责 `useSyncExternalStore` 的接线。
 *
 * 首屏（含服务端渲染）是默认值，挂载后拉一次 `/api/advanced-settings`；
 * 改动先落本地再 PATCH，失败回滚。
 */

const DEFAULT_VALUES = defaultAdvancedSettings();

let values: AdvancedSettings = DEFAULT_VALUES;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** 服务端渲染与客户端首帧共用这一份引用：`useSyncExternalStore` 要求稳定。 */
export const ADVANCED_SETTINGS_DEFAULTS: AdvancedSettings = DEFAULT_VALUES;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeAdvancedSettings(listener: () => void): () => void {
  listeners.add(listener);
  void ensureAdvancedSettings();
  return () => { listeners.delete(listener); };
}

export function advancedSettingsSnapshot(): AdvancedSettings {
  return values;
}

export function advancedSettingsDefaults(): AdvancedSettings {
  return DEFAULT_VALUES;
}

async function fetchValues(): Promise<void> {
  const response = await fetch("/api/advanced-settings");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as { values?: AdvancedSettings };
  if (!data.values) throw new Error("Invalid advanced settings response");
  values = data.values;
  loaded = true;
  emit();
}

/** 只在第一次用到时读一次；并发调用共用同一个请求。读失败按默认值跑，下次再试。 */
export function ensureAdvancedSettings(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = fetchValues()
      .catch(() => {
        loading = null;
      })
      .finally(emit);
  }
  return loading;
}

async function patch(body: unknown): Promise<AdvancedSettings> {
  const response = await fetch("/api/advanced-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as { values?: AdvancedSettings; error?: string };
  if (!response.ok || !data.values) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.values;
}

async function optimistic(changes: AdvancedSettings): Promise<void> {
  const previous = values;
  values = { ...values, ...changes };
  emit();
  try {
    values = await patch({ values: changes });
  } catch (error) {
    values = previous;
    throw error;
  } finally {
    emit();
  }
}

/** 改一个键（乐观更新，失败回滚）。 */
export async function setAdvancedSetting(key: string, value: AdvancedSettingValue): Promise<void> {
  await optimistic({ [key]: value });
}

/** 整页恢复默认。 */
export async function resetAdvancedSettings(): Promise<void> {
  const previous = values;
  values = DEFAULT_VALUES;
  emit();
  try {
    values = await patch({ reset: true });
  } catch (error) {
    values = previous;
    throw error;
  } finally {
    emit();
  }
}

/** 导入一整份值：只写与默认值不同的键，服务端仍逐条校验与钳制。 */
export async function applyAdvancedSettings(next: AdvancedSettings): Promise<void> {
  await optimistic(next);
}
