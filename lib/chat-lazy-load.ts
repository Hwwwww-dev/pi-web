import { CHAT_TAIL_TOLERANCE, isAtTail } from "./chat-follow";

/** 首屏与小地图跳转的窗口按整轮切：3 轮一屏，不多拉。 */
export const VISIBLE_PAGE_TURNS = 3;

/** 上翻/下翻一次只多要一轮，读者不必等一大页落地。 */
export const OLDER_PAGE_TURNS = 1;

/** 只作用在已加载消息上的渲染窗口（不是请求窗口）。 */
export const VISIBLE_PAGE_SIZE = 50;

export function getVisibleRenderWindow(totalCount: number, visibleCount: number): {
  startIndex: number;
  hasMore: boolean;
} {
  const clampedVisibleCount = Math.min(Math.max(visibleCount, 0), Math.max(totalCount, 0));
  const startIndex = Math.max(0, totalCount - clampedVisibleCount);
  return { startIndex, hasMore: startIndex > 0 };
}

export function getNextVisibleCount(currentVisibleCount: number, pageSize = VISIBLE_PAGE_SIZE): number {
  return currentVisibleCount + pageSize;
}

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_TAIL_TOLERANCE,
): boolean {
  return isAtTail(scrollTop, clientHeight, scrollHeight, tolerance);
}
