"use client";

import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import {
  TERMINAL_EXTRA_KEY_ROWS,
  TERMINAL_REPEATING_KEYS,
  type TerminalExtraKey,
  type TerminalModifier,
  type TerminalModifiers,
} from "@/lib/terminal-extra-keys";

const KEY_LABELS: Record<TerminalExtraKey | TerminalModifier, string> = {
  Escape: "ESC", "/": "/", "-": "-", Home: "HOME", ArrowUp: "↑", End: "END", PageUp: "PGUP",
  Tab: "TAB", ctrl: "CTRL", alt: "ALT", ArrowLeft: "↓", ArrowDown: "↓", ArrowRight: "↑", PageDown: "PGDN",
};

const KEY_NAMES: Partial<Record<TerminalExtraKey, string>> = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", PageUp: "Page Up", PageDown: "Page Down",
};

const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 50;

function isPortrait(): boolean {
  const type = window.screen.orientation?.type;
  if (type) return type.startsWith("portrait");
  const angle = (window as { orientation?: number }).orientation;
  if (typeof angle === "number") return angle % 180 === 0;
  return window.innerHeight >= window.innerWidth;
}

function subscribeTouchPortrait(callback: () => void): () => void {
  const coarse = window.matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", callback);
  window.screen.orientation?.addEventListener("change", callback);
  window.addEventListener("orientationchange", callback);
  window.addEventListener("resize", callback);
  return () => {
    coarse.removeEventListener("change", callback);
    window.screen.orientation?.removeEventListener("change", callback);
    window.removeEventListener("orientationchange", callback);
    window.removeEventListener("resize", callback);
  };
}

const getTouchPortrait = () => window.matchMedia("(pointer: coarse)").matches && isPortrait();

export function useTerminalExtraKeysVisible(): boolean {
  return useSyncExternalStore(subscribeTouchPortrait, getTouchPortrait, () => false);
}

interface Props {
  modifiers: TerminalModifiers;
  onKey: (key: TerminalExtraKey) => void;
  onToggleModifier: (modifier: TerminalModifier) => void;
}

export function TerminalExtraKeys({ modifiers, onKey, onToggleModifier }: Props) {
  const { t } = useI18n();
  const repeatTimer = useRef<number | null>(null);

  const stopRepeat = () => {
    if (repeatTimer.current !== null) window.clearTimeout(repeatTimer.current);
    repeatTimer.current = null;
  };
  useEffect(() => stopRepeat, []);

  const press = (event: PointerEvent<HTMLButtonElement>, key: TerminalExtraKey | TerminalModifier) => {
    event.preventDefault();
    if (event.button !== 0) return;
    stopRepeat();
    if (key === "ctrl" || key === "alt") {
      onToggleModifier(key);
      return;
    }
    onKey(key);
    if (!TERMINAL_REPEATING_KEYS.has(key)) return;
    const repeat = () => {
      onKey(key);
      repeatTimer.current = window.setTimeout(repeat, REPEAT_INTERVAL_MS);
    };
    repeatTimer.current = window.setTimeout(repeat, REPEAT_DELAY_MS);
  };

  return (
    // 面板的末行网格（批 4 自 app/globals.css 迁入）：键盘打开时由该文件的
    // html[data-keyboard-open] 覆写收起安全区内边距。
    <div
      className="terminal-extra-keys grid [grid-row:4] grid-cols-7 auto-rows-[36px] bg-(--terminal-header-bg) pb-[env(safe-area-inset-bottom)]"
      role="toolbar"
      aria-label={t("terminal.extraKeys")}
    >
      {TERMINAL_EXTRA_KEY_ROWS.flat().map((key) => {
        const modifier = key === "ctrl" || key === "alt";
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="default"
            tabIndex={-1}
            className={`min-w-0 rounded-none border-0 px-0 py-0 font-mono text-xs font-normal text-(--terminal-key) hover:bg-transparent hover:text-(--terminal-key) active:bg-(--terminal-hover-bg) active:text-(--terminal-key) dark:hover:bg-transparent dark:hover:text-(--terminal-key) touch-manipulation select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]${modifier && modifiers[key] ? " text-(--terminal-accent)" : ""}`}
            aria-pressed={modifier ? modifiers[key] : undefined}
            aria-label={modifier ? undefined : KEY_NAMES[key]}
            onPointerDown={(event) => press(event, key)}
            onPointerUp={stopRepeat}
            onPointerCancel={stopRepeat}
            onPointerLeave={stopRepeat}
            onMouseDown={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {key === "ArrowLeft" || key === "ArrowRight" ? <span className="inline-block rotate-90">{KEY_LABELS[key]}</span> : KEY_LABELS[key]}
          </Button>
        );
      })}
    </div>
  );
}
