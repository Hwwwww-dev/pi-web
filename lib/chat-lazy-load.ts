/** 首屏与小地图跳转的窗口按整轮切：3 轮一屏，不多拉。 */
export const VISIBLE_PAGE_TURNS = 3;

/** 上翻/下翻一次多要一轮，读者不必等一大页落地。 */
export const OLDER_PAGE_TURNS = 3;

/** 贴底容差（px）：只吸收亚像素与页面缩放的取整，不是设计余量。 */
export const SCROLL_TAIL_EPSILON = 1;

export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  epsilon = SCROLL_TAIL_EPSILON,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - epsilon;
}
