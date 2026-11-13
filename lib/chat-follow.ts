/**
 * 会话列表贴底判定的唯一定义处。
 * `ChatWindow` 的 `atTail` 是唯一的跟随信号：官方 scroller 以 `autoScroll={false}`
 * 运行，贴底跟随、完成时刻的保持都只消费这一个状态。
 */

/** 贴底容差：距内容末端不超过该像素值即视为贴底。 */
export const CHAT_TAIL_TOLERANCE = 16;

/**
 * 跟随容差：向下滚动进入该范围即恢复跟随。容差服务的是“停住的手”
 * （惯性滚动停在新底附近），不是“回拉的手”。
 */
export const CHAT_FOLLOW_TOLERANCE = 96;

/**
 * 内容或视口变化后是否继续跟随尾部。
 * - 同帧伴随内容/视口高度变化的上移是滚动锚定调整（图片加载、行折叠、键盘
 *   收起等把 scrollTop 微调回去），不是回拉的手，维持原状态——锚定必然伴随
 *   高度变化，纯手势回拉高度不变；这比像素死区可靠：像素阈值会被跟随循环
 *   的回拽不断清零，脱离不了（用户上滑抖动几秒的根因）。
 * - 纯手势回拉（高度都没变）立即脱离。
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
  if (scrollTop < previousScrollTop) {
    // 同帧高度变化：锚定调整，不算上滑。落到新底附近则跟随（完成时列表重组、
    // 行折叠收起、视口长高的钳制落点都在新底贴底容差内）。
    if (scrollHeight !== previousScrollHeight || clientHeight !== previousClientHeight) {
      return isAtTail(scrollTop, clientHeight, scrollHeight) ? true : wasFollowing;
    }
    return false;
  }
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
