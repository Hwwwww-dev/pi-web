/**
 * 会话列表贴底判定的唯一定义处。
 * `ChatWindow` 的 `atTail`、`useAgentSession` 的跟随状态、官方 scroller 的贴尾行为均调用此处，
 * 数值与判定只维护一份。
 */

/** 贴底容差：距内容末端不超过该像素值即视为贴底。 */
export const CHAT_TAIL_TOLERANCE = 8;

/**
 * 重新接上跟随的容差，用于流式期间向上滚动后恢复跟随。取值比贴底容差宽松。
 */
export const CHAT_REATTACH_TOLERANCE = 96;

/**
 * 跟随容差。8px 判定贴底（决定“回到最新”按钮是否显示），96px 判定仍处于跟随状态。
 * 若以 8px 判定跟随，触控板一次惯性滚动可达数十像素，轻微滑动即脱离跟随且不再恢复。
 */
export const CHAT_FOLLOW_TOLERANCE = CHAT_REATTACH_TOLERANCE;

/**
 * 内容高度变化后是否继续贴底：超出容差范围即取消跟随，重新回到容差范围内则恢复，其余保持原状。
 */
export function shouldFollow(
  wasFollowing: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (isAtTail(scrollTop, clientHeight, scrollHeight, CHAT_FOLLOW_TOLERANCE)) return true;
  if (scrollTop < previousScrollTop) return false;
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

/**
 * 滚动后是否保持跟随：已在底部则跟随；向上滚动（scrollTop 减小）则取消；
 * 原本未跟随而向下滚动进入 `reattachTolerance` 则恢复；其余情况维持原状态。
 */
export function keepFollowing(
  wasFollowing: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  reattachTolerance = CHAT_REATTACH_TOLERANCE,
): boolean {
  if (isAtTail(scrollTop, clientHeight, scrollHeight)) return true;
  if (scrollTop < previousScrollTop) return false;
  if (
    !wasFollowing
    && scrollTop > previousScrollTop
    && isAtTail(scrollTop, clientHeight, scrollHeight, reattachTolerance)
  ) return true;
  return wasFollowing;
}

/** “回到最新”按钮的显示条件：内容超过一屏且未处于底部。 */
export function shouldOfferScrollToLatest(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_TAIL_TOLERANCE,
): boolean {
  if (scrollHeight <= clientHeight) return false;
  return !isAtTail(scrollTop, clientHeight, scrollHeight, tolerance);
}
