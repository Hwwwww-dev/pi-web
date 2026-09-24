import type { CSSProperties } from "react";

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
    <span className={className ? `path-label ${className}` : "path-label"} style={style} title={title ?? text}>
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}
