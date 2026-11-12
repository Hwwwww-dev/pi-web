"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import {
  diffGapLabel,
  type SplitDiffCell,
  type SplitDiffFile,
  type SplitDiffGap,
  type SplitDiffRow,
} from "@/lib/patch";

export type PatchDiffLayout = "split" | "stacked";

type LineVariant = "default" | "added" | "removed" | "highlighted";

type DiffEntry =
  | { key: string; gap: SplitDiffGap }
  | { key: string; row: Extract<SplitDiffRow, { type: "line" }> };

/** 行号列只占它实际需要的位数：固定宽度会让一位数右边空出一大截。 */
const GUTTER_WIDTHS = ["w-[2ch]", "w-[3ch]", "w-[4ch]", "w-[5ch]", "w-[6ch]"];

function gutterWidthClass(maxLineNo: number): string {
  const digits = Math.max(2, String(Math.max(1, maxLineNo)).length);
  return GUTTER_WIDTHS[Math.min(GUTTER_WIDTHS.length - 1, digits - 2)] ?? "w-[2ch]";
}

/** The largest line number a file's rows show, which decides the gutter width. */
function fileMaxLineNo(file: SplitDiffFile): number {
  let max = 1;
  for (const row of file.rows) {
    if (row.type !== "line") continue;
    for (const cell of [row.left, row.right]) {
      if (cell.lineNo !== null && cell.lineNo > max) max = cell.lineNo;
    }
  }
  return max;
}

function cellVariant(cell: SplitDiffCell | null): LineVariant {
  if (cell === null || cell.type === "empty") return "default";
  if (cell.type === "added") return "added";
  if (cell.type === "removed") return "removed";
  return "default";
}

/**
 * A patch's own line: the number in a gutter sized to the file's largest line,
 * then the text with the official code-block line variant doing the +/- marker
 * and the tint. Nothing here has its own colors.
 */
function DiffLine({ cell, maxLineNo, muted = false }: {
  cell: SplitDiffCell | null;
  maxLineNo: number;
  muted?: boolean;
}) {
  const lineNo = cell?.lineNo ?? null;
  return (
    <CodeBlockLine
      variant={cellVariant(cell)}
      className={cn(
        "ps-5",
        // 官方 added 变体是中性底色；增删需要能一眼分辨，所以覆盖成 success/10。
        cell?.type === "added" && "bg-success/10",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "me-3 inline-block shrink-0 select-none text-end tabular-nums text-muted-foreground",
          gutterWidthClass(maxLineNo),
        )}
      >
        {lineNo ?? ""}
      </span>
      <span className={cn("whitespace-pre", cell === null && "opacity-0", muted && "text-muted-foreground")}>
        {cell?.text || "\u00a0"}
      </span>
    </CodeBlockLine>
  );
}

function GapLine({ gap }: { gap: SplitDiffGap }) {
  const { t } = useI18n();
  return (
    <CodeBlockLine variant="highlighted" className="ps-5 text-muted-foreground">
      {gap.count === null ? "⋯" : `⋯ ${diffGapLabel(gap.count, t)}`}
    </CodeBlockLine>
  );
}

/** The file a stacked section is named for: the new path, the one that survives, unless the file was deleted. */
function stackedFilePath(file: SplitDiffFile): string {
  if (file.newPath && file.newPath !== "/dev/null") return file.newPath;
  return file.oldPath || file.newPath || "";
}

function DiffHeader({ title }: { title: string }) {
  return (
    <CodeBlockHeader>
      <CodeBlockTitle className="truncate font-mono text-xs font-normal">{title}</CodeBlockTitle>
    </CodeBlockHeader>
  );
}

/**
 * The patch as the viewport can show it. Two columns need two code columns side
 * by side, which a phone does not have: there the same rows read as one column
 * — a removed line above the line that replaces it, each with its own number.
 * Both layouts are the same official `CodeBlock`; only the column count differs.
 */
export function PatchDiffFiles({ files, layout }: { files: SplitDiffFile[]; layout: PatchDiffLayout }) {
  const showFileHeaders = files.length > 1;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {files.map((file, fileIndex) => {
        const maxLineNo = fileMaxLineNo(file);
        const lines = file.rows.flatMap<DiffEntry>((row, rowIndex) => {
          if (row.type === "hunk") return [];
          if (row.type === "gap") return [{ key: `g${rowIndex}`, gap: row }];
          return [{ key: `r${rowIndex}`, row }];
        });

        return (
          <CodeBlock key={fileIndex} size="sm" data-diff-layout={layout}>
            {showFileHeaders && layout === "stacked" && stackedFilePath(file) && (
              <DiffHeader title={stackedFilePath(file)} />
            )}
            {layout === "split" ? (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <CodeBlockContent wrap={false} className="pr-0 group-data-[size=sm]/code-block:pr-0">
                  {showFileHeaders && <DiffHeader title={file.oldPath || "/dev/null"} />}
                  {lines.map((entry) => (
                    "gap" in entry
                      ? <GapLine key={entry.key} gap={entry.gap} />
                      : <DiffLine key={entry.key} cell={entry.row.left} maxLineNo={maxLineNo} />
                  ))}
                </CodeBlockContent>
                <CodeBlockContent
                  wrap={false}
                  className="border-s border-border/60 pl-0 group-data-[size=sm]/code-block:pl-0"
                >
                  {showFileHeaders && <DiffHeader title={file.newPath || "/dev/null"} />}
                  {lines.map((entry) => (
                    "gap" in entry
                      ? <GapLine key={entry.key} gap={entry.gap} />
                      : <DiffLine key={entry.key} cell={entry.row.right} maxLineNo={maxLineNo} />
                  ))}
                </CodeBlockContent>
              </div>
            ) : (
              <CodeBlockContent wrap={false}>
                {lines.map((entry) => (
                  "gap" in entry
                    ? <GapLine key={entry.key} gap={entry.gap} />
                    : (
                      <DiffLine
                        key={entry.key}
                        maxLineNo={maxLineNo}
                        cell={{
                          // One gutter, so a removed line keeps the old number and everything else the new one.
                          lineNo: entry.row.right.type === "removed" ? entry.row.left.lineNo : entry.row.right.lineNo,
                          text: entry.row.right.type === "removed" ? entry.row.left.text : entry.row.right.text,
                          type: entry.row.right.type === "removed" ? "removed" : entry.row.right.type,
                        }}
                      />
                    )
                ))}
              </CodeBlockContent>
            )}
          </CodeBlock>
        );
      })}
    </div>
  );
}
