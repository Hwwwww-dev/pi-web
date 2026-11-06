import { stripAnsi } from "./ansi";
import type { ExtensionStatusItem } from "./types";

export interface ExtensionStatusEntry {
  key: string;
  text: string;
}

export type ExtensionStatusTone = "ok" | "warning" | "error";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * pi-permission-system reports a permissive run as the bare status "yolo"
 * (`PERMISSION_SYSTEM_YOLO_STATUS_VALUE`). pi-web shows it as its own chip
 * above the composer instead of an entry in the status list.
 */
export function isPermissiveStatusText(text: string): boolean {
  return sanitizeExtensionStatusText(text).toLowerCase() === "yolo";
}

/** Sanitized statuses in display order, with the permissive flag split out. */
export function splitExtensionStatuses(statuses: ExtensionStatusItem[]): {
  statuses: ExtensionStatusEntry[];
  permissive: string | null;
} {
  const ordered: ExtensionStatusEntry[] = [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, text }) => ({ key, text: sanitizeExtensionStatusText(text) }));

  return {
    statuses: ordered.filter((status) => !isPermissiveStatusText(status.text)),
    permissive: ordered.find((status) => isPermissiveStatusText(status.text))?.text ?? null,
  };
}

function countServerIds(list: string): number {
  return list
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean).length;
}

/**
 * pi-lens reports the footer line it renders itself (`LSP Active: a, b`,
 * `LSP Failed: c`, `LSP Inactive`, or its compact `LSP ✓` / `LSP ✗`), which is
 * the only status whose text carries a signal worth colouring. Anything another
 * extension reports is shown as-is and counts as fine until it says otherwise.
 */
export function extensionStatusEntryTone(text: string): ExtensionStatusTone {
  const plain = stripAnsi(text).trim();
  // `*` on both captures: a bare "LSP Active:" (the line survives with no server
  // listed) must still count as LSP text, so an empty list reads as error rather
  // than falling through to the generic "ok" branch.
  const active = plain.match(/LSP Active:\s*([^·\n]*)/i)?.[1];
  const failed = plain.match(/LSP Failed:\s*([^·\n]*)/i)?.[1];
  if (active === undefined && failed === undefined && !/LSP\s*(Inactive|✗)/i.test(plain)) {
    return /✗/.test(plain) ? "error" : "ok";
  }

  const activeCount = active ? countServerIds(active) : 0;
  const failedCount = failed ? countServerIds(failed) : 0;
  if (failedCount === 0) return activeCount > 0 ? "ok" : "error";
  return activeCount > 0 ? "warning" : "error";
}

/** Worst tone across the reported statuses, or null when none reports anything. */
export function extensionStatusTone(statuses: ExtensionStatusEntry[]): ExtensionStatusTone | null {
  let worst: ExtensionStatusTone | null = null;
  for (const status of statuses) {
    const text = status.text.trim();
    if (!text) continue;
    const tone = extensionStatusEntryTone(text);
    if (tone === "error") return "error";
    if (tone === "warning") worst = "warning";
    else if (worst === null) worst = "ok";
  }
  return worst;
}
