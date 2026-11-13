/**
 * 会话列表贴底判定的唯一定义处。
 * `ChatWindow` 的 `atTail` 是唯一的跟随信号：官方 scroller 以 `autoScroll={false}`
 * 运行，贴底跟随、完成时刻的保持都只消费这一个状态。

 * 业界标准契约（chat-scroll stick-to-bottom、ChatGPT-Next-Web 等的共同做法）：
 * - 贴底与重进跟随共用一个距离带（100px，业界默认 40–100 的通用上限值）。
 * - 跟随的脱离只认用户输入：滚轮上滚、触摸上滑、ArrowUp/PageUp/Home 到达即
 *   脱离。不从 scrollTop 差值反推意图——折叠保位、浏览器钳制、图片加载引起的
 *   程序化滚动都会被差值启发式误判成"用户离开"（思考行折叠后跟随脱死的根因）。
 * - 滚动条拖拽没有输入事件，由几何兜底：距底超出距离带即脱离。
 * - 内容高度变化（行折叠、图片加载、流式追加）后按几何位置重算，状态自愈。
 */

/** 贴底/重进跟随共用距离带（px）：距内容末端不超过该值即视为贴底。 */
export const CHAT_TAIL_TOLERANCE = 100;

export function isAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}

/** 用户输入是否为"向上离开"意图：滚轮/触摸事件的向上分量。 */
export function isUpwardGesture(deltaY: number): boolean {
  return deltaY < 0;
}
