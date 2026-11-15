"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface RegionErrorBoundaryProps {
  /** The region's display name (already localized), shown as the placeholder. */
  label: string;
  /** "Something in {region} went wrong.", localized by the caller. */
  message: string;
  retryLabel: string;
  children: ReactNode;
}

/**
 * Keeps a render error in one AppShell region (chat area, sessions sidebar,
 * file panel) from taking the whole page down with it — same shape as
 * DebugPanelBoundary, sized to fill the region it guards. The fallback stays a
 * placeholder: the region's name, the error's own message and a retry that
 * remounts the region fresh.
 */
export class RegionErrorBoundary extends Component<RegionErrorBoundaryProps, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed:`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const detail = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    return (
      <div
        role="status"
        className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground"
      >
        <div>{this.props.message}</div>
        <div className="max-w-[min(560px,100%)] truncate font-mono text-xs opacity-80" title={detail}>
          {detail}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => this.setState({ failed: false, error: null })}
          className="mt-1"
        >
          {this.props.retryLabel}
        </Button>
      </div>
    );
  }
}
