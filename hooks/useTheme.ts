"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  isDarkTheme,
  isThemeMode,
  isThemePalette,
  paletteForScheme,
  STORAGE_KEYS,
  type ResolvedTheme,
  type ThemeMode,
  type ThemePalette,
  type ThemeScheme,
} from "@/lib/theme";

export type { ResolvedTheme, ThemeMode, ThemePalette } from "@/lib/theme";

type ThemeState = {
  mode: ThemeMode;
  /** 浅色方案下选中的配色。 */
  light: ThemePalette;
  /** 深色方案下选中的配色。 */
  dark: ThemePalette;
  /** 当前实际运行的配色。 */
  theme: ResolvedTheme;
  /** 当前实际运行的明暗方案。 */
  scheme: ThemeScheme;
};

type ToggleOrigin = { x: number; y: number };

const SERVER_SNAPSHOT: ThemeState = {
  mode: "auto",
  light: DEFAULT_LIGHT_THEME,
  dark: DEFAULT_DARK_THEME,
  theme: DEFAULT_LIGHT_THEME,
  scheme: "light",
};

const listeners = new Set<() => void>();
let state: ThemeState | null = null;
let systemListening = false;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function getSystemScheme(): ThemeScheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return null;
}

function readStoredState(): Pick<ThemeState, "mode" | "light" | "dark"> {
  const mode = readStoredValue(STORAGE_KEYS.mode);
  const light = readStoredValue(STORAGE_KEYS.light);
  const dark = readStoredValue(STORAGE_KEYS.dark);
  return {
    mode: isThemeMode(mode) ? mode : "auto",
    light: isThemePalette(light) ? light : DEFAULT_LIGHT_THEME,
    dark: isThemePalette(dark) ? dark : DEFAULT_DARK_THEME,
  };
}

function schemeOf(mode: ThemeMode): ThemeScheme {
  return mode === "auto" ? getSystemScheme() : mode;
}

function buildState(mode: ThemeMode, light: ThemePalette, dark: ThemePalette): ThemeState {
  const scheme = schemeOf(mode);
  return { mode, light, dark, scheme, theme: paletteForScheme(scheme, light, dark) };
}

function applyDomTheme(theme: ResolvedTheme, scheme: ThemeScheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", scheme === "dark");
}

function ensureState(): ThemeState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (state) return state;

  const stored = readStoredState();
  state = buildState(stored.mode, stored.light, stored.dark);
  applyDomTheme(state.theme, state.scheme);
  return state;
}

function commitState(next: ThemeState, persist: boolean): void {
  applyDomTheme(next.theme, next.scheme);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.mode, next.mode);
      localStorage.setItem(STORAGE_KEYS.light, next.light);
      localStorage.setItem(STORAGE_KEYS.dark, next.dark);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
  state = next;
  emit();
}

function sameState(a: ThemeState, b: ThemeState): boolean {
  return a.mode === b.mode && a.light === b.light && a.dark === b.dark;
}

function syncAutoThemeFromSystem(): void {
  const current = ensureState();
  if (current.mode !== "auto") return;
  const next = buildState(current.mode, current.light, current.dark);
  if (next.theme === current.theme && next.scheme === current.scheme) return;
  commitState(next, false);
}

function ensureSystemListener(): void {
  if (systemListening || typeof window === "undefined" || !window.matchMedia) return;

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", syncAutoThemeFromSystem);
  // Some browsers delay or miss scheme events while backgrounded.
  window.addEventListener("focus", syncAutoThemeFromSystem);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAutoThemeFromSystem();
  });
  systemListening = true;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureState();
  ensureSystemListener();
  syncAutoThemeFromSystem();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ThemeState {
  return ensureState();
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

/** 换配色时给一次圆形扩散过渡（与明暗切换同一条动画）。 */
function animateSwap(apply: () => void, origin?: ToggleOrigin): void {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition !== "function" || reduceMotion) {
    apply();
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  const transition = document.startViewTransition(apply);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
        },
        {
          duration: 450,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // transition cancelled — ignore
    });
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setMode = useCallback((nextMode: ThemeMode, origin?: ToggleOrigin) => {
    const current = ensureState();
    if (current.mode === nextMode) return;
    const next = buildState(nextMode, current.light, current.dark);
    if (next.theme === current.theme) {
      commitState(next, true);
      return;
    }
    animateSwap(() => commitState(next, true), origin);
  }, []);

  /**
   * 选浅色配色立刻看结果：把模式切到浅色（否则在深色里点它毫无变化）。
   * 想回到跟随系统，用模式那一行。
   */
  const setPalette = useCallback((nextPalette: ThemePalette, origin?: ToggleOrigin) => {
    const current = ensureState();
    const scheme = isDarkTheme(nextPalette) ? "dark" : "light";
    const light = scheme === "light" ? nextPalette : current.light;
    const dark = scheme === "dark" ? nextPalette : current.dark;
    const next = buildState(scheme, light, dark);
    if (sameState(next, current) || (next.theme === current.theme && next.scheme === current.scheme)) {
      commitState(next, true);
      return;
    }
    animateSwap(() => commitState(next, true), origin);
  }, []);

  const toggleThemePreference = useCallback((origin?: ToggleOrigin) => {
    // Read the live state at click time: a toggle built from a stale render
    // must not compute its target from that render's resolved theme.
    const current = ensureState();
    setMode(current.scheme === "dark" ? "light" : "dark", origin);
  }, [setMode]);

  return {
    theme: snapshot.theme,
    mode: snapshot.mode,
    scheme: snapshot.scheme,
    light: snapshot.light,
    dark: snapshot.dark,
    setMode,
    setPalette,
    toggleThemePreference,
    isDark: snapshot.scheme === "dark",
  };
}
