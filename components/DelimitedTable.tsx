"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { measureColumnWidths, parseDelimitedTable, visibleRowRange } from "@/lib/delimited-table";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 26;
const GUTTER_WIDTH = 56;
const OVERSCAN_ROWS = 20;

const ROW_CLASSES = "flex h-[26px] border-b border-border";

// The source view's line-number gutter, kept beside the columns while they
// scroll sideways. Opaque (bg-card), or cells would show through it.
const GUTTER_CLASSES =
  "sticky left-0 z-[1] flex w-14 shrink-0 select-none items-center justify-end border-r border-border bg-card px-2.5 text-xs text-muted-foreground tabular-nums";

const CELL_CLASSES = "shrink-0 truncate border-r border-border px-2.5 leading-[25px]"; /* leading = ROW_HEIGHT - 1 */

/**
 * A `.csv` / `.tsv` file as a table: the first record is a sticky header, the
 * gutter shows the file line each record starts on. Rows have one fixed
 * height and only those around the viewport are rendered, so a large file
 * scrolls without a DOM per row. The viewer's own content box scrolls (its
 * position is saved and restored like the source view's); `scrollRef` is it.
 * `complete: false` means `content` is a loaded prefix of the file, whose cut
 * last record is left out.
 */
export function DelimitedTable({
  content,
  filePath,
  complete,
  scrollRef,
}: {
  content: string;
  filePath: string;
  complete: boolean;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const table = useMemo(() => parseDelimitedTable(content, filePath, complete), [complete, content, filePath]);
  const widths = useMemo(() => measureColumnWidths(table.columns, table.rows), [table]);
  const totalWidth = useMemo(() => widths.reduce((sum, width) => sum + width, GUTTER_WIDTH), [widths]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // A passive effect: the scroll box's ref is attached only after this
  // component's layout effects have run.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame: number | null = null;
    const sync = () => {
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
    };
    const handleScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    sync();
    element.addEventListener("scroll", handleScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  if (table.columns.length === 0) return null;

  // The header row sits above the first body row.
  const { start, end } = visibleRowRange(
    table.rows.length,
    ROW_HEIGHT,
    scrollTop - ROW_HEIGHT,
    viewportHeight,
    OVERSCAN_ROWS,
  );
  const rows = [];
  for (let index = start; index < end; index += 1) {
    const row = table.rows[index];
    rows.push(
      <div
        key={index}
        role="row"
        aria-rowindex={index + 2}
        className={cn(ROW_CLASSES, "absolute left-0")}
        style={{ top: index * ROW_HEIGHT, width: totalWidth }} /* 虚拟化行位与总列宽为测量/计算值 */
      >
        <div role="rowheader" className={GUTTER_CLASSES}>{table.rowLines[index]}</div>
        {widths.map((width, cellIndex) => {
          const value = row[cellIndex] ?? "";
          return (
            <div key={cellIndex} role="cell" className={CELL_CLASSES} style={{ width }} /* 列宽为实测值 */ title={value || undefined}>
              {value}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div
      role="table"
      aria-rowcount={table.rows.length + 1}
      aria-colcount={table.columns.length}
      className="min-w-full bg-background font-mono text-xs text-muted-foreground"
      style={{ width: totalWidth, fontWeight: "var(--font-mono-weight)" }} /* 总列宽为测量值；字重来自主题 mono 变量 */
    >
      <div
        role="row"
        aria-rowindex={1}
        className={cn(ROW_CLASSES, "sticky top-0 z-[2] bg-card font-semibold text-foreground")}
        style={{ width: totalWidth }} /* 总列宽为测量值 */
      >
        <div role="rowheader" className={GUTTER_CLASSES}>{table.headerLine}</div>
        {table.columns.map((column, index) => (
          <div key={index} role="columnheader" className={CELL_CLASSES} style={{ width: widths[index] }} /* 列宽为实测值 */ title={column || undefined}>
            {column}
          </div>
        ))}
      </div>
      <div className="relative" style={{ height: table.rows.length * ROW_HEIGHT }} /* 虚拟化总高为计算值 */>
        {rows}
      </div>
    </div>
  );
}
