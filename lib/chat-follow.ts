/**
 * 会话列表贴底判定的唯一定义处。
 * `ChatWindow` 的 `atTail` 是唯一的跟随信号：官方 scroller 以 `autoScroll={false}`
 * 运行，贴底跟随、完成时刻的保持都只消费这一个状态。
 */

/** 贴底容差：距内容末端不超过该像素值即视为贴底。 */
export const CHAT_TAIL_TOLERANCE = 8;

/**
 * 跟随容差：向下滚动进入该范围即恢复跟随。向上滚动无视容差直接脱离——容差
 * 服务的是“停住的手”（惯性滚动停在新底附近），不是“回拉的手”。
 */
export const CHAT_FOLLOW_TOLERANCE = 96;

/**
 * 内容或视口变化后是否继续跟随尾部。
 * - 内容收缩（完成时列表重组、行折叠收起）把 scrollTop 钳到新的最大值：落点必在
 *   新底的贴底容差内，这不是读者上滑，维持跟随。
 * - 视口长高（键盘收起动画、窗口变大）把 scrollTop 往回钳：同理不是读者上滑。
 * - 读者上滑（内容与视口高度都没变）即脱离，先于容差判定。
 * - 贴底，或向下滚动进入跟随容差，则跟随；其余维持原状。
 */
export function shouldFollow(
  wasFollowing: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  previousScrollHeight = scrollHeight,
  previousClientHeight = clientHeight,
): boolean {
  if (
    scrollTop < previousScrollTop
    && scrollHeight < previousScrollHeight
    && isAtTail(scrollTop, clientHeight, scrollHeight)
  ) return true;
  if (
    scrollTop < previousScrollTop
    && clientHeight > previousClientHeight
    && isAtTail(scrollTop, clientHeight, scrollHeight)
  ) return true;
  if (scrollTop < previousScrollTop) return false;
  if (isAtTail(scrollTop, clientHeight, scrollHeight, CHAT_FOLLOW_TOLERANCE)) return true;
  return wasFollowing;
}

export function isAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}
