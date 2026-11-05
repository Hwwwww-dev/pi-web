"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { extensionStatusEntryTone, extensionStatusTone, splitExtensionStatuses } from "@/lib/extension-status";
import type { ExtensionStatusItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";

/** Permissive-mode marker (`yolo`). It is a marker, not a control, so it keeps
 *  its own red pill instead of the toolbar's flat chip look. The styling is
 *  Tailwind utilities (not a CSS class) on purpose: a stylesheet class here has
 *  twice rendered as a plain red word when the dev stylesheet was a generation
 *  behind the component; utilities compile with the component itself. */
export function PermissiveModeChip({ text }: { text: string }) {
  const { t } = useI18n();
  const label = t("chat.permissiveMode");

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 cursor-default rounded-[4px] border border-destructive/35 bg-destructive/8 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.6px] text-destructive"
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
  // The popover is right-anchored to the button, but the button often sits mid-row
  // (更多/YOLO to its right): a width capped only by 100vw still hangs past the
  // viewport's LEFT edge on phones. Clamp the width to the space left of the
  // button's right edge (240px floor beats an unusably narrow panel).
  const [popoverMaxWidth, setPopoverMaxWidth] = useState(420);
  const { statuses: entries } = splitExtensionStatuses(statuses);
  const label = t("chat.extensionStatus");

  useEffect(() => {
    if (!open) return;
    const clampToViewport = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setPopoverMaxWidth(Math.max(240, Math.min(420, Math.round(rect.right) - 12)));
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [open]);

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
        <div className="extension-status-popover" role="dialog" aria-label={label} style={{ maxWidth: popoverMaxWidth }}>
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
