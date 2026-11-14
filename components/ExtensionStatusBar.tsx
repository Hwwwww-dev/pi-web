"use client";

import { useState, type ReactNode } from "react";
import { stripAnsi } from "@/lib/ansi";
import { isPermissiveStatusText } from "@/lib/extension-status";
import { displayLabel } from "@/lib/label-case";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { CHAT_COMPOSER_INSET_CLASS } from "@/lib/chat-layout";
import { ExtensionWidgets, extensionWidgetLabel } from "./ExtensionWidgets";
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
  if (!firstWord || items.length < 1) return null;
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
    // A status that only names itself plus a state word reports nothing to act on:
    // 名称已含全部信息，额外的状态词只会增加底栏噪音（LSP Active → LSP）。
    // 冒号后的条目清单同理：单条时 splitStatusList 不收录，胶囊只保留名称，全文仍在 title 中。
    const plainText = stripAnsi(text).replace(/\s+/g, " ").trim();
    const named = plainText
      .replace(/\s*:\s*.*$/, "")
      .replace(/\s+(?:inactive|disabled|active|idle|ready|running|stopped|working)\s*$/i, "");
    cells.push({ kind: "text", text: named && named !== plainText ? named : text });
  }
  return cells;
}

/**
 * 列表状态胶囊。弹出层受控：焦点移出（Tab 离开或点击其他位置）即收起，不等下一次点击。
 */
function StatusListChip({ title, items, label, full }: { title: string; items: string[]; label: string; full: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          title={full}
          aria-label={full}
          className="shrink-0 font-mono text-xs font-medium text-muted-foreground animate-in fade-in duration-150 motion-reduce:animate-none"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onFocusOutside={close}
        onInteractOutside={close}
        className="w-auto min-w-[180px] max-w-[min(340px,calc(100vw-24px))] p-2.5"
      >
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <ul className="grid max-h-[min(40vh,320px)] gap-0.5 overflow-y-auto">
          {items.map((entry, index) => (
            <li key={index} className="font-mono text-xs leading-5 text-foreground">{entry}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
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
    return <StatusListChip title={cell.title} items={cell.items} label={displayLabel(cell.label)} full={full} />;
  }
  if (cell.kind === "text") {
    return (
      // 与带列表的 chip 保持同一形状（outline / xs / mono）：否则 TODO、Goal 为裸文字而 LSP 为胶囊，底栏无法对齐。
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled
        title={stripAnsi(cell.text)}
        aria-label={stripAnsi(cell.text)}
        className="max-w-full shrink-0 font-mono text-xs font-normal text-muted-foreground animate-in fade-in duration-150 motion-reduce:animate-none"
      >
        {/* Plain status text is a label like any other; ANSI text is the extension's own. */}
        {/\u001b/.test(cell.text) ? <AnsiText text={cell.text} /> : displayLabel(cell.text)}
      </Button>
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
      className="shrink-0 font-mono text-xs text-muted-foreground animate-in fade-in duration-150 motion-reduce:animate-none"
    >
      {displayLabel(cell.label)}
    </Button>
  );
}

/**
 * ChatWindow 判断胶囊挂哪（同状态条自身的 widget 去重口径）：状态条会不会渲染。
 * 状态条在 → 胶囊作 leading 插条带最左端（widgets 触发器与状态内容之前）；
 * 不在 → 胶囊绝对定位浮在同一条带左端。
 */
export function hasExtensionStatusBarContent(statuses: ExtensionStatusItem[], widgets: ExtensionWidgetItem[]): boolean {
  const widgetLabels = new Set(
    widgets.map((widget) => displayLabel(extensionWidgetLabel(widget.key)).toLowerCase()),
  );
  const cells = buildExtensionStatusCells(statuses).filter((cell) => {
    const label = cell.kind === "text" ? displayLabel(stripAnsi(cell.text)) : displayLabel(cell.label);
    return !widgetLabels.has(label.toLowerCase());
  });
  return cells.length > 0 || widgets.length > 0;
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
  leading,
  onCommand,
  commandsDisabled = false,
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  /** 流式状态胶囊（StreamStatusPill）：插在条带最左端，widgets 触发器之前。 */
  leading?: ReactNode;
  /** Sends the command of a `command:` status; without it those buttons stay disabled. */
  onCommand?: (command: string) => void;
  commandsDisabled?: boolean;
}) {
  // A status whose text repeats a widget's name is the same fact twice (pi-goal
  // sets both); the widget owns the chip because it also opens its lines.
  const widgetLabels = new Set(
    widgets.map((widget) => displayLabel(extensionWidgetLabel(widget.key)).toLowerCase()),
  );
  const cells = buildExtensionStatusCells(statuses).filter((cell) => {
    const label = cell.kind === "text" ? displayLabel(stripAnsi(cell.text)) : displayLabel(cell.label);
    return !widgetLabels.has(label.toLowerCase());
  });
  if (cells.length === 0 && widgets.length === 0) {
    // 无内容但有 leading（流式胶囊）：仍渲染同构空条带——胶囊固定在这一个挂载点，
    // 状态条内容出现/消失时不再瞬移（此前胶囊在 leading 槽与独立条带间跳）。
    if (!leading) return null;
    return (
      <div className={`extension-status-bar relative flex min-h-[calc(1.5em+2px)] items-center pb-3 ${CHAT_COMPOSER_INSET_CLASS}`}>
        {leading}
      </div>
    );
  }

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
          className="inline-flex shrink-0 items-center whitespace-pre font-mono text-xs font-semibold tracking-[0.6px] text-destructive"
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
    <div className={`extension-status-bar relative ${CHAT_COMPOSER_INSET_CLASS} flex shrink-0 items-stretch pb-3`}>
      {/* 胶囊在最外层、widgets 触发器之前：todo 等胶囊是 widgets，排在 ExtensionWidgets
          内部 statusLine 前面，插行首抢不过它们——只有提出去才能保证 token 恒在最左。 */}
      {leading}
      {leading && <Separator orientation="vertical" className="mx-1 h-4 shrink-0" />}
      {widgets.length > 0 ? <ExtensionWidgets widgets={widgets}>{statusLine}</ExtensionWidgets> : statusLine}
    </div>
  );
}
