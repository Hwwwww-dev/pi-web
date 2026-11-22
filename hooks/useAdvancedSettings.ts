"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AdvancedSettingValue, AdvancedSettings } from "@/lib/advanced-settings";
import {
  ADVANCED_SETTINGS_DEFAULTS,
  advancedSettingsSnapshot,
  applyAdvancedSettings,
  ensureAdvancedSettings,
  resetAdvancedSettings,
  setAdvancedSetting,
  subscribeAdvancedSettings,
} from "@/lib/advanced-settings-store";

/**
 * 「高级参数」的 React 一侧：只做 `useSyncExternalStore` 的接线，store 本体在
 * `lib/advanced-settings-store.ts`（接线点要在事件回调里同步读，不能只靠 hook）。
 */

function getSnapshot(): AdvancedSettings {
  return advancedSettingsSnapshot();
}

/** 服务端渲染与客户端首帧都用默认值：同一份模块常量，引用稳定。 */
function getServerSnapshot(): AdvancedSettings {
  return ADVANCED_SETTINGS_DEFAULTS;
}

/** 整份参数表。只关心一个键时用 `useAdvancedSettingValue`，避免无关重渲染。 */
export function useAdvancedSettings(): AdvancedSettings {
  return useSyncExternalStore(subscribeAdvancedSettings, getSnapshot, getServerSnapshot);
}

/** 单个参数值：只在它自己变化时重渲染。 */
export function useAdvancedSettingValue<K extends AdvancedSettingValue>(key: string): K {
  const read = useCallback(() => advancedSettingsSnapshot()[key] as K, [key]);
  return useSyncExternalStore(subscribeAdvancedSettings, read, read);
}

export interface AdvancedSettingsActions {
  set: (key: string, value: AdvancedSettingValue) => Promise<void>;
  reset: () => Promise<void>;
  /** 导入一整份 JSON：服务端仍逐条校验与钳制。 */
  apply: (next: AdvancedSettings) => Promise<void>;
}

export function useAdvancedSettingsActions(): AdvancedSettingsActions {
  return {
    set: setAdvancedSetting,
    reset: resetAdvancedSettings,
    apply: applyAdvancedSettings,
  };
}

/** 页面挂载时读一次；其他订阅点也会各自触发，重复调用共用同一个请求。 */
export function useAdvancedSettingsLoader(): void {
  useSyncExternalStore(subscribeAdvancedSettings, getSnapshot, getServerSnapshot);
  void ensureAdvancedSettings();
}
