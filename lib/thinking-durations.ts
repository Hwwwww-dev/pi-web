/**
 * 思考行的实测时长（秒），按「消息渲染键 + 块序号」存放。
 *
 * 同一条回复会被渲染两三次：流式气泡 → message_end 后进入列表 → 回合结束由会话
 * 文件读出。每一跳都是一棵新子树，组件内的测量 state 全部归零。重挂载后若改读
 * 整条回复的 `durationMs`，同一个位置上的数字就会从「这一段思考的时长」变成
 * 「整条回复的时长」（读者看到 3s 闪一下变 5s）。
 *
 * 消息渲染键（`lib/message-keys.ts`）跨这几跳保持不变，所以用它在模块级接住测量
 * 值：重挂载后读回同一个数。拿不到时（首次读文件、换页面后刷新）调用方仍回落到
 * `durationMs`。
 */
const measured = new Map<string, number>();
const MAX_MEASURED_DURATIONS = 500;

/** `undefined` 表示这条消息没有稳定的渲染键（如待执行的 bash 行），不参与测量。 */
export function thinkingDurationKey(messageKey: string | undefined, blockIndex: number): string | undefined {
  return messageKey === undefined ? undefined : `${messageKey}:${blockIndex}`;
}

export function recordThinkingDuration(key: string | undefined, seconds: number): void {
  if (key === undefined) return;
  // 重新测量（同一块被再跑一次）以最新值为准，但保持在插入序末尾以便淘汰旧的。
  measured.delete(key);
  measured.set(key, seconds);
  if (measured.size > MAX_MEASURED_DURATIONS) {
    const oldest = measured.keys().next().value;
    if (oldest !== undefined) measured.delete(oldest);
  }
}

export function measuredThinkingDuration(key: string | undefined): number | undefined {
  return key === undefined ? undefined : measured.get(key);
}
