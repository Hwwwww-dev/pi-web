"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

export interface SelectorRowStar {
  /** This row is the default new sessions start with. */
  isDefault: boolean;
  /** Title and accessible name of the save button on the other rows. */
  saveLabel: string;
  /** Title and accessible name of the default row's marker. */
  defaultLabel: string;
  onSave: () => void;
}

/**
 * A selector menu row styled like a session-list row: the whole row selects
 * and highlights on hover. With `star`, the right gutter holds the default
 * marker: a small static star on the default row, and on every other row a
 * "save as default" button that floats in on hover or keyboard focus. Touch
 * screens have no hover, so there the button stays visible.
 */
export function SelectorRow({
  active,
  onSelect,
  star,
  gutter = Boolean(star),
  children,
}: {
  active: boolean;
  onSelect: () => void;
  star?: SelectorRowStar;
  /** Keep room for the star so it never covers the row's text; pass it to every row of a menu that has stars so they line up. */
  gutter?: boolean;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSave = Boolean(star && !star.isDefault);
  // Drives the save button's tab order, so hover/focus stay observed in JS.
  const showSave = canSave && (hovered || focused || isMobile);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cn(
        "relative transition-colors duration-100",
        active ? "bg-accent" : hovered ? "bg-secondary" : "bg-transparent",
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent py-[7px] pl-3 text-left text-xs whitespace-nowrap",
          gutter ? "pr-9" : "pr-3",
          active ? "font-semibold text-foreground" : "font-normal text-muted-foreground",
        )}
      >
        {active
          ? <CheckIcon size={10} strokeWidth={2} className="shrink-0 text-primary" />
          : <span className="w-2.5 shrink-0" />}
        {children}
      </button>
      {star?.isDefault && (
        <span
          role="img"
          aria-label={star.defaultLabel}
          title={star.defaultLabel}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center text-muted-foreground"
        >
          <StarIcon size={10} fill="currentColor" />
        </span>
      )}
      {star && canSave && (
        <button
          type="button"
          title={star.saveLabel}
          aria-label={star.saveLabel}
          tabIndex={showSave ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            star.onSave();
          }}
          className={cn(
            "absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-secondary p-0 text-muted-foreground transition-[opacity,background-color,color,border-color] duration-100",
            "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "enabled:cursor-pointer enabled:hover:border-primary/35 enabled:hover:bg-accent enabled:hover:text-primary",
            showSave ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <StarIcon size={12} />
        </button>
      )}
    </div>
  );
}
