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
const codeBlockPrimitiveSource = await readFile(new URL("./ui/code-block.tsx", import.meta.url), "utf8");
const mcpConfigSource = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");
const mcpSignInSource = await readFile(new URL("./McpSignIn.tsx", import.meta.url), "utf8");
const mcpAddSource = await readFile(new URL("./McpAddServer.tsx", import.meta.url), "utf8");
const newSessionBarSource = await readFile(new URL("./NewSessionContextBar.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settingsPanelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const settingsUiSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const inputPrimitiveSource = await readFile(new URL("./ui/input.tsx", import.meta.url), "utf8");
const textareaPrimitiveSource = await readFile(new URL("./ui/textarea.tsx", import.meta.url), "utf8");

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
  assert.match(appShellSource, /flex h-\[100dvh\] flex-col bg-background/);
  assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("resize", scheduleUpdate\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", handleFocusOut\)/);
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /--keyboard-inset/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  // 键盘弹出期间壳层保持满高并整体上移（transform 仅提交合成层），不使用高度动画：
  // 高度逐帧变化会导致上千条消息的滚动容器重新布局，键盘动画期间持续掉帧。
  assert.match(cssSource, /\.app-shell \{\s*transform: translate3d\(0, calc\(-1 \* var\(--keyboard-inset, 0px\)\), 0\);/);
  // 页头抵消该位移以保持在屏幕顶部，topBarRef 的 client rect 才能继续作为 Popover 锚点。
  assert.match(cssSource, /\.app-top-bar \{\s*transform: translate3d\(0, var\(--keyboard-inset, 0px\), 0\);/);
  // body 不随可视高度收缩：壳层位移后，缩短的 body 会在底部留出空隙。
  assert.doesNotMatch(cssSource, /html, body \{[\s\S]*?height: var\(--app-viewport-height, 100dvh\);[\s\S]*?\}/);
  assert.match(appShellSource, /className="app-shell overflow-hidden"/);
  assert.match(appShellSource, /className="app-top-bar sticky top-0/);
  // The self-drawn drawer's `left: env(safe-area-inset-left)` went with it;
  // the sidebar is the ui Sidebar primitive's Sheet now, and the main area
  // carries the safe-area utilities asserted above. The chat content reserves
  // the bottom inset in full (not half), so the extension shelf and the
  // composer stay clear of the home indicator in standalone mode.
  assert.match(chatWindowSource, /\[padding-bottom:env\(safe-area-inset-bottom,0px\)\]/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(cssSource, /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/);
  // Code fences keep their bounds through the ui CodeBlock's own utilities: the
  // frame carries w-full itself, so the local class only adds the min/max caps.
  assert.match(mermaidBlockSource, /<CodeBlockFrame className="min-w-0 max-w-full">/);
  assert.match(codeBlockPrimitiveSource, /relative flex w-full min-w-0 flex-col overflow-hidden/);
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

test("every field shares one font size, except a touch screen's 16px floor", () => {
  // One --field-font-size for the whole app: the composer must not read larger
  // than the transcript it sits under. A touch screen is the one exception —
  // below 16px iOS zooms the page when a field takes focus, and no viewport
  // setting suppresses it — so the floor is declared once, in a pointer query,
  // and everything around the field keeps its own scale.
  assert.match(cssSource, /--field-font-size: 14px;/);
  assert.match(cssSource, /@media \(pointer: coarse\) \{\s*:root \{\s*--field-font-size: 16px;/);
  assert.doesNotMatch(cssSource, /max-width: 640px\) \{\s*:root \{\s*--field-font-size/);
  for (const primitive of [inputPrimitiveSource, textareaPrimitiveSource]) {
    assert.match(primitive, /text-\[length:var\(--field-font-size\)\]/);
  }
  assert.match(cssSource, /\.chat-input-textarea \{\s*font-size: var\(--field-font-size\);/);
});

test("keeps modal dialogs clear of the iOS status bar in standalone mode", () => {
  // The settings dialog floats inset from a phone's edges (.settings-card-safe)
  // inside the safe areas, and the stylesheet owns those insets with env();
  // iOS standalone's env() can report 0, so the @supports fallback insets with
  // device sizes instead.
  assert.match(settingsPanelSource, /settings-card-safe z-\[1000\]/);
  assert.match(settingsPanelSource, /h-\[84vh\] max-h-\[calc\(100dvh-16px\)\] w-\[min\(1080px,calc\(100vw-16px\)\)\] max-w-none/);
  assert.match(settingsCssSource, /@media \(max-width: 640px\) \{\s*\.settings-card-safe \{\s*inset: calc\(env\(safe-area-inset-top\) \+ 8px\) 8px calc\(env\(safe-area-inset-bottom\) \+ 8px\) 8px;/);
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{\s*\.settings-card-safe \{/);
  assert.match(settingsCssSource, /top: max\(67px, calc\(env\(safe-area-inset-top\) \+ 8px\)\);[\s\S]*?right: max\(16px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);[\s\S]*?bottom: max\(32px, calc\(env\(safe-area-inset-bottom\) \+ 8px\)\);[\s\S]*?left: max\(16px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/);
  assert.match(settingsCssSource, /@media \(display-mode: standalone\) and \(orientation: landscape\) \{\s*\.settings-card-safe \{[\s\S]*?top: max\(16px, calc\(env\(safe-area-inset-top\) \+ 8px\)\);[\s\S]*?right: max\(67px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);[\s\S]*?bottom: max\(16px, calc\(env\(safe-area-inset-bottom\) \+ 8px\)\);[\s\S]*?left: max\(67px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/);
  // The full-screen phone variant still safe-area pads the dialogs that fill
  // the screen (the trust dialog keeps it).
  assert.match(settingsCssSource, /@media \(max-width: 640px\) \{\s*\.settings-phone-safe \{\s*padding: env\(safe-area-inset-top\)/);
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{\s*\.settings-phone-safe \{/);
  // A config panel opened on its own stays capped to the viewport under the
  // same query: the shell's own utilities (ConfigPanelShell in SettingsUi)
  // fill the phone's screen under the safe areas, frameless.
  assert.match(settingsUiSource, /max-\[640px\]:bg-background max-\[640px\]:p-\[env\(safe-area-inset-top\)_env\(safe-area-inset-right\)_env\(safe-area-inset-bottom\)_env\(safe-area-inset-left\)\]/);
  assert.match(settingsUiSource, /max-\[640px\]:h-full max-\[640px\]:max-h-full max-\[640px\]:w-full max-\[640px\]:max-w-full max-\[640px\]:rounded-none max-\[640px\]:border-0 max-\[640px\]:shadow-none/);
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
  // Nothing in the composer area is hidden by the keyboard rules any more:
  // the pill row's hide dropped the send button to the row's left edge, and
  // the status shelf's hide made the bottom row vanish while typing.
  assert.doesNotMatch(cssSource, /html\[data-keyboard-open\] \.chat-input-controls/);
  assert.doesNotMatch(cssSource, /html\[data-keyboard-open\] \.extension-status-bar/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-content \{\s*padding-bottom: 0 !important;/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-input-shell \{\s*padding-bottom: 6px !important;/);
  // While streaming with an empty composer the main button stops the run.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.stopAgent"\)\}/);
  // A fresh composer's project bar goes too, in a rule of its own inside the same query.
  assert.match(newSessionBarSource, /<div className="new-session-context[ "]/);
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{[^@]*?html\[data-keyboard-open\] \.new-session-context \{\s*display: none !important;/);
  // Mobile send is icon-only but keeps an accessible name.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.send"\)\}/);
  assert.match(newSessionBarSource, /<div className="new-session-context[ "]/);
});

test("every .mcp-* rule in settings.css matches a class the MCP panel renders", () => {
  // The panels' presentation lives in their utility classes; the stylesheet
  // keeps only what a Card cannot carry (the Remove confirmation's z-index).
  // Every .mcp-* rule left must target a class the panel (its Sign-in row,
  // its add pane) renders, so a rename cannot leave a rule silently dead.
  const styled = new Set([...settingsCssSource.matchAll(/\.(mcp-[a-z-]+)/g)].map((match) => match[1]));
  const rendered = new Set([...`${mcpConfigSource}\n${mcpSignInSource}\n${mcpAddSource}`.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((match) => (match[1] ?? match[2]).split(/\s+/))
    .filter((name) => name.startsWith("mcp-")));
  for (const name of styled) assert.ok(rendered.has(name), `.mcp-${name} has no rendered class`);
});
