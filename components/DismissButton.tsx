"use client";

import { XIcon } from "lucide-react";

/** Close button for an inline error or result notice. */
export function DismissButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-dim transition-colors hover:bg-secondary hover:text-muted-foreground"
    >
      <XIcon className="size-3" strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
