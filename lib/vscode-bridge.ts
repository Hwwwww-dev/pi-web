/**
 * Bridge for pi-web embedded in the pi-web-vsc extension panel.
 *
 * VS Code swallows copy / paste / cut / select-all / undo for a nested
 * cross-origin iframe: the shortcuts never reach the browser's editing commands
 * and `navigator.clipboard` writes are refused (microsoft/vscode#182642). The
 * keydown events themselves still arrive, so the page replays the editing
 * commands itself and routes clipboard reads and writes through the extension
 * host (`vscode.env.clipboard`).
 *
 * The bridge only activates when the parent frame proves it knows the one-time
 * token the extension put in our URL — a plain browser tab, or someone else's
 * page embedding pi-web, keeps entirely native behavior.
 *
 * The same channel carries navigation the panel cannot do itself: external
 * links open in the system browser (`vscode.env.openExternal`) and file links
 * open in the editor instead of the in-app viewer.
 */

export const VSCODE_BRIDGE_PARAM = "piwebBridge";

const CHANNEL = "pi-web-vscode-bridge";
const VERSION = 1;
const REQUEST_TIMEOUT_MS = 5000;

type InboundMessage =
  | { channel: string; type: "ready"; token: string; version?: number }
  | { channel: string; type: "copy-ack"; token: string; requestId: number; ok: boolean }
  | { channel: string; type: "paste"; token: string; requestId: number; text: string };

let installedCleanup: (() => void) | null = null;
/** Set once the panel answers: outgoing messages are dropped while it is null. */
let outbound: ((message: Record<string, unknown>) => void) | null = null;
/** Modifier state of the click in flight, read by the file-link handler. */
let lastClickWantsExternal = false;
let originalWindowOpen: typeof window.open | null = null;

/** True when pi-web runs inside the extension panel and the handshake finished. */
export function isVscodeBridgeActive(): boolean {
  return outbound !== null;
}

/**
 * One-shot read of whether the click that triggered this navigation asked for
 * the editor (`Alt`/`Cmd`). Always consumes the flag so a stale modifier cannot
 * leak into the next plain click.
 */
export function consumeExternalOpenRequest(): boolean {
  const wanted = lastClickWantsExternal && outbound !== null;
  lastClickWantsExternal = false;
  return wanted;
}

/** Asks the panel to open `filePath` in the editor at `line` (1-based). */
export function requestOpenInVscode(filePath: string, line?: number): void {
  outbound?.({ type: "open-file", path: filePath, line });
}


/** Returns a cleanup function; a second call while installed reuses the first. */
export function installVscodeBridge(): () => void {
  if (typeof window === "undefined" || window.parent === window) return () => {};
  if (installedCleanup) return installedCleanup;

  const token = new URLSearchParams(window.location.search).get(VSCODE_BRIDGE_PARAM);
  if (!token) return () => {};

  const pendingCopy = new Map<number, (ok: boolean) => void>();
  const pendingPaste = new Map<number, (text: string) => void>();
  let nextRequestId = 1;
  let active = false;

  const send = (message: Record<string, unknown>): void => {
    window.parent.postMessage({ channel: CHANNEL, token, ...message }, "*");
  };

  const copy = (text: string): Promise<boolean> => new Promise((resolve) => {
    const requestId = nextRequestId++;
    const finish = (ok: boolean): void => {
      if (!pendingCopy.delete(requestId)) return;
      resolve(ok);
    };
    pendingCopy.set(requestId, finish);
    send({ type: "copy", requestId, text });
    window.setTimeout(() => finish(false), REQUEST_TIMEOUT_MS);
  });

  const paste = (): Promise<string> => new Promise((resolve) => {
    const requestId = nextRequestId++;
    const finish = (text: string): void => {
      if (!pendingPaste.delete(requestId)) return;
      resolve(text);
    };
    pendingPaste.set(requestId, finish);
    send({ type: "paste-request", requestId });
    window.setTimeout(() => finish(""), REQUEST_TIMEOUT_MS);
  });

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    const data = event.data as InboundMessage | null;
    if (!data || data.channel !== CHANNEL || data.token !== token) return;
    if (data.type === "ready") {
      activate();
      return;
    }
    if (data.type === "copy-ack") {
      pendingCopy.get(data.requestId)?.(data.ok);
      return;
    }
    if (data.type === "paste") {
      pendingPaste.get(data.requestId)?.(data.text);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!active || event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === "c") {
      const text = selectedText();
      if (!text) return;
      event.preventDefault();
      void copy(text);
      return;
    }
    if (key === "x") {
      const text = selectedText();
      if (!text) return;
      event.preventDefault();
      void copy(text);
      document.execCommand("delete");
      return;
    }
    if (key === "v") {
      event.preventDefault();
      const target = document.activeElement;
      void paste().then((text) => insertText(target, text));
      return;
    }
    if (key === "a") {
      event.preventDefault();
      selectAll();
      return;
    }
    if (key === "z") {
      event.preventDefault();
      document.execCommand(event.shiftKey ? "redo" : "undo");
    }
  };

  const activate = (): void => {
    if (active) return;
    active = true;
    outbound = send;
    interceptClipboard(copy);
    interceptWindowOpen();
  };

  const openExternal = (url: string): void => {
    send({ type: "open-external", url });
  };

  /** `target="_blank"` links would open nothing inside a webview iframe. */
  const onLinkClick = (event: MouseEvent): void => {
    if (!active || event.defaultPrevented) return;
    if (event.button !== 0 && event.button !== 1) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.getAttribute("target") !== "_blank") return;
    const href = anchor.getAttribute("href") ?? "";
    if (!/^https?:/i.test(href)) return;
    event.preventDefault();
    openExternal(href);
  };

  const onModifierCapture = (event: MouseEvent): void => {
    lastClickWantsExternal = event.altKey || event.metaKey;
  };

  const interceptWindowOpen = (): void => {
    if (originalWindowOpen) return;
    const original = window.open.bind(window);
    originalWindowOpen = original;
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : "";
      if (/^https?:/i.test(href)) {
        openExternal(href);
        return null;
      }
      return original(url as string, target, features);
    }) as typeof window.open;
  };

  const cleanup = (): void => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("click", onLinkClick, true);
    document.removeEventListener("click", onModifierCapture, true);
    if (originalWindowOpen) {
      window.open = originalWindowOpen;
      originalWindowOpen = null;
    }
    outbound = null;
    active = false;
    installedCleanup = null;
  };

  installedCleanup = cleanup;
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onLinkClick, true);
  document.addEventListener("click", onModifierCapture, true);
  send({ type: "hello", version: VERSION });
  return cleanup;
}

/**
 * VS Code refuses `navigator.clipboard.writeText` in a cross-origin iframe, so
 * every copy button in the app (all of them end up here, including the shadcn
 * code-block button that calls the API directly) is redirected to the extension
 * host. When the property cannot be redefined the native API stays in place and
 * the keyboard shortcut path still works.
 */
function interceptClipboard(copy: (text: string) => Promise<boolean>): void {
  const clipboard = navigator.clipboard;
  if (!clipboard) return;
  try {
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      writable: true,
      value: (text: string) => copy(String(text)),
    });
  } catch {
    // Leave the native implementation alone.
  }
}

function selectedText(): string {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? "";
}

function selectAll(): void {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.select();
    return;
  }
  document.execCommand("selectAll");
}

/**
 * Inserts at the caret of the element that had focus when the paste started.
 * `insertText` fires an `input` event, which is what the controlled composer
 * listens to; `setRangeText` plus a manual event is the fallback when the
 * command is unavailable.
 */
function insertText(target: Element | null, text: string): void {
  if (!text) return;
  const element = target?.isConnected ? target : document.activeElement;

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.focus();
    if (document.execCommand("insertText", false, text)) return;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    element.setRangeText(text, start, end, "end");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    document.execCommand("insertText", false, text);
  }
}
