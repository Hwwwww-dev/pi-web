"use client";

import type { CSSProperties } from "react";
import { CodeBlockLine } from "@/components/ui/code-block";
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

/** 行号列的宽度跟着位数走：固定 48px 让「2」「6」这种一位数右边空出一大截（用户报的“行号太空”）。 */
const LINE_NUMBER_BASE: CSSProperties = {
  padding: "0 8px",
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

/** Gutter width for a view whose largest line number is `lineCount`. */
export function lineNumberGutter(lineCount: number, pinned = false): CSSProperties {
  const digits = Math.max(2, String(Math.max(1, Math.floor(lineCount))).length);
  // 宽度 = 数字宽度 + 左右 padding + 余量。写成 width 而不是 minWidth 时，
  // border-box 把 8px+8px 的 padding 算在那点宽度里，四位数直接把字挤到
  // gutter 外面，+/− 标记就贴在行号后面了。
  const width = `calc(${digits}ch + 22px)`;
  return {
    ...LINE_NUMBER_BASE,
    boxSizing: "border-box",
    minWidth: width,
    // Only views of at most SOURCE_HIGHLIGHT_MAX_LINES rows pin it: a long plain
    // fallback or huge diff scrolled with 50-67 ms frames while pinned, so those
    // keep the plain gutter.
    ...(pinned ? { position: "sticky" as const, left: 0, zIndex: 1 } : {}),
  };
}

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
    ? lineNumberGutter(diff.length, true)
    : lineNumberGutter(diff.length);
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
            <CodeBlockLine
              key={si}
              variant="highlighted"
              className="flex min-w-full items-center py-0.5 font-sans text-xs text-muted-foreground after:content-none"
            >
              <span aria-hidden="true" className="min-w-4 shrink-0 select-none px-1.5">⋯</span>
              <span className="shrink-0 px-1.5">{seg.count} unchanged lines</span>
            </CodeBlockLine>
          );
        }
        const lines = seg.lines.map((line, li) => {
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          // 增删行用官方 code-block 的行变体：底色与 +/- 标记由变体给，这里只摆行号与内容。
          return (
            <CodeBlockLine
              key={li}
              variant={line.type === "added" ? "added" : line.type === "removed" ? "removed" : "default"}
              className="file-diff-line flex min-w-full"
            >
              <span style={lineNumberStyle}>
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span
                className={cn(
                  "min-w-4 shrink-0 select-none px-1.5 font-semibold",
                  line.type === "added" && "text-success",
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
            </CodeBlockLine>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}
