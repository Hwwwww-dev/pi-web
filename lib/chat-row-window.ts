/**
 * 消息行的窗口化：视口外一定范围的消息行只保留占位高度，组件树卸载。
 *
 * 不做按估算高度的虚拟列表，是因为会话行的真实高度只有渲染后才知道（图片、
 * Mermaid、展开的折叠体），估算会让锚点还原、顶部翻页、搜索定位全部失准。
 * 这里反过来：行先照常渲染一次，量到真实高度后，离开窗口才收成占位——
 * 收与放的高度相等，因此滚动位置、`scrollToMessage`、前插保位都不受影响。
 */

export interface RowRect {
  /** 条目 id（`data-entry-id`），用于跨次滚动认行。 */
  id: string;
  /** 相对滚动容器内容顶部的上沿。 */
  top: number;
  /** 当前渲染高度。 */
  height: number;
}

export interface RowWindow {
  /** 应收成占位高度的行 id，及其占位高度。 */
  collapsed: Map<string, number>;
}

/** 视口上下各预留多少屏。够远，快速滚动时不会看到空占位。 */
const OVERSCAN_RATIO = 1.5;

/**
 * @param rows 已渲染的行及其位置（顺序与 DOM 一致）
 * @param scrollTop 滚动容器当前 scrollTop
 * @param viewportHeight 滚动容器可视高度；为 0（保活槽隐藏）时不做任何折叠
 * @param keep 永不折叠的行（正在定位/搜索命中的行）
 */
export function computeRowWindow(
  rows: readonly RowRect[],
  scrollTop: number,
  viewportHeight: number,
  keep: ReadonlySet<string> = new Set(),
): RowWindow {
  const collapsed = new Map<string, number>();
  if (viewportHeight <= 0) return { collapsed };
  const margin = viewportHeight * OVERSCAN_RATIO;
  const topLimit = scrollTop - margin;
  const bottomLimit = scrollTop + viewportHeight + margin;
  for (const row of rows) {
    if (keep.has(row.id)) continue;
    const bottom = row.top + row.height;
    if (bottom < topLimit || row.top > bottomLimit) {
      // 保留小数：向上取整会在折叠很多行时累加成可见的位移。
      collapsed.set(row.id, Math.round(row.height * 100) / 100);
    }
  }
  return { collapsed };
}

/** 两份折叠结果是否等价（避免每帧 setState）。 */
export function sameRowWindow(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, height] of a) {
    if (b.get(key) !== height) return false;
  }
  return true;
}
