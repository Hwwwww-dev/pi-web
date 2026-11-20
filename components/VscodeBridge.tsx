"use client";

import { useEffect } from "react";
import { installVscodeBridge } from "@/lib/vscode-bridge";

/**
 * Installs the bridge only when the page is embedded by the pi-web-vsc panel;
 * everywhere else it is a no-op.
 */
export function VscodeBridge() {
  useEffect(() => installVscodeBridge(), []);
  return null;
}
