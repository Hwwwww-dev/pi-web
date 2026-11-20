/**
 * A tool's run time, in the one format the transcript shows everywhere.
 */

/** A tool's run time as the pi CLI's "Took" writes it: 2.4s, then 3m 5s, then 1h 2m 5s. */
export function formatToolDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/**
 * 行上显示的耗时。任何实际耗时都显示（读者要看「这一下有多快」），
 * 只有拿不到时长的行才没有这一项（调用方传 `undefined`）。
 */
export function formatToolDurationIfShown(ms: number): string | null {
  return Number.isFinite(ms) ? formatToolDuration(ms) : null;
}
