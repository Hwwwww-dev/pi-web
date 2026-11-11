"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import {
  diffGapLabel,
  unifiedDiffLines,
  type SplitDiffCell,
  type SplitDiffFile,
  type SplitDiffGap,
  type UnifiedDiffLine,
} from "@/lib/patch";

export type PatchDiffLayout = "split" | "stacked";

/**
 * The patch as the viewport can show it. Two columns need two code columns side
 * by side, which a phone does not have: there the same rows read as one column
 * — a removed line above the line that replaces it, each with its own number.
 */
export function PatchDiffFiles({ files, layout }: { files: SplitDiffFile[]; layout: PatchDiffLayout }) {
  const { t } = useI18n();
  const showFileHeaders = files.length > 1;

  return (
    <div className="max-h-[var(--card-max-height)] overflow-x-hidden overflow-y-auto bg-background">
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          className={cn(
            "min-w-0 font-mono text-[length:calc(12px+var(--chat-font-size-offset,0px))] leading-[1.55]",
            fileIndex > 0 && "border-t border-border",
          )}
        >
          {showFileHeaders && layout === "split" && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border bg-muted">
              <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
              <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
            </div>
          )}

          {showFileHeaders && layout === "stacked" && stackedFilePath(file) && (
            <div
              title={stackedFilePath(file)}
              className="truncate border-b border-border bg-muted px-2.5 py-[5px] text-muted-foreground"
            >
              {stackedFilePath(file)}
            </div>
          )}

          {layout === "split" && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {file.rows.map((row, rowIndex) => {
                if (row.type === "hunk") {
                  return null;
                }
                if (row.type === "gap") {
                  return <DiffGapRow key={rowIndex} gap={row} />;
                }

                return (
                  <div key={rowIndex} className="contents">
                    <SplitDiffCellView cell={row.left} side="left" />
                    <SplitDiffCellView cell={row.right} side="right" />
                  </div>
                );
              })}
            </div>
          )}

          {layout === "stacked" && unifiedDiffLines(file).map((line, lineIndex) => (
            line.type === "gap"
              ? <DiffGapRow key={lineIndex} gap={line} />
              : <StackedDiffLineView key={lineIndex} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Unchanged lines the patch leaves out between two hunks, across the whole width. */
function DiffGapRow({ gap }: { gap: SplitDiffGap }) {
  const { t } = useI18n();
  return (
    <div className="col-span-full select-none border-y border-border bg-muted px-2.5 text-muted-foreground">
      {gap.count === null ? "⋯" : `⋯ ${diffGapLabel(gap.count, t)}`}
    </div>
  );
}

/** The file a stacked section is named for: the new path, the one that survives, unless the file was deleted. */
function stackedFilePath(file: SplitDiffFile): string {
  if (file.newPath && file.newPath !== "/dev/null") return file.newPath;
  return file.oldPath || file.newPath || "";
}

function StackedDiffLineView({ line }: { line: UnifiedDiffLine }) {
  return (
    <SplitDiffCellView
      side="right"
      cell={{
        // One gutter, so a removed line keeps the old number and everything else the new one.
        lineNo: line.type === "removed" ? line.oldLineNo : line.newLineNo,
        text: line.text,
        type: line.type,
      }}
    />
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      className={cn("truncate px-2.5 py-[5px] text-muted-foreground", side === "left" && "border-r border-border")}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const marker = cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  return (
    <div
      className={cn(
        "flex min-w-0",
        cell.type === "added" ? "bg-diff-add-bg" : cell.type === "removed" ? "bg-diff-del-bg" : cell.type === "empty" && "bg-muted",
        side === "left" && "border-r border-border",
      )}
    >
      <span className="w-[42px] shrink-0 select-none border-r border-border bg-card px-1.5 text-right text-muted-foreground">
        {cell.lineNo ?? ""}
      </span>
      <span
        className={cn(
          "w-[18px] shrink-0 select-none px-[5px]",
          cell.type === "added" ? "font-bold text-diff-add" : cell.type === "removed" ? "font-bold text-diff-del" : "font-normal text-muted-foreground",
        )}
      >
        {marker}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 pr-2.5 whitespace-pre-wrap wrap-anywhere",
          cell.type === "empty" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}
