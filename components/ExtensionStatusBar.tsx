"use client";

import { stripAnsi } from "@/lib/ansi";
import { isPermissiveStatusText } from "@/lib/extension-status";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";
import { Button } from "@/components/ui/button";

/**
 * `ctx.ui.setStatus("command:/mode toggle", "Build")` shows "Build" as a button
 * that sends `/mode toggle`. The command lives in the key because setStatus has
 * no room for it, and Pi's own footer prints only the text, so the same status
 * is still plain text there.
 */
export const EXTENSION_STATUS_COMMAND_PREFIX = "command:";

/** The slash command a status key asks for, or null for an ordinary status. */
export function extensionStatusCommand(key: string): string | null {
  if (!key.startsWith(EXTENSION_STATUS_COMMAND_PREFIX)) return null;
  const command = key.slice(EXTENSION_STATUS_COMMAND_PREFIX.length).trim();
  return command.length > 1 && command.startsWith("/") ? command : null;
}

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

function sortedStatuses(statuses: ExtensionStatusItem[]): ExtensionStatusItem[] {
  return [...statuses].sort((a, b) => a.key.localeCompare(b.key));
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return sortedStatuses(statuses)
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

type StatusCell =
  | { kind: "text"; text: string }
  | { kind: "command"; command: string; label: string };

/** One cell per status, in key order. A status with nothing visible to show has no cell. */
export function buildExtensionStatusCells(statuses: ExtensionStatusItem[]): StatusCell[] {
  const cells: StatusCell[] = [];
  for (const item of sortedStatuses(statuses)) {
    const text = sanitizeExtensionStatusText(item.text);
    const command = extensionStatusCommand(item.key);
    if (command) {
      const label = stripAnsi(text).replace(/\s+/g, " ").trim();
      cells.push({ kind: "command", command, label: label || command });
    } else if (stripAnsi(text).trim()) {
      cells.push({ kind: "text", text });
    }
  }
  return cells;
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
  onCommand,
  commandsDisabled = false,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  /** Sends the command of a `command:` status; without it those buttons stay disabled. */
  onCommand?: (command: string) => void;
  commandsDisabled?: boolean;
}) {
  const cells = buildExtensionStatusCells(statuses);
  if (cells.length === 0 && widgets.length === 0) return null;

  const plainStatusLine = cells
    .map((cell) => (cell.kind === "text" ? stripAnsi(cell.text) : cell.label))
    .join(" ");

  const statusLine = cells.length > 0 ? (
    <div
      role="status"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pl-0.5 pr-1.5 scrollbar-none"
      aria-label={plainStatusLine}
      title={plainStatusLine}
    >
      {cells.map((cell, index) => {
        // The permissive marker ("yolo", pi-permission-system) renders as bare
        // red text here — no capsule — and this row is its only surface; the
        // composer's own pill row no longer repeats it.
        const permissive = cell.kind === "text" && isPermissiveStatusText(cell.text);
        return cell.kind === "text" ? (
        <span
          key={index}
          className={permissive
            ? "inline-flex max-w-full items-center whitespace-pre font-mono text-[10px] font-semibold tracking-[0.6px] text-destructive"
            : "inline-flex max-w-full items-center whitespace-pre rounded-md bg-muted/60 px-2 py-1 font-mono text-[11.5px] leading-4 text-muted-foreground"}
        >
          {permissive ? stripAnsi(cell.text).toUpperCase() : <AnsiText text={cell.text} />}
        </span>
      ) : (
        <Button
          key={index}
          type="button"
          variant="ghost"
          size="xs"
          disabled={!onCommand || commandsDisabled}
          title={`${cell.label} · ${cell.command}`}
          aria-label={`${cell.label} (${cell.command})`}
          onClick={() => onCommand?.(cell.command)}
          className="shrink-0 bg-muted/60 px-2 font-mono text-[11.5px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {cell.label}
        </Button>
        );
      })}
    </div>
  ) : null;

  return (
    // `extension-status-bar` is a layout hook (the keyboard-open CSS and the
    // mobile shell target it); the styling itself is shadcn utilities on the
    // row's pills. `relative` anchors
    // an expanded widget's floating panel above the row. 内缩量 = composer 外壳
    // （chat-input-shell 的 px-7/max-sm:px-2.5，本行是它的兄弟节点吃不到）+
    // 24px——卡片圆角 rounded-[24px] 的半径：行端对齐圆角弧线的终点（切点），
    // 而不是卡片最外沿，否则视觉上仍从圆角末端超出去。
    <div className="extension-status-bar relative -mt-3 mx-auto flex w-full min-w-0 max-w-[min(var(--chat-content-max-width,820px),700px)] shrink-0 items-stretch px-[52px] max-sm:px-[34px] pt-1 pb-1">
      {widgets.length > 0 ? <ExtensionWidgets widgets={widgets}>{statusLine}</ExtensionWidgets> : statusLine}
    </div>
  );
}
