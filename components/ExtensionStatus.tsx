"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { extensionStatusEntryTone, extensionStatusTone, splitExtensionStatuses } from "@/lib/extension-status";
import type { ExtensionStatusItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";

/** Permissive-mode marker (`yolo`). It is a marker, not a control, so it keeps
 *  its own red pill instead of the toolbar's flat chip look. The styling is
 *  inline on purpose: a CSS class here has twice rendered as a plain red word
 *  when the dev stylesheet was a generation behind the component. */
export function PermissiveModeChip({ text }: { text: string }) {
  const { t } = useI18n();
  const label = t("chat.permissiveMode");

  return (
    <span
      title={label}
      aria-label={label}
      style={{
        flex: "0 0 auto",
        padding: "1px 5px",
        border: "1px solid color-mix(in srgb, #dc2626 35%, transparent)",
        borderRadius: 4,
        background: "color-mix(in srgb, #dc2626 8%, transparent)",
        color: "#dc2626",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.6px",
        cursor: "default",
      }}
    >
      {text.toUpperCase()}
    </span>
  );
}

/**
 * Extension status texts (LSP state, goal mode, subagents, …) live behind this
 * umbrella chip: the shelf above the composer only carries widget triggers, and
 * one compact button is what lets the toolbar row fit every control. The dot
 * carries the worst tone, the popover lists every line in full.
 */
export function ExtensionStatusButton({ statuses }: { statuses: ExtensionStatusItem[] }) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { statuses: entries } = splitExtensionStatuses(statuses);
  const label = t("chat.extensionStatus");

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const tone = extensionStatusTone(entries);
  if (!tone) return null;
  const expanded = open && entries.length > 0;
  const summary = entries.length > 1 ? `${label} · ${entries.length}` : label;

  return (
    <div ref={rootRef} className="extension-status-button-root">
      <button
        type="button"
        className="composer-chip"
        title={label}
        aria-label={summary}
        aria-expanded={expanded}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="extension-status-dot" data-tone={tone} aria-hidden="true" />
        {summary}
      </button>
      {expanded && (
        <div className="extension-status-popover" role="dialog" aria-label={label}>
          {entries.map((status) => (
            <div key={status.key} className="extension-status-entry">
              <span
                className="extension-status-dot"
                data-tone={extensionStatusEntryTone(status.text)}
                aria-hidden="true"
              />
              <pre className="extension-status-entry-text">
                <AnsiText text={status.text} />
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
