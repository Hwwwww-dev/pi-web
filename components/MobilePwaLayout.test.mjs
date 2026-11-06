import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsCssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const viewportHookSource = await readFile(new URL("../hooks/useViewportHeight.ts", import.meta.url), "utf8");
const extensionStatusBarSource = await readFile(new URL("./ExtensionStatusBar.tsx", import.meta.url), "utf8");
const mermaidBlockSource = await readFile(new URL("./MermaidBlock.tsx", import.meta.url), "utf8");
const mcpConfigSource = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const mcpSignInSource = await readFile(new URL("./McpSignIn.tsx", import.meta.url), "utf8");
const mcpAddSource = await readFile(new URL("./McpAddServer.tsx", import.meta.url), "utf8");
const newSessionBarSource = await readFile(new URL("./NewSessionContextBar.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("configures iOS standalone mode to use the visible viewport below the status bar", () => {
  // iOS 27 draws an unconditional Liquid Glass blur over the top edge of
  // installed PWAs whenever a status-bar-style meta is present — the iOS 26
  // "black" bar workaround stopped suppressing it. Apple's guidance
  // (WebKit #317153): omit the key entirely; the bar matches the page color.
  assert.doesNotMatch(layoutSource, /statusBarStyle/);
  // Cover stays: env(safe-area-inset-*) keeps its values for the max() paddings.
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
  assert.match(cssSource, /@media \(display-mode: standalone\) \{[\s\S]*?--app-viewport-height: 100dvh;/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(appShellSource, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(appShellSource, /pl-\[env\(safe-area-inset-left\)\]/);
  assert.match(appShellSource, /pr-\[env\(safe-area-inset-right\)\]/);
  // The header keeps its safe-area compensation; the dashboard's 52px header
  // height is a minimum so the phone's two rows grow it.
  assert.match(appShellSource, /flex min-h-\(--header-height\) shrink-0 items-center gap-2 border-b pt-\[env\(safe-area-inset-top\)\] transition-\[width,height\] ease-linear/);
  // Right panel tab bar: the draft's 46px bar with its safe-area compensation.
  assert.match(appShellSource, /h-\[calc\(46px_\+_\env\(safe-area-inset-top\)\)\] shrink-0/);
  assert.match(appShellSource, /h-\[var\(--app-viewport-height,100dvh\)\]/);
  assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("resize", scheduleUpdate\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", handleFocusOut\)/);
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(chatWindowSource, /\[padding-bottom:calc\(env\(safe-area-inset-bottom,0px\)\/2\)\]/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(cssSource, /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/);
  // Code fences keep their bounds through the ui CodeBlock's own utilities.
  assert.match(mermaidBlockSource, /<CodeBlockFrame className="w-full min-w-0 max-w-full">/);
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  // The extension overlays are bounded by the panel that anchors them, not the
  // visual viewport, which is far taller than the chat panel on mobile.
  assert.match(chatWindowSource, /import \{ useDialogMaxHeight \} from "@\/hooks\/useDialogMaxHeight";/);
  assert.match(chatWindowSource, /const dialogMaxHeight = useDialogMaxHeight\(wrapperRef\);/);
  assert.match(chatWindowSource, /maxHeight: dialogMaxHeight/);
  // The draft composer is always stacked: the textarea row and the tool
  // capsule row are siblings, and the capsule row never wraps.
  assert.match(chatInputSource, /"chat-input-controls flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto/);
  assert.match(chatInputSource, /"chat-input-textarea w-full min-w-0/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/);
});

test("keeps modal dialogs clear of the iOS status bar in standalone mode", () => {
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{/);
  assert.match(settingsCssSource, /padding-top: max\(59px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(8px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /@media \(display-mode: standalone\) and \(orientation: landscape\) \{[\s\S]*?padding-top: max\(8px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(59px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(8px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(59px, env\(safe-area-inset-left\)\);/);
  assert.match(settingsCssSource, /\.settings-dialog-surface,[\s\S]*?\.config-panel-root\.is-modal > \.config-panel-surface \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/);
});

test("collapses secondary composer chrome while the mobile keyboard is open", () => {
  assert.match(viewportHookSource, /root\.dataset\.keyboardOpen = "true"/);
  assert.match(viewportHookSource, /delete root\.dataset\.keyboardOpen/);
});

test("every class the keyboard-open rules target exists on its component", () => {
  // Every selector the keyboard rules target must exist on the element it
  // means; a renamed class would otherwise leave the rule silently dead.
  assert.match(chatInputSource, /className="chat-input-controls[^"]*"/);
  assert.match(chatInputSource, /compact\s*\?\s*"shrink-0"[\s\S]*?:\s*"chat-input-shell /);
  assert.match(extensionStatusBarSource, /className="extension-status-bar /);
  assert.match(chatWindowSource, /className="chat-content /);
  // Phone landscape exceeds the 640px breakpoint but has the least height.
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{\s*html\[data-keyboard-open\] \.extension-status-bar \{\s*display: none !important;/);
  // Except while its model picker is open: the picker's filter is the field
  // the keyboard is for, and hiding its row would hide the picker (#1271).
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-input-controls:not\(:has\(\.model-selector \[role="listbox"\]\)\) \{\s*display: none !important;/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-content \{\s*padding-bottom: 0 !important;/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-input-shell \{\s*padding-bottom: 6px !important;/);
  // While streaming with an empty composer the main button stops the run.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.stopAgent"\)\}/);
  // A fresh composer's project bar goes too, in a rule of its own inside the same query.
  assert.match(newSessionBarSource, /<div className="new-session-context">/);
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{[^@]*?html\[data-keyboard-open\] \.new-session-context \{\s*display: none !important;/);
  // Mobile send is icon-only but keeps an accessible name.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.send"\)\}/);
  assert.match(newSessionBarSource, /<div className="new-session-context">/);
});

test("every .mcp-* rule in settings.css matches a class the MCP panel renders, and back", () => {
  // Every .mcp-* rule targets a class the panel (its Sign-in row, its add pane) renders, and every
  // class it renders has a rule, so a rename cannot leave a phone rule silently dead.
  const styled = new Set([...settingsCssSource.matchAll(/\.(mcp-[a-z-]+)/g)].map((match) => match[1]));
  const rendered = new Set([...`${mcpConfigSource}\n${mcpSignInSource}\n${mcpAddSource}`.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((match) => (match[1] ?? match[2]).split(/\s+/))
    .filter((name) => name.startsWith("mcp-")));
  assert.deepEqual([...styled].sort(), [...rendered].sort());
});
