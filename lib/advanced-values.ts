import { advancedSettingSpec, type AdvancedSettingValue } from "@/lib/advanced-settings";
import { advancedSettingsSnapshot } from "@/lib/advanced-settings-store";

/**
 * 参数表里的值，接线点统一走这一个函数。
 *
 * 不做成「导入常量」：值随时可改，读的时候必须是当前值；这些读点又多在事件
 * 回调里（取页、入队、滚动），不是 React 渲染，不需要订阅。参数表是默认值的
 * 唯一来源，拿不到值就退回它自己的默认值，绝不另写一份。
 */
export function advancedValue<K extends AdvancedSettingValue>(key: string): K {
  const value = advancedSettingsSnapshot()[key];
  if (value !== undefined) return value as K;
  const spec = advancedSettingSpec(key);
  return (spec ? spec.default : 0) as K;
}

/** 首屏 / 小地图跳转按几轮切。 */
export function pageTurns(): number {
  return advancedValue<number>("pageTurns");
}

/** 上翻 / 下翻一次补几轮。 */
export function olderPageTurns(): number {
  return advancedValue<number>("olderPageTurns");
}

/** 离开超过这么久再回来，才整窗重载（毫秒）。 */
export function awayReloadMs(): number {
  return advancedValue<number>("awayReloadMs");
}
