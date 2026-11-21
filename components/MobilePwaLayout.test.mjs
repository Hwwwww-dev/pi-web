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
  // 主列/右列用 h-full（百分比链到壳层），不再写死 dvh：键盘期 dvh 缩矮，
  // 内容不跟着钉高走，iOS 原生滚动滚到的下半截就是空白（白屏）。
  assert.match(appShellSource, /flex h-full flex-col bg-background/);
  assert.match(appShellSource, /h-full min-w-0 overflow-hidden/);
  assert.doesNotMatch(appShellSource, /h-\[100dvh\] min-w-0/);
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{[^@]*?\.app-shell \{[^}]*?height: var\(--keyboard-full-height, 100dvh\);[^}]*?min-height: 0;/);
  // 壳层的 min-h-svh（svh 不随键盘缩小）必须在移动端被压掉，否则最小高度把
  // 壳层撑到水位之上、文档滚动量失真。
  assert.match(cssSource, /@media \(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\) \{[^@]*?\.app-shell \{[^}]*?min-height: 0;/);
  assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", handleFocusChange\)/);
  assert.match(viewportHookSource, /data-keyboard-open|dataset\.keyboardOpen/);
  assert.match(viewportHookSource, /isKeyboardPeriod/);
  // 位移与过渡已全部废弃：iOS 会原生滚动 scrollView 推页头，任何 transform 都
  // 会让滚到的窗口下半变成空白（白屏）。断言壳层上不存在任何位移与过渡。
  assert.doesNotMatch(cssSource, /\.app-shell \{[^}]*transform/);
  assert.doesNotMatch(cssSource, /\.app-shell \{[^}]*transition: transform/);
  assert.doesNotMatch(viewportHookSource, /--keyboard-lift/);
  assert.doesNotMatch(viewportHookSource, /translate3d/);
  assert.doesNotMatch(viewportHookSource, /--app-viewport-height/);
  assert.doesNotMatch(viewportHookSource, /scrollTo\(/);
  // 高度钉在 px 全高水位上：文档比缩小后的视口多出键盘那一截，iOS 才有原生
  // 滚动余地推页头；绝不能让高度跟随 dvh 缩（无处可滚，页头永远钉顶）。
  assert.match(viewportHookSource, /--keyboard-full-height/);
  assert.match(cssSource, /html, body \{[\s\S]*?height: 100dvh;[\s\S]*?\}/);
  // scoped to the html,body block itself: later blocks legitimately size from
  // --app-viewport-height
  assert.doesNotMatch(cssSource, /html, body \{[^}]*height: var\(--app-viewport-height/);
  assert.match(cssSource, /html\[data-keyboard-open\] body \{[^}]*height: var\(--keyboard-full-height/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.app-shell \{[^}]*height: var\(--keyboard-full-height/);
  assert.doesNotMatch(cssSource, /\.app-chat-shift/);
  // 推上去靠 iOS 原生滚动，不动页头本身（收高度/位移都不许）。
  assert.doesNotMatch(cssSource, /html\[data-keyboard-open\] \.app-top-bar/);
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
  // The chat content region is the horizontal clamp: overflow-hidden on the
  // h-full column (the old overflow-x-hidden scroller class is gone).
  assert.match(chatWindowSource, /className="chat-content relative flex h-full min-w-0 flex-col overflow-hidden/);
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
  // The settings dialog floats centered, sized to the phone's usable area
  // (.settings-card-safe): DialogContent owns the centering (its entrance
  // animation uses translate, so the stylesheet only clamps the size, no
  // insets). iOS standalone's env() can report 0, so the @supports fallback
  // caps the height with device sizes instead.
  assert.match(settingsPanelSource, /settings-card-safe z-\(--z-modal\)/);
  assert.match(settingsPanelSource, /h-\[84vh\] max-h-\[calc\(100dvh-16px\)\] w-\[min\(1160px,calc\(100vw-16px\)\)\] max-w-none/);
  assert.match(settingsCssSource, /@media \(max-width: 640px\) \{\s*\.settings-card-safe \{[\s\S]*?width: calc\(100vw - 16px\);[\s\S]*?height: 80dvh;[\s\S]*?max-height: none;/);
  assert.match(settingsCssSource, /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{\s*\.settings-card-safe \{\s*max-height: calc\(100dvh - max\(67px, env\(safe-area-inset-top\)\) - max\(32px, env\(safe-area-inset-bottom\)\)\);/);
  // The full-screen phone variant still safe-area pads the dialogs that fill
  // the screen (the trust dialog keeps it).
  assert.match(settingsCssSource, /@media \(max-width: 640px\) \{[\s\S]*?\.settings-phone-safe \{\s*padding: env\(safe-area-inset-top\)/);
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
  assert.match(extensionStatusBarSource, /className=\{`extension-status-bar relative /);
  assert.match(chatWindowSource, /className="chat-content /);
  // Phone landscape exceeds the 640px breakpoint but has the least height.
  // Nothing is hidden by the keyboard rules any more: the pill row's hide
  // dropped the send button to the row's left edge, the status shelf's hide
  // made the bottom row vanish while typing, and a fresh composer's project
  // bar hid its branch picker on every focus.
  assert.doesNotMatch(cssSource, /html\[data-keyboard-open\] \.chat-input-controls/);
  assert.doesNotMatch(cssSource, /html\[data-keyboard-open\] \.extension-status-bar/);
  assert.doesNotMatch(cssSource, /html\[data-keyboard-open\] \.new-session-context/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-content \{\s*padding-bottom: 0 !important;/);
  assert.match(cssSource, /html\[data-keyboard-open\] \.chat-input-shell \{\s*padding-bottom: 6px !important;/);
  // While streaming with an empty composer the main button stops the run.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.stopAgent"\)\}/);
  // Mobile send is icon-only but keeps an accessible name.
  assert.match(chatInputSource, /aria-label=\{t\("chat\.send"\)\}/);
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
