/**
 * Which turns of a long transcript are actually in the DOM.
 *
 * A session with a thousand turns renders a thousand markdown trees; the
 * browser then lays out and paints all of them on every streamed chunk. The
 * window keeps only the turns near the viewport mounted, and two spacers stand
 * in for the rest so the scrollbar keeps its length and the reader's position
 * never moves.
 *
 * Heights are measured once per rendered turn and cached: a turn that scrolls
 * out keeps its real height, and only a never-seen turn falls back to the
 * estimate (the measured average, so the estimate improves as the reader moves).
 */

/** A turn never rendered yet starts here. */
export const TURN_ESTIMATE_HEIGHT = 220;
/** Screens of turns kept mounted above and below the viewport. */
export const TURN_WINDOW_OVERSCAN_SCREENS = 1.2;
/** Below this many rendered turns the window is pointless — render them all. */
export const TURN_WINDOW_MIN_TURNS = 80;

export interface TurnWindow {
  /** First mounted index, inclusive. */
  start: number;
  /** Last mounted index, exclusive. */
  end: number;
  /** Height standing in for the turns before `start`. */
  topHeight: number;
  /** Height standing in for the turns after `end`. */
  bottomHeight: number;
}

/** Prefix sums of the turn heights: `offsets[i]` is where turn `i` starts. */
export function turnOffsets(heights: readonly (number | undefined)[], estimate: number): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) {
    const height = heights[i];
    offsets[i + 1] = offsets[i] + (height !== undefined && height > 0 ? height : estimate);
  }
  return offsets;
}

/**
 * The window for a viewport given in the same coordinate space as the offsets:
 * `viewportTop` is the viewport's top edge measured from turn 0's top.
 */
export function computeTurnWindow(
  heights: readonly (number | undefined)[],
  estimate: number,
  viewportTop: number,
  viewportHeight: number,
  overscanScreens = TURN_WINDOW_OVERSCAN_SCREENS,
): TurnWindow {
  const total = heights.length;
  if (total === 0) return { start: 0, end: 0, topHeight: 0, bottomHeight: 0 };
  const offsets = turnOffsets(heights, estimate);
  const overscan = Math.max(0, viewportHeight * overscanScreens);
  const top = viewportTop - overscan;
  const bottom = viewportTop + viewportHeight + overscan;

  let start = 0;
  while (start < total - 1 && offsets[start + 1] <= top) start++;
  let end = start + 1;
  while (end < total && offsets[end] < bottom) end++;

  return {
    start,
    end,
    topHeight: offsets[start],
    bottomHeight: offsets[total] - offsets[end],
  };
}

/** The measured average, used for turns that have not been rendered yet. */
export function averageTurnHeight(heights: readonly (number | undefined)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const height of heights) {
    if (height !== undefined && height > 0) {
      sum += height;
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}
