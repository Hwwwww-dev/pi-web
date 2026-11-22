"use client";

import { cn } from "@/lib/utils";

/** How many characters of the end stay visible, extension included. */
const MIN_TAIL_CHARS = 10;

/**
 * Where a name loses its middle instead of its end.
 *
 * A file pill shrunk by CSS `truncate` gives `foo.co…`: the extension, the one
 * part that says what the file is, goes first. This keeps the whole tail (the
 * extension plus the last path segment's end) and cuts the front, which reads
 * the same for CJK names — unlike the `direction: rtl` trick, it does not
 * reverse punctuation.
 *
 * 纯 CSS：拆成「可省略的头部 + 钉住的尾部」，头部让 flex 布局去截断。以前用
 * canvas 量宽度再换成中间省略的字符串，是自激振荡的源头（2026-11-22 用户：
 * 文件名在疯狂闪烁）：换短串 → 胶囊变窄 → 可用宽度变大 → 算出更长串 → 再变宽；
 * 同行时长文字（`0.1s` → `29s`）每 100ms 变一点又添一层抖动。不测量就没有环。
 */
export function MiddleEllipsis({ text, className }: { text: string; className?: string }) {
  const extension = /\.[^./\\]{1,8}$/.exec(text)?.[0] ?? "";
  const tailLength = Math.min(text.length, Math.max(extension.length + 8, MIN_TAIL_CHARS));
  // 短名整串放得下：交给普通末尾省略，别多画一个永远不会出现省略号的结构。
  if (tailLength >= text.length) {
    return <span className={cn("block min-w-0 truncate", className)}>{text}</span>;
  }
  const head = text.slice(0, text.length - tailLength);
  const tail = text.slice(-tailLength);
  return (
    <span className={cn("flex min-w-0", className)}>
      {/* 头部可压缩：空间不足时由 CSS 在头部末尾画省略号（`foo…bar.ts`）。 */}
      <span className="min-w-0 truncate">{head}</span>
      {/* 尾部（扩展名 + 若干字符）钉住不动，窄到极限时靠胶囊的 overflow 裁掉。 */}
      <span className="shrink-0">{tail}</span>
    </span>
  );
}
