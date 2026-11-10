"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    <Badge
      variant="outline"
      title={label}
      aria-label={label}
      className="shrink-0 cursor-default border-destructive/35 bg-destructive/[0.06] px-1.5 py-0 font-mono text-[10px] font-semibold tracking-[0.6px] text-destructive"
    >
      {text.toUpperCase()}
    </Badge>
  );
}

/**
 * Extension status texts (LSP state, goal mode, subagents, …) live behind this
 * umbrella chip: the shelf above the composer only carries widget triggers, and
 * one compact button is what lets the toolbar row fit every control. The dot
 * carries the worst tone, the popover lists every line in full. Radix owns the
 * upward placement (right-aligned), the viewport collision and the dismissal.
 */
export function ExtensionStatusButton({ statuses }: { statuses: ExtensionStatusItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { statuses: entries } = splitExtensionStatuses(statuses);
  const label = t("chat.extensionStatus");

  const tone = extensionStatusTone(entries);
  if (!tone) return null;
  const summary = entries.length > 1 ? `${label} · ${entries.length}` : label;

  // The status dot mirrors the umbrella tone; `data-tone` keeps the signal
  // readable in the DOM while Tailwind variants map it to the palette.
  const dotClass = "size-[7px] shrink-0 rounded-full data-[tone=ok]:bg-success data-[tone=warning]:bg-warning data-[tone=error]:bg-destructive";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={label}
          aria-label={summary}
          className="h-8 max-[640px]:h-[34px] gap-[5px] rounded-md px-2 text-xs leading-none text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground"
        >
          <span className={dotClass} data-tone={tone} aria-hidden="true" />
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        aria-label={label}
        className="flex max-h-[min(320px,40dvh)] w-max max-w-(--radix-popover-content-available-width) flex-col gap-[7px] overflow-auto overscroll-contain p-2 px-2.5"
      >
        {entries.map((status) => (
          <div key={status.key} className="flex min-w-0 items-start gap-2">
            <span
              className={`${dotClass} mt-[5px]`}
              data-tone={extensionStatusEntryTone(status.text)}
              aria-hidden="true"
            />
            {/* Status text is TUI output as well: it scrolls sideways instead of
                wrapping a line into a broken row. */}
            <pre className="m-0 min-w-0 overflow-x-auto overscroll-contain whitespace-pre-wrap">
              <AnsiText text={status.text} />
            </pre>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
