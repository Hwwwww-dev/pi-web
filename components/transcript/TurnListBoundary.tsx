"use client";

import { Component, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface TurnListBoundaryProps {
  /** Shown in place of the list when a turn fails to render. */
  label: string;
  /** The button's text: reloading the page is the only recovery that is known to work. */
  reloadLabel: string;
  children: ReactNode;
}

interface TurnListBoundaryState {
  message: string | null;
}

/**
 * Keeps one badly shaped turn from blanking the whole chat.
 *
 * A render error inside the transcript routine takes the entire tree with it,
 * which on a phone looks like an empty session with no explanation — the error
 * only shows up in the console nobody can open there. The boundary around the
 * turn list turns that into a sentence and a reload button.
 */
export class TurnListBoundary extends Component<TurnListBoundaryProps, TurnListBoundaryState> {
  state: TurnListBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): TurnListBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 py-6">
        <p className="text-sm text-foreground">{this.props.label}</p>
        <p className="font-mono text-xs break-words text-muted-foreground">{this.state.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
          {this.props.reloadLabel}
        </Button>
      </div>
    );
  }
}
