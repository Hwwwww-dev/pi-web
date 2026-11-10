import type { CSSProperties } from "react";

// 批 4：globals 的 .path-label 规则迁入为本工具类集。
const PATH_LABEL_CLASS = "path-label block min-w-0 overflow-hidden text-left [direction:rtl] [text-overflow:ellipsis] whitespace-nowrap leading-[1.35]";

/**
 * Path label that ellipsizes on the LEFT, keeping the trailing segments — the
 * part that identifies the file — visible: "…orkspace/pi-web". Shows as much of
 * the path as fits instead of a fixed number of segments. The rtl container
 * moves the ellipsis to the left edge; the inner plaintext bidi isolation keeps
 * the path itself rendered strictly left-to-right (no punctuation reordering).
 * `title` defaults to the full text so the truncated end stays reachable.
 */
export function PathLabel({ text, title, className, style }: { text: string; title?: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={className ? `${PATH_LABEL_CLASS} ${className}` : PATH_LABEL_CLASS} style={style} title={title ?? text}>
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}
