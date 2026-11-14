"use client";

import { useLayoutEffect, useState } from "react";
import type { StreamingState, StreamingStore } from "@/lib/streaming-message";
import type { AssistantContentBlock } from "@/lib/types";

/**
 * One value of the streaming store; the component re-renders only when that
 * value changes. `select` must be stable (a module-level function).
 *
 * A plain state update rather than useSyncExternalStore: that one renders every
 * chunk on its own, while state updates let React batch the chunks that land
 * before it renders, and each render parses the reply's last block again.
 */
export function useStreamingSelector<T>(store: StreamingStore, select: (state: StreamingState) => T): T {
  const [value, setValue] = useState(() => select(store.getState()));
  useLayoutEffect(() => {
    const update = () => setValue(select(store.getState()));
    // A chunk may have landed between this render and the subscription.
    update();
    return store.subscribe(update);
  }, [store, select]);
  return value;
}

export const selectIsStreaming = (state: StreamingState) => state.isStreaming;

/** 流式回复这一帧是否真有东西画出来：`text_start` 会先物化 `{ type: "text", text: "" }`
 * 再等第一个 delta，而 `isEmptyTextBlock` 在流式期把空文本块滤掉，`MessageView`
 * 于是渲染一个空盒子。按块数判断会让阶段提示（「正在等待模型…」）在这个空帧里
 * 就被撤掉，占位行连同它的高度一起塌掉——首个 token 到达前列表整体下移、到达后
 * 再弹回，正是用户看到的那次位置调整（`/\S/` 命中即停，长回复不逐 chunk 扫全文）。
 * 空 thinking 块例外：它是流式期的「思考」活跃行，看得见；toolCall 一律可见。 */
export const selectHasStreamingContent = (state: StreamingState) =>
  (state.streamingMessage?.content ?? []).some(isVisibleStreamingBlock);

function isVisibleStreamingBlock(block: AssistantContentBlock): boolean {
  return block.type !== "text" || /\S/.test(block.text);
}
export const selectStreamingMessage = (state: StreamingState) => state.streamingMessage;
