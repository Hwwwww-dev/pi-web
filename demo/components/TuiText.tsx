"use client";

import type { CSSProperties } from "react";

/** Terminal text rendered at its own width: never reflowed, scrolled instead. */
export function TuiText({ text, className, style, tabIndex }: {
  text: string;
  className?: string;
  style?: CSSProperties;
  tabIndex?: number;
}) {
  return (
    <pre tabIndex={tabIndex} className={className ? `tui-text ${className}` : "tui-text"} style={style}>
      {text}
    </pre>
  );
}
