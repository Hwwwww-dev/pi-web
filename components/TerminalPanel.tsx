"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { LinkIcon, MoonIcon, RotateCwIcon, SquareTerminalIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { terminalFontSize, useChatAppearance } from "@/hooks/useChatAppearance";
import { useI18n } from "@/hooks/useI18n";
import { setTerminalTheme, useTerminalTheme } from "@/hooks/useTerminalTheme";
import { subscribeFontPreferences } from "@/hooks/useFontPreferences";
import { readFontWeight } from "@/lib/font-preferences";
import { createTerminalWriter, terminalRequest } from "@/lib/terminal-client";
import { PathLabel } from "./PathLabel";
import { pageId, trackEventSource } from "@/lib/page-debug";
import {
  applyTerminalModifiers,
  NO_TERMINAL_MODIFIERS,
  terminalExtraKeySequence,
  type TerminalExtraKey,
  type TerminalModifier,
  type TerminalModifiers,
} from "@/lib/terminal-extra-keys";
import type { TerminalEvent } from "@/lib/terminal-manager";
import { TERMINAL_XTERM_THEMES } from "@/lib/terminal-theme";
import { TerminalExtraKeys, useTerminalExtraKeysVisible } from "./TerminalExtraKeys";
import type { TerminalTab } from "./terminal-tab-state";

interface Props {
  tab: TerminalTab;
  active: boolean;
  onRestart: () => void;
  onClosed: () => void;
  onCloseError: () => void;
}

export function TerminalPanel({ tab, active, onRestart, onClosed, onCloseError }: Props) {
  const { t } = useI18n();
  const { id, cwd, restored } = tab;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const startRef = useRef<Promise<void>>(Promise.resolve());
  const writerRef = useRef<ReturnType<typeof createTerminalWriter> | null>(null);
  const callbacksRef = useRef({ onClosed, onCloseError });
  callbacksRef.current = { onClosed, onCloseError };
  const [status, setStatus] = useState<"connecting" | "ready" | "exited" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_TERMINAL_MODIFIERS);
  const modifiersRef = useRef(modifiers);
  const showExtraKeys = useTerminalExtraKeysVisible();
  const theme = useTerminalTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const fontSize = terminalFontSize(useChatAppearance().fontSize);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const refitRef = useRef<() => void>(() => {});

  const consumeModifiers = useCallback(() => {
    const current = modifiersRef.current;
    if (current.ctrl || current.alt) {
      modifiersRef.current = NO_TERMINAL_MODIFIERS;
      setModifiers(NO_TERMINAL_MODIFIERS);
    }
    return current;
  }, []);
  const sendExtraKey = (key: TerminalExtraKey) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const sequence = terminalExtraKeySequence(key, consumeModifiers(), terminal.modes.applicationCursorKeysMode);
    terminal.input(sequence, true);
  };
  const toggleModifier = (modifier: TerminalModifier) => {
    const next = { ...modifiersRef.current, [modifier]: !modifiersRef.current[modifier] };
    modifiersRef.current = next;
    setModifiers(next);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let events: EventSource | null = null;
    let offset: number | undefined;
    let connected = false;
    let exited = false;
    let inputFailed = false;
    setStatus("connecting");
    setError(null);
    setExitCode(null);

    const readTerminalFont = () => {
      const style = getComputedStyle(container);
      return {
        fontFamily: style.getPropertyValue("--font-mono").trim() || "monospace",
        // Base weights stop at 600, so xterm's default bold (700) stays heavier.
        fontWeight: readFontWeight(style.getPropertyValue("--font-mono-weight")),
      };
    };
    const terminal = new Terminal({
      cursorBlink: true,
      ...readTerminalFont(),
      fontSize: fontSizeRef.current,
      lineHeight: 1.25,
      scrollback: 8000,
      screenReaderMode: true,
      disableStdin: true,
      theme: TERMINAL_XTERM_THEMES[themeRef.current],
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      return true;
    });

    const writer = createTerminalWriter(id, (reason) => {
      if (disposed) return;
      inputFailed = true;
      terminal.options.disableStdin = true;
      setError(reason.message);
      setStatus("error");
    });
    writerRef.current = writer;
    const onData = terminal.onData((data) => {
      if (connected && !exited && !inputFailed) writer.write(applyTerminalModifiers(data, consumeModifiers()));
    });
    const fitAndResize = () => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      fit.fit();
    };
    const onResize = terminal.onResize(({ cols, rows }) => {
      if (!connected || exited || inputFailed) return;
      writer.resize(Math.max(2, cols), Math.max(2, rows));
    });
    refitRef.current = fitAndResize;
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);
    const updateFont = () => {
      if (disposed) return;
      const font = readTerminalFont();
      terminal.options.fontFamily = font.fontFamily;
      terminal.options.fontWeight = font.fontWeight;
      fitAndResize();
    };
    const unsubscribeFonts = subscribeFontPreferences(updateFont);

    const connect = () => {
      if (disposed || exited || !navigator.onLine) return;
      events?.close();
      // `holder`: the page, for the Debug panel's connected pages.
      const query = new URLSearchParams({ holder: pageId() });
      if (offset !== undefined) query.set("after", String(offset));
      events = trackEventSource("terminal", new EventSource(`/api/terminal/${encodeURIComponent(id)}/events?${query}`), cwd);
      events.onmessage = (message) => {
        let event: TerminalEvent;
        try {
          event = JSON.parse(message.data) as TerminalEvent;
        } catch (e) {
          console.error("Failed to parse terminal event:", e);
          return;
        }
        if (event.type === "output") {
          if (event.reset) terminal.reset();
          else if (offset !== undefined && event.offset <= offset) return;
          terminal.write(event.data);
          offset = event.offset;
        } else {
          exited = true;
          connected = false;
          terminal.options.disableStdin = true;
          events?.close();
          setExitCode(event.type === "exit" ? event.exitCode : null);
          setStatus("exited");
        }
      };
      events.onopen = () => {
        connected = true;
        if (inputFailed) return;
        terminal.options.disableStdin = false;
        setStatus("ready");
        fitAndResize();
        writer.resize(Math.max(2, terminal.cols), Math.max(2, terminal.rows));
        if (container.offsetWidth && container.offsetHeight) terminal.focus();
      };
      events.onerror = () => {
        if (disposed || exited) return;
        connected = false;
        terminal.options.disableStdin = true;
        setStatus(events?.readyState === EventSource.CLOSED ? "error" : "connecting");
      };
    };

    startRef.current = (async () => {
      fitAndResize();
      if (restored || reconnectKey > 0) {
        // Restoring a tab must never silently launch a replacement shell.
        await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`);
      } else {
        await terminalRequest("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, cwd, cols: terminal.cols, rows: terminal.rows }),
        });
      }
      connect();
    })().catch((reason: Error) => {
      if (disposed) return;
      setError(reason.message);
      setStatus("error");
    });

    const pageHide = () => {
      connected = false;
      terminal.options.disableStdin = true;
      events?.close();
      if (!exited && !inputFailed) setStatus("connecting");
    };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) connect(); };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", pageHide);
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      events?.close();
      void writer.stop();
      resizeObserver.disconnect();
      unsubscribeFonts();
      onData.dispose();
      onResize.dispose();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", pageHide);
      window.removeEventListener("online", connect);
      terminal.dispose();
      terminalRef.current = null;
      refitRef.current = () => {};
    };
  }, [id, cwd, restored, reconnectKey, consumeModifiers]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = TERMINAL_XTERM_THEMES[theme];
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontSize === fontSize) return;
    // A refit sends the new cols/rows to the shell through onResize, as a font change does.
    terminal.options.fontSize = fontSize;
    refitRef.current();
  }, [fontSize]);

  useEffect(() => {
    if (active) terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (!tab.closing) return;
    let cancelled = false;
    if (terminalRef.current) terminalRef.current.options.disableStdin = true;
    void (async () => {
      await startRef.current;
      await writerRef.current?.stop();
      await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
      if (!cancelled) callbacksRef.current.onClosed();
    })().catch((reason: Error) => {
      if (cancelled) return;
      setError(reason.message);
      setStatus("error");
      callbacksRef.current.onCloseError();
    });
    return () => { cancelled = true; };
  }, [id, tab.closing]);

  // The status dot reads the app theme's semantic tokens; only the xterm palette
  // and the island chrome (buttons, error strip) stay on --terminal-*.
  const statusDotClass = { connecting: "bg-warning", ready: "bg-success", exited: "bg-destructive", error: "bg-destructive" }[status];
  const nextTheme = theme === "dark" ? "light" : "dark";
  const themeLabel = nextTheme === "light" ? "terminal.lightTheme" : "terminal.darkTheme";
  // The CodeBlock title names the shell; the server picks the real binary.
  const shellLabel = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent) ? "shell" : "zsh";

  return (
    // The CodeBlock sm container, kept on the section so the terminal grid,
    // data-terminal-theme and its own xterm palette stay untouched.
    <section
      // 面板壳的网格布局（38px 头行 / 状态行 / 终端行）批 4 自 app/globals.css
      // 迁入；--terminal-* 调色板仍由 globals 的 .terminal-panel 按主题注入。
      className="terminal-panel group/code-block relative grid h-full min-h-0 w-full min-w-0 grid-rows-[38px_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-input bg-(--terminal-bg) text-xs dark:bg-input/30"
      data-terminal-theme={theme}
      aria-label={t("terminal.title")}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2 px-2.5 text-muted-foreground">
        <span
          className={`size-[7px] shrink-0 rounded-full ${statusDotClass}`}
          title={t(`terminal.${status}`)}
          aria-label={t(`terminal.${status}`)}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-sans text-xs font-medium text-foreground">
          <SquareTerminalIcon aria-hidden="true" size={14} strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
          <span className="shrink-0">{shellLabel}</span>
          <span aria-hidden="true" className="shrink-0 font-normal text-muted-foreground">·</span>
          <PathLabel text={cwd} className="min-w-0 font-normal text-muted-foreground" />
        </span>
        <div className="pointer-coarse:opacity-100 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within/code-block:opacity-100 group-hover/code-block:opacity-100">
          {status === "error" && (
            <Button type="button" variant="ghost" size="icon-xs" className="text-(--terminal-muted) hover:bg-(--terminal-hover-bg) hover:text-(--terminal-strong)" onClick={() => setReconnectKey((key) => key + 1)} disabled={Boolean(tab.closing)} title={t("terminal.reconnect")} aria-label={t("terminal.reconnect")}>
              <LinkIcon strokeWidth={1.8} />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-xs" className="text-(--terminal-muted) hover:bg-(--terminal-hover-bg) hover:text-(--terminal-strong)" onClick={() => setTerminalTheme(nextTheme)} title={t(themeLabel)} aria-label={t(themeLabel)}>
            {nextTheme === "light" ? (
              <SunIcon strokeWidth={1.8} />
            ) : (
              <MoonIcon strokeWidth={1.8} />
            )}
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" className="text-(--terminal-muted) hover:bg-(--terminal-hover-bg) hover:text-(--terminal-strong)" onClick={onRestart} disabled={Boolean(tab.closing)} title={t("terminal.restart")} aria-label={t("terminal.restart")}>
            <RotateCwIcon strokeWidth={1.8} />
          </Button>
        </div>
      </header>
      <div>
        {error && <div role="alert" className="border-b bg-(--terminal-error-bg) px-3 py-[7px] font-mono text-xs text-(--terminal-error-text) border-(--terminal-error-border)">{error}</div>}
        {status === "exited" && <div role="status" className="px-3 py-[7px] font-mono text-xs text-(--terminal-muted)">{exitCode === null ? t("terminal.exited") : t("terminal.exitCode", { code: exitCode })}</div>}
      </div>
      <div className="terminal-xterm min-h-0 min-w-0 overflow-hidden pt-2.5 pr-2 pb-[22px] pl-3 [grid-row:-2/-1]"><div ref={containerRef} className="terminal-xterm-host size-full" /></div>
      {showExtraKeys && <TerminalExtraKeys modifiers={modifiers} onKey={sendExtraKey} onToggleModifier={toggleModifier} />}
    </section>
  );
}
