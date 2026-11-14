/**
 * 会话列表贴底跟随的唯一定义处：状态机 + 滚轮噪声过滤。
 *
 * 三条不变式（"完美"在这里是可验证的约定，不是调出来的手感）：
 * 1. 程序化滚动只有两个来源：已贴底时内容/视口变化带来的补位，以及显式回底
 *    （回底按钮、发送、切会话）。除此之外代码永不写 scrollTop。
 * 2. 贴底只由意图进入：读者自己滚到底（距离 ≤ CHAT_TAIL_EPSILON）、点回底、发送、
 *    切会话。几何只能否决跟随，不能发起跟随——"距底 160px 内自动贴底"正是吸附感
 *    的来源，这里没有距离带。
 * 3. 判定只看容器自身几何，与"可视底边在哪"无关：composer 是停靠还是浮层、键盘
 *    钉多高、视口怎么变，都不影响 `scrollTop + clientHeight >= scrollHeight - 1`。
 *
 * 由此，任意事件造成的位移上界 = 这一帧内容长出来的量（补位），不可能是"跳到底"。
 * 判定万一失准，后果只是"不自动跟"，而回底按钮（只要距底 >0 就出现）永远兜底：
 * 按钮的可见阈值与这里的贴底容差同一个数，二者之间不留"既不跟、也没按钮"的缝。
 */

/** 贴底容差（px）：只吸收亚像素与页面缩放的取整，不是设计余量。 */
export const CHAT_TAIL_EPSILON = 1;

export function isAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  epsilon = CHAT_TAIL_EPSILON,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - epsilon;
}

/** 用户输入是否为"向上离开"意图：滚轮/触摸事件的向上分量。 */
export function isUpwardGesture(deltaY: number): boolean {
  return deltaY < 0;
}

/** 滚轮脱离阈值（px）：窗口内向上累计超过即脱离。鼠标一格 ~100px 一次脱离；
 *  触控板单帧几个 px 的负 delta（轻碰、横向滑动噪声）到不了。 */
export const WHEEL_LEAVE_THRESHOLD_PX = 32;

/** 累计时间窗（ms）：窗内断续滚轮持续累计，超窗清零。 */
export const WHEEL_ACCUM_WINDOW_MS = 400;

export type WheelAction = "none" | "leave";

/**
 * 滚轮手势判定器：向上累计到阈值才报告"离开"，向下只清零累计。
 * 向下不产生任何动作——回底只有"滚到真底"（几何）或"点按钮"（命令）两条路，
 * 所以不存在"轻推 6px 换来一次跳跃"。
 */
export function createWheelGesture(now: () => number = () => Date.now()) {
  let up = 0;
  let lastAt = -Infinity;
  return {
    /** scale：deltaMode 非 0 时把行/页单位换算成像素（行 ×16、页 ×视口高）。 */
    feed(deltaY: number, scale = 1): WheelAction {
      const t = now();
      if (t - lastAt > WHEEL_ACCUM_WINDOW_MS) up = 0;
      lastAt = t;
      const dy = deltaY * scale;
      if (dy < 0) {
        up += -dy;
        if (up >= WHEEL_LEAVE_THRESHOLD_PX) {
          up = 0;
          return "leave";
        }
        return "none";
      }
      if (dy > 0) up = 0;
      return "none";
    },
  };
}

export type FollowState = {
  /** 跟随中：内容/视口变化时补位，把尾端保持在视野内。 */
  pinned: boolean;
  /** 非跟随态的距底距离基准：收缩（折叠、完成重组）时据此原地保位。 */
  baseline: number;
  /** 上次观察到的内容高度（scrollHeight），用于区分增长与收缩。 */
  lastHeight: number;
};

export function initialFollowState(distance: number, height: number): FollowState {
  return { pinned: distance <= CHAT_TAIL_EPSILON, baseline: distance, lastHeight: height };
}

export type FollowEvent =
  /** 读者滚动（含拖滚动条、触摸滑动）：几何在这里唯一一次决定贴不贴底。 */
  | { kind: "user-scroll"; distance: number }
  /** 向上滚轮累计到阈值：脱离，不滚动。 */
  | { kind: "wheel-leave" }
  /** 内容或视口尺寸变化：贴底时补位，否则只在收缩时原地保位。 */
  | { kind: "resize"; distance: number; height: number }
  /** 命令式回底：回底按钮、发送、切会话。 */
  | { kind: "reach-bottom" }
  /** 布局刚被别的组件改写（展开/收起行自行锚定顶边）：只重算基准，绝不补位。 */
  | { kind: "settle"; distance: number; height: number };

/** 只允许两种程序化滚动：贴到真底、回到收缩前的位置。 */
export type FollowAction = "none" | "pin-bottom" | "restore-distance";

export type FollowResult = { state: FollowState; action: FollowAction };

const NO_ACTION: FollowResult = { state: { pinned: false, baseline: 0, lastHeight: 0 }, action: "none" };

export function nextFollowState(state: FollowState, event: FollowEvent): FollowResult {
  switch (event.kind) {
    case "user-scroll": {
      const pinned = event.distance <= CHAT_TAIL_EPSILON;
      return {
        state: { pinned, baseline: event.distance, lastHeight: state.lastHeight },
        action: "none",
      };
    }
    case "wheel-leave": {
      if (!state.pinned) return { state, action: "none" };
      return { state: { ...state, pinned: false, baseline: Math.max(state.baseline, CHAT_TAIL_EPSILON) }, action: "none" };
    }
    case "resize": {
      const shrank = event.height < state.lastHeight;
      if (state.pinned) {
        return { state: { pinned: true, baseline: 0, lastHeight: event.height }, action: "pin-bottom" };
      }
      // 收缩把读者往下推（浏览器钳制）时退回原距底距离：读者原地不动。
      if (shrank && event.distance < state.baseline) {
        return { state: { pinned: false, baseline: state.baseline, lastHeight: event.height }, action: "restore-distance" };
      }
      return { state: { pinned: false, baseline: event.distance, lastHeight: event.height }, action: "none" };
    }
    case "reach-bottom":
      return { state: { pinned: true, baseline: 0, lastHeight: state.lastHeight }, action: "pin-bottom" };
    case "settle": {
      // 几何只能否决跟随：折叠把尾端推出了视野就停止跟随，没推出去就继续跟。
      const pinned = event.distance <= CHAT_TAIL_EPSILON;
      return { state: { pinned, baseline: event.distance, lastHeight: event.height }, action: "none" };
    }
    default:
      return NO_ACTION;
  }
}
