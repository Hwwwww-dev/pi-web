"use client";

import type { CSSProperties } from "react";
import { parseUnifiedPatch } from "@/lib/patch";
import { useI18n } from "@/hooks/useI18n";
import { SOURCE_HIGHLIGHT_MAX_LINES } from "./SourceCodeView";

// Style objects on purpose: SourceCodeView feeds them to react-syntax-
// highlighter's customStyle/lineNumberStyle props (an inline-style API whose
// own theme styles can only be overridden in kind) and FileViewer's rows reuse
// them; classes cannot express that handoff. All values are token-based.
export const FILE_CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: "var(--font-mono-weight)",
  fontSize: 13,
  lineHeight: 1.6,
};

export const FILE_LINE_NUMBER_STYLE: CSSProperties = {
  width: 48,
  minWidth: 48,
  padding: "0 10px",
  textAlign: "right",
  color: "var(--text-dim)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
  fontFamily: "var(--font-mono)",
  fontWeight: "var(--font-mono-weight)",
  fontSize: 11,
  fontStyle: "normal",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "20.8px",
  userSelect: "none",
  flexShrink: 0,
  verticalAlign: "top",
};

// Only views of at most SOURCE_HIGHLIGHT_MAX_LINES rows pin it: a long plain
// fallback or huge diff scrolled with 50-67 ms frames while pinned, so those
// keep the plain gutter.
export const FILE_PINNED_LINE_NUMBER_STYLE: CSSProperties = {
  ...FILE_LINE_NUMBER_STYLE,
  position: "sticky",
  left: 0,
  zIndex: 1,
};

type DiffLine = {
  type: "unchanged" | "removed" | "added";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

function diffLines(patch: string): DiffLine[] {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];

  return files.flatMap((file) => file.rows.flatMap((row): DiffLine[] => {
    if (row.type === "hunk") return [];
    if (row.type === "gap") return [];
    if (row.left.type === "context" && row.right.type === "context") {
      return [{
        type: "unchanged",
        text: row.right.text,
        oldLineNo: row.left.lineNo,
        newLineNo: row.right.lineNo,
      }];
    }

    const lines: DiffLine[] = [];
    if (row.left.type === "removed") {
      lines.push({
        type: "removed",
        text: row.left.text,
        oldLineNo: row.left.lineNo,
        newLineNo: null,
      });
    }
    if (row.right.type === "added") {
      lines.push({
        type: "added",
        text: row.right.text,
        oldLineNo: null,
        newLineNo: row.right.lineNo,
      });
    }
    return lines;
  }));
}

export function DiffView({ patch, wrapLines = false }: { patch: string; wrapLines?: boolean }) {
  const { t } = useI18n();
  const diff = diffLines(patch);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div className="px-4 py-3 font-mono text-xs text-dim">
        {t("i18n.noChanges")}
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  const lineNumberStyle = diff.length <= SOURCE_HIGHLIGHT_MAX_LINES
    ? FILE_PINNED_LINE_NUMBER_STYLE
    : FILE_LINE_NUMBER_STYLE;
  return (
    <div
      // FILE_CODE_STYLE is the shared code typography (see its declaration);
      // the wrap width is this view's own.
      className={`file-diff-view min-w-full ${wrapLines ? "w-full" : "w-max"}`}
      style={FILE_CODE_STYLE}
    >
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              className="border-y border-border bg-card px-4 py-0.5 text-xs text-dim"
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          // Added/removed rows take the diff tokens (globals.css); unchanged
          // rows keep the view's background and a dim marker.
          const rowTone = line.type === "added"
            ? "bg-diff-add-bg border-l-diff-add text-diff-add"
            : line.type === "removed"
            ? "bg-diff-del-bg border-l-diff-del text-diff-del"
            : "border-l-transparent text-dim";

          return (
            <div
              key={li}
              className={`file-diff-line flex min-w-full border-l-[3px] ${rowTone}`}
            >
              <span style={lineNumberStyle}>
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span className="min-w-4 shrink-0 select-none px-1.5 font-semibold">
                {prefix}
              </span>
              <span
                className={`file-diff-line-content min-w-0 pr-2 text-foreground ${
                  wrapLines ? "shrink whitespace-pre-wrap [overflow-wrap:anywhere]" : "shrink-0 whitespace-pre"
                }`}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}
