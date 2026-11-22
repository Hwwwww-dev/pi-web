"use client";

import { useSyncExternalStore } from "react";

/**
 * 会话读取记录：最近若干次会话文件读取的客户端留痕。
 *
 * 用途：在移动端（PWA）没有开发者工具，无法查看 Network；当列表出现意外增多的
 * 旧消息时，需要判断是哪一次读取带回来的。这里只记录时间、读取类型、请求参数
 * 与返回条目数，不保存消息内容。
 */

export type SessionReadKind = "window" | "since" | "probe" | "older";

export interface SessionReadEntry {
  at: number;
  kind: SessionReadKind;
  sessionId: string;
  /** 请求参数或结果摘要，用于在面板上辨别读取来源。 */
  detail: string;
  /** 返回的条目数；探针类读取没有该值。 */
  count?: number;
}

const MAX_ENTRIES = 20;

let entries: SessionReadEntry[] = [];
const listeners = new Set<() => void>();

/** 记录一次读取。新记录在前，最多保留 `MAX_ENTRIES` 条。 */
export function recordSessionRead(entry: SessionReadEntry): void {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  for (const listener of listeners) listener();
}

export function sessionReadLogSnapshot(): SessionReadEntry[] {
  return entries;
}

export function subscribeSessionReadLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 清空记录（面板上的“清空”按钮使用）。 */
export function clearSessionReadLog(): void {
  entries = [];
  for (const listener of listeners) listener();
}

export function useSessionReadLog(): SessionReadEntry[] {
  return useSyncExternalStore(subscribeSessionReadLog, sessionReadLogSnapshot, sessionReadLogSnapshot);
}
