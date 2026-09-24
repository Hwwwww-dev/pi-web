"use client";

import { Fragment } from "react";
import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";

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
 * (`PERMISSION_SYSTEM_YOLO_STATUS_VALUE`). It is the only status value pi-web
 * treats as a warning instead of information.
 */
export function isWarningStatusText(text: string): boolean {
  return sanitizeExtensionStatusText(text).toLowerCase() === "yolo";
}

/** Sanitized statuses in display order: joined line and rendered spans agree. */
export function orderedStatusTexts(statuses: ExtensionStatusItem[]): Array<{ key: string; text: string }> {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, text }) => ({ key, text: sanitizeExtensionStatusText(text) }));
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return orderedStatusTexts(statuses)
    .map(({ text }) => text)
    .join(" ");
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
}) {
  if (statuses.length === 0 && widgets.length === 0) return null;

  const statusTexts = orderedStatusTexts(statuses);
  const plainStatusLine = stripAnsi(formatExtensionStatusLine(statuses));

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}`}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {statuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
        >
          <span className="extension-status-text">
            {statusTexts.map((status, index) => (
              <Fragment key={status.key}>
                {index > 0 ? " " : null}
                {isWarningStatusText(status.text) ? (
                  <span className="extension-status-warning">
                    <AnsiText text={status.text} />
                  </span>
                ) : (
                  <AnsiText text={status.text} />
                )}
              </Fragment>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
