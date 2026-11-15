"use client";

import { useSyncExternalStore } from "react";
import { getRehypeKatexVersion, subscribeRehypeKatexVersion } from "@/lib/markdown";

const noopSubscribe = () => () => {};

/**
 * KaTeX 延迟加载进度（lib/markdown.ts）：就绪时版本号递增，跑 rehype 管线的渲染块
 * 订阅它各重画一次，把按普通文本画出的公式换成 KaTeX。订阅必须挂在真正跑管线的
 * 组件上——外层 memo 拦不住 store 驱动的重画，也正要靠这一点。`enabled` 传"这份
 * markdown 可能含公式"的判断，不含公式的块不订阅，KaTeX 就绪不惊动它们。
 */
export function useRehypeKatexVersion(enabled: boolean): void {
  useSyncExternalStore(
    enabled ? subscribeRehypeKatexVersion : noopSubscribe,
    getRehypeKatexVersion,
    getRehypeKatexVersion,
  );
}
