/**
 * 会话列表贴底判定的唯一定义处。
 * `ChatWindow` 的 `atTail` 是唯一的跟随信号：官方 scroller 以 `autoScroll={false}`
 * 运行，贴底跟随、完成时刻的保持都只消费这一个状态。

 * 业界标准契约（chat-scroll stick-to-bottom、ChatGPT-Next-Web 等的共同做法）：
 * - 贴底与重进跟随共用一个距离带（100px，业界默认 40–100 的通用上限值）。
 * - 跟随的脱离只认用户输入：滚轮上滚、触摸上滑、ArrowUp/PageUp/Home 到达即
 *   脱离。不从 scrollTop 差值反推意图——折叠保位、浏览器钳制、图片加载引起的
 *   程序化滚动都会被差值启发式误判成"用户离开"（思考行折叠后跟随脱死的根因）。
 *   滚轮另有累计阈值（createWheelGesture）：触控板单帧几个 px 的负 delta
 *   属噪声，累计到 WHEEL_LEAVE_THRESHOLD_PX 才算离开意图。
 * - 滚动条拖拽没有输入事件，由几何兜底：距底超出距离带即脱离。
 * - 带内回挂：压制期间读者向下滚（滚轮/触摸）且几何仍在带内 = 回底意图，
 *   立即解除压制——读者不必先滚出距离带再滚回来，否则带内脱离后回底
 *   按钮不亮、跟随不恢复，读者进退无门。
 * - 内容高度变化（行折叠、图片加载、流式追加）后按几何位置重算，状态自愈。
 */

/** 贴底/重进跟随共用距离带（px）：距内容末端不超过该值即视为贴底。
 *  160 > 手机端输入框浮层高度：浮层悬在容器底边之上，「看到最后一条结尾」
 *  时的距底距离可达约 110px，100px 的旧带在手机上根本进不去。 */
export const CHAT_TAIL_TOLERANCE = 160;

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

/** 滚轮脱离阈值（px）：窗口内向上累计超过即脱离。鼠标一格 ~100px 一次脱离；
 *  触控板单帧几个 px 的负 delta（轻碰、横向滑动噪声）到不了。 */
export const WHEEL_LEAVE_THRESHOLD_PX = 32;
/** 滚轮回挂阈值（px）：压制期间向下累计超过即回挂（几何仍在带内时）。低门槛：
 *  回底意图的误判代价低，几何贴底本来就该跟随。 */
export const WHEEL_REATTACH_THRESHOLD_PX = 6;
/** 累计时间窗（ms）：窗内断续滚轮持续累计，超窗清零。 */
export const WHEEL_ACCUM_WINDOW_MS = 400;

export type WheelAction = "none" | "leave" | "reattach";

/**
 * 滚轮手势判定器：向上累计到阈值才报告"离开"，向下累计到阈值报告"回挂"；
 * 方向反转或超窗清零。脱离开关由 hooks/useChatFollow 消费（回挂还须几何
 * 在带内，几何不归这里管）。
 */
export function createWheelGesture(now: () => number = () => Date.now()) {
  let up = 0;
  let down = 0;
  let lastAt = -Infinity;
  return {
    /** scale：deltaMode 非 0 时把行/页单位换算成像素（行 ×16、页 ×视口高）。 */
    feed(deltaY: number, scale = 1): WheelAction {
      const t = now();
      if (t - lastAt > WHEEL_ACCUM_WINDOW_MS) {
        up = 0;
        down = 0;
      }
      lastAt = t;
      const dy = deltaY * scale;
      if (dy < 0) {
        down = 0;
        up += -dy;
        if (up >= WHEEL_LEAVE_THRESHOLD_PX) {
          up = 0;
          return "leave";
        }
        return "none";
      }
      if (dy > 0) {
        up = 0;
        down += dy;
        if (down >= WHEEL_REATTACH_THRESHOLD_PX) {
          down = 0;
          return "reattach";
        }
        return "none";
      }
      return "none";
    },
  };
}
