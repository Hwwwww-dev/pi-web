export const MOBILE_MAX_WIDTH = 640;
export const SPLIT_PANEL_MIN_WIDTH = 960;

export const SIDEBAR_DEFAULT_WIDTH = 300;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export const RIGHT_PANEL_FALLBACK_WIDTH = 560;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 1200;

const COMPACT_CHAT_MIN_WIDTH = 320;
const DESKTOP_CHAT_MIN_WIDTH = 420;
/** window.innerWidth includes the page scrollbar the layout can't use. */
const DESKTOP_SCROLLBAR_ALLOWANCE = 15;

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const finiteWidth = Number.isFinite(width) ? width : minWidth;
  const effectiveMax = Math.max(minWidth, maxWidth);
  return Math.round(Math.max(minWidth, Math.min(effectiveMax, finiteWidth)));
}

export function getDefaultRightPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(viewportWidth * 0.42, 360, 640);
}

export function getSidebarMaxWidth(options: {
  viewportWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}): number {
  const { viewportWidth, rightPanelOpen, rightPanelWidth } = options;
  if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;

  const compact = viewportWidth < SPLIT_PANEL_MIN_WIDTH;
  const chatWidth = compact ? COMPACT_CHAT_MIN_WIDTH : DESKTOP_CHAT_MIN_WIDTH;
  const scrollbar = compact ? 0 : DESKTOP_SCROLLBAR_ALLOWANCE;
  const visibleRightPanelWidth = !compact && rightPanelOpen ? rightPanelWidth : 0;
  return Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - chatWidth - visibleRightPanelWidth - scrollbar);
}

export function getRightPanelMaxWidth(options: {
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
}): number {
  const { viewportWidth, sidebarOpen, sidebarWidth } = options;
  if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) return RIGHT_PANEL_MAX_WIDTH;

  const visibleSidebarWidth = sidebarOpen ? sidebarWidth : 0;
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    viewportWidth - DESKTOP_CHAT_MIN_WIDTH - visibleSidebarWidth - DESKTOP_SCROLLBAR_ALLOWANCE,
  );
}

/** Panel id → share of the split, as react-resizable-panels reports it. */
export type PanelLayout = Record<string, number>;

const PANEL_LAYOUT_STORAGE_KEY = "pi-web:panel-layout";

export function readPanelLayout(): PanelLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const layout: PanelLayout = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) layout[id] = value;
    }
    return Object.keys(layout).length > 0 ? layout : null;
  } catch {
    return null;
  }
}

export function writePanelLayout(layout: PanelLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Resizing stays available when storage is unavailable.
  }
}
