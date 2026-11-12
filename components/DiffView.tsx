"use client";

import type { CSSProperties } from "react";
import { parseUnifiedPatch } from "@/lib/patch";
import { cn } from "@/lib/utils";
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
  color: "var(--muted-foreground)",
  
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
      <div className="px-3 py-3 font-mono text-xs text-muted-foreground">
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
          // Collapsed hunks take the CodeBlock highlighted row: muted band,
          // sans-serif note, no gutter columns of its own.
          return (
            <span
              key={si}
              data-slot="code-block-line"
              className="-mx-4 px-4 group-data-[size=sm]/code-block:-mx-3 group-data-[size=sm]/code-block:px-3 bg-foreground/5 flex min-w-full items-center py-0.5 font-sans text-xs text-muted-foreground after:content-none"
            >
              <span aria-hidden="true" className="min-w-4 shrink-0 select-none px-1.5">⋯</span>
              <span className="shrink-0 px-1.5">{seg.count} unchanged lines</span>
            </span>
          );
        }
        const lines = seg.lines.map((line, li) => {
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          // The rows are the official CodeBlock line variants (vendored nova
          // classes); the +/- marker stays an aligned column instead of the
          // variant's absolute ::after so wrapped text keeps clearing it, and
          // content-none drops that second marker.
          // 增删行用官方 token 上色：新增走 --ok，删除走 destructive。
          const rowTone = line.type === "added"
            ? "bg-(--ok)/10"
            : line.type === "removed"
            ? "bg-destructive/10"
            : "";

          return (
            <span
              key={li}
              data-slot="code-block-line"
              className={`-mx-4 px-4 group-data-[size=sm]/code-block:-mx-3 group-data-[size=sm]/code-block:px-3 file-diff-line flex min-w-full after:content-none ${rowTone}`}
            >
              <span style={lineNumberStyle}>
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span
                className={cn(
                  "min-w-4 shrink-0 select-none px-1.5 font-semibold",
                  line.type === "added" && "text-(--ok)",
                  line.type === "removed" && "text-destructive",
                )}
              >
                {prefix}
              </span>
              <span
                className={`file-diff-line-content min-w-0 pr-3 text-foreground ${
                  wrapLines ? "shrink whitespace-pre-wrap [overflow-wrap:anywhere]" : "shrink-0 whitespace-pre"
                }`}
              >
                {line.text || "\u00a0"}
              </span>
            </span>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}
