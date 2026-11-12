"use client";

import { stripAnsi } from "@/lib/ansi";
import { isPermissiveStatusText } from "@/lib/extension-status";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  | { kind: "list"; label: string; title: string; items: string[] }
  | { kind: "command"; command: string; label: string };

/** The permissive marker is pinned to the row's right edge instead of scrolling. */
function isPermissiveCell(cell: StatusCell): boolean {
  return cell.kind === "text" && isPermissiveStatusText(cell.text);
}

/**
 * A status that lists things after a colon — `LSP Active: typescript, css, …`
 * — claims the whole row and pushes every other status out of view. It becomes
 * a chip named after the first word of its heading (`LSP`), and its popover
 * lists the entries one per line. Short text, or text without a colon and at
 * least two entries, stays a plain pill.
 */
export function splitStatusList(text: string): { label: string; title: string; items: string[] } | null {
  const plain = stripAnsi(text).replace(/\s+/g, " ").trim();
  if (plain.length < 24) return null;
  const colon = plain.indexOf(":");
  if (colon <= 0) return null;
  const head = plain.slice(0, colon).trim();
  const items = plain
    .slice(colon + 1)
    .split(/\s*[,·]\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const firstWord = head.split(/\s+/)[0];
  if (!firstWord || items.length < 2) return null;
  return { label: firstWord, title: head, items };
}

/** One cell per status, in key order. A status with nothing visible to show has no cell. */
export function buildExtensionStatusCells(statuses: ExtensionStatusItem[]): StatusCell[] {
  const cells: StatusCell[] = [];
  for (const item of sortedStatuses(statuses)) {
    const text = sanitizeExtensionStatusText(item.text);
    const command = extensionStatusCommand(item.key);
    if (command) {
      const label = stripAnsi(text).replace(/\s+/g, " ").trim();
      cells.push({ kind: "command", command, label: label || command });
      continue;
    }
    if (!stripAnsi(text).trim()) continue;
    const list = splitStatusList(text);
    if (list) {
      cells.push({ kind: "list", ...list });
      continue;
    }
    // A status that only names itself plus "Inactive" reports nothing to act on:
    // the name alone is the whole message, and the extra word made the row
    // carry a state nobody could change from there.
    const plainText = stripAnsi(text).replace(/\s+/g, " ").trim();
    const named = plainText.replace(/\s+(?:inactive|disabled)\s*$/i, "");
    cells.push({ kind: "text", text: named && named !== plainText ? named : text });
  }
  return cells;
}

function StatusPill({
  cell,
  onCommand,
  commandsDisabled,
}: {
  cell: StatusCell;
  onCommand?: (command: string) => void;
  commandsDisabled: boolean;
}) {
  if (cell.kind === "list") {
    // The chip keeps the row one line wide; the popover is where the entry
    // list belongs, one per line, scrollable when it is long.
    const full = `${cell.title}: ${cell.items.join(", ")}`;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            title={full}
            aria-label={full}
            className="shrink-0 rounded-full font-mono text-[11.5px] font-medium text-muted-foreground"
          >
            {cell.label}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-auto min-w-[180px] max-w-[min(340px,calc(100vw-24px))] p-2.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{cell.title}</div>
          <ul className="grid max-h-[min(40vh,320px)] gap-0.5 overflow-y-auto">
            {cell.items.map((entry, index) => (
              <li key={index} className="font-mono text-[11.5px] leading-5 text-foreground">{entry}</li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    );
  }
  if (cell.kind === "text") {
    return (
      <Badge variant="outline" className="max-w-full shrink-0 font-mono text-[11.5px] font-normal whitespace-pre text-muted-foreground">
        <AnsiText text={cell.text} />
      </Badge>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={!onCommand || commandsDisabled}
      title={`${cell.label} · ${cell.command}`}
      aria-label={`${cell.label} (${cell.command})`}
      onClick={() => onCommand?.(cell.command)}
      className="shrink-0 rounded-full font-mono text-[11.5px] text-muted-foreground"
    >
      {cell.label}
    </Button>
  );
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
    .map((cell) => {
      if (cell.kind === "text") return stripAnsi(cell.text);
      if (cell.kind === "list") return `${cell.title}: ${cell.items.join(", ")}`;
      return cell.label;
    })
    .join(" ");

  // The permissive marker is pinned to the row's right edge: it reports a
  // property of the whole run, so it must stay visible while the ordinary
  // statuses beside it scroll (a long LSP list used to carry it off-screen).
  const pinnedCells = cells.filter(isPermissiveCell);
  const scrollingCells = cells.filter((cell) => !isPermissiveCell(cell));

  const statusLine = cells.length > 0 ? (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div
        role="status"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pl-0.5 pr-1.5 scrollbar-none"
        aria-label={plainStatusLine}
        title={plainStatusLine}
      >
        {scrollingCells.map((cell, index) => (
          <StatusPill
            key={index}
            cell={cell}
            onCommand={onCommand}
            commandsDisabled={commandsDisabled}
          />
        ))}
      </div>
      {pinnedCells.length > 0 && scrollingCells.length > 0 && (
        <Separator orientation="vertical" className="mx-1 h-4" />
      )}
      {pinnedCells.map((cell, index) => (
        // The permissive marker ("yolo", pi-permission-system) renders as bare
        // red text here — no capsule — and this row is its only surface; the
        // composer's own pill row no longer repeats it.
        <span
          key={`pinned-${index}`}
          className="inline-flex shrink-0 items-center whitespace-pre font-mono text-[10px] font-semibold tracking-[0.6px] text-destructive"
        >
          {cell.kind === "text" ? stripAnsi(cell.text).toUpperCase() : null}
        </span>
      ))}
    </div>
  ) : null;

  return (
    // `extension-status-bar` is a layout hook (the keyboard-open CSS and the
    // mobile shell target it); the styling itself is shadcn utilities on the
    // row's pills. `relative` anchors an expanded widget's floating panel above
    // the row.
    //
    // The row stands beside the composer shell, so it cannot inherit its
    // padding: its inset is measured from the composer card's own content edge
    // instead — `InputGroup` p-2 (8px) plus the control's px-3 (12px) = 20px,
    // which is where the input's first glyph starts. A larger inset (the old
    // 52px) left the pills floating under the middle of the card on desktop.
    <div className="extension-status-bar relative mt-1 mx-auto flex w-full min-w-0 max-w-[min(var(--chat-content-max-width,820px),700px)] shrink-0 items-stretch px-[20px] max-sm:px-[12px] pb-0.5">
      {widgets.length > 0 ? <ExtensionWidgets widgets={widgets}>{statusLine}</ExtensionWidgets> : statusLine}
    </div>
  );
}
