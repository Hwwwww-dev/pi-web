import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  extensionStatusTone,
  isPermissiveStatusText,
  sanitizeExtensionStatusText,
  splitExtensionStatuses,
} = await jiti.import("@/lib/extension-status");
const { ExtensionStatusButton, PermissiveModeChip } = await jiti.import("./ExtensionStatus.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(node) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, node));
}

function renderStatusButton(...texts) {
  return render(
    React.createElement(ExtensionStatusButton, {
      statuses: texts.map((text, index) => ({ key: `status-${index}`, text })),
    }),
  );
}

test("sorts status entries by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.deepEqual(
    splitExtensionStatuses(statuses).statuses.map((status) => status.text),
    ["ponytail", "permissions", "memory", "notify"],
  );
});

test("preserves status line breaks while normalizing horizontal whitespace", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second\nthird",
  );
});

test("keeps the permissive flag out of the status list", () => {
  const { statuses, permissive } = splitExtensionStatuses([
    { key: "pi-lens", text: "json, marksman, opengrep" },
    { key: "pi-permission-system", text: "  YOLO\n" },
  ]);

  assert.equal(permissive, "YOLO");
  assert.deepEqual(statuses.map((status) => status.key), ["pi-lens"]);
  assert.equal(isPermissiveStatusText("yolomatic"), false);
  assert.equal(splitExtensionStatuses([{ key: "pi-lens", text: "ok" }]).permissive, null);
});

test("renders the permissive marker as a small uppercase chip", async () => {
  const html = render(React.createElement(PermissiveModeChip, { text: "yolo" }));
  const source = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");

  assert.match(html, />YOLO</);
  // The pill is styled with Tailwind utilities that compile with the component:
  // a stylesheet rule here once lagged the component and the marker fell back
  // to plain red text. Utilities keep that failure mode impossible.
  assert.match(source, /text-destructive/);
  assert.match(source, /variant="outline"/);
  assert.match(source, /border-destructive\/35/);
  assert.match(source, /bg-destructive\/\[0\.06\]/);
});

test("tones the status dot after the LSP state pi-lens reports", () => {
  const tone = (text) => extensionStatusTone([{ key: "pi-lens-lsp", text }]);

  assert.equal(tone("LSP Active: typescript, typos, ast-grep, opengrep"), "ok");
  assert.equal(tone("LSP Inactive"), "error");
  assert.equal(tone("LSP ✗"), "error");
  assert.equal(tone("LSP Active: typescript · LSP Failed: pyright"), "warning");
  assert.equal(tone("LSP Active: "), "error");
  assert.equal(tone("\u001b[32mLSP Active: typescript\u001b[0m"), "ok");
});

test("keeps another extension's status out of the label but in the tone", () => {
  assert.equal(extensionStatusTone([{ key: "subagents", text: "2 running, 1 queued agents" }]), "ok");
  assert.equal(
    extensionStatusTone([
      { key: "subagents", text: "2 running, 1 queued agents" },
      { key: "goal", text: "goal: unfocused [3 open] - /goal-focus" },
    ]),
    "ok",
  );
  assert.equal(
    extensionStatusTone([
      { key: "goal", text: "goal: unfocused [3 open] - /goal-focus" },
      { key: "pi-lens-lsp", text: "LSP Inactive" },
    ]),
    "error",
  );
  assert.equal(extensionStatusTone([]), null);
  assert.equal(extensionStatusTone([{ key: "pi-lens-lsp", text: "   " }]), null);
});

test("hides the status button while every extension status is empty", () => {
  assert.equal(renderStatusButton(), "");

  // The permissive flag has its own chip, so it is not a status entry.
  assert.equal(renderStatusButton("yolo"), "");
});

test("renders one umbrella label with the tone dot, popover closed", () => {
  const html = renderStatusButton("LSP Active: typescript");

  assert.match(html, /data-slot="popover-trigger"/);
  assert.match(html, /class="[^"]*h-8[^"]*text-muted-foreground/);
  // One line, never an ellipsis: the label is a single generic word.
  assert.match(html, /whitespace-nowrap/);
  assert.doesNotMatch(html, /text-ellipsis/);
  assert.match(html, /<span class="[^"]*data-\[tone=ok\]:bg-success[^"]*" data-tone="ok" aria-hidden="true"><\/span>/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /extension-status-popover/);
  assert.doesNotMatch(html, /data-state="open"/);
  // The label is one generic word, never the extension's own status text.
  assert.doesNotMatch(html, /LSP Active/);
});

test("marks a broken status line with the dot", () => {
  assert.match(renderStatusButton("LSP Inactive"), /data-\[tone=error\]:bg-destructive[^"]*" data-tone="error"/);
  assert.match(
    renderStatusButton("LSP Active: typescript · LSP Failed: pyright"),
    /data-\[tone=warning\]:bg-warning[^"]*" data-tone="warning"/,
  );
});

test("counts the reporting extensions on the label", () => {
  assert.doesNotMatch(renderStatusButton("LSP Inactive"), /· 1/);
  assert.match(renderStatusButton("LSP Inactive", "2 running, 1 queued agents"), /· 2/);
});

test("lists every status text in the popover without extension names", async () => {
  const source = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");

  // The panel is a Radix popover now; the entries are utility-styled rows.
  assert.match(source, /<PopoverContent/);
  assert.match(source, /"flex min-w-0 items-start gap-2"/);
  assert.match(source, /<pre className="m-0 min-w-0 overflow-x-auto overscroll-contain whitespace-pre-wrap">/);
  assert.match(source, /<AnsiText text=\{status\.text\} \/>/);
  // The popover carries the status text and nothing else — no extension key,
  // no name column, no right-aligned label.
  assert.doesNotMatch(source, /entry-key/);
  assert.doesNotMatch(source, />\{status\.key\}</);
  assert.doesNotMatch(source, /summarizeExtensionStatuses|LSP ✓/);
});

test("keeps the status label and the permissive chip in the composer's controls row", async () => {
  const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

  // The sidebar's duplicate in-row More button was removed (dedup): the top
  // bar's ⋯ owns overflow, and the row keeps upstream's controls toggle.
  const controlsIndex = chatInput.indexOf('aria-label={t("chat.moreControls")}');
  const statusIndex = chatInput.indexOf("<ExtensionStatusButton statuses=");
  const chipIndex = chatInput.indexOf("{permissiveStatus && <PermissiveModeChip");

  // Row order: 更多控件 → 扩展 → YOLO at the far right.
  assert.ok(controlsIndex > 0 && statusIndex > 0 && chipIndex > 0, "all three sit in the composer row");
  assert.ok(controlsIndex < statusIndex, "the controls toggle opens the row");
  assert.ok(statusIndex < chipIndex, "YOLO closes the row at the far right");
  assert.match(chatInput, /extensionStatuses\?: ExtensionStatusItem\[\]/);
  assert.match(chatWindow, /extensionStatuses=\{extensionStatuses\}/);
});

test("shelf carries widget triggers and the status line side by side", async () => {
  const widgetsSource = await readFile(new URL("./ExtensionWidgets.tsx", import.meta.url), "utf8");
  const barSource = await readFile(new URL("./ExtensionStatusBar.tsx", import.meta.url), "utf8");

  // The shelf carries both halves now: the widgets row embeds the status line
  // as its children, split by a vertical Separator.
  assert.match(barSource, /<ExtensionWidgets widgets=\{widgets\}>\{statusLine\}<\/ExtensionWidgets>/);
  assert.match(widgetsSource, /<Separator orientation="vertical"/);
});

test("scrolls status text sideways instead of wrapping it", async () => {
  const chipSource = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");

  // The panel's scroll budget lives on the Radix popover content now.
  assert.match(chipSource, /max-h-\[min\(320px,40dvh\)\]/);
  assert.match(chipSource, /overflow-auto overscroll-contain/);
  assert.match(chipSource, /side="top"/);
  assert.match(chipSource, /align="end"/);
  // The shelf's status text wraps (pre-wrap); only a popover entry scrolls sideways.
  assert.match(chipSource, /<pre className="m-0 min-w-0 overflow-x-auto overscroll-contain whitespace-pre-wrap">/);
  assert.doesNotMatch(chipSource, /wrap-anywhere/);
  // YOLO is a marker, not a control: its own red pill, styled with utilities
  // compiled with the component so a stale stylesheet cannot turn it back into
  // plain text or a button.
  assert.match(chipSource, /text-destructive/);
  assert.match(chipSource, /font-mono/);
  assert.match(chipSource, /border-destructive\/35/);
  assert.match(chipSource, /cursor-default/);
});

test("keeps the status button a compact single-line chip", async () => {
  const source = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");

  // The status chip is the same box as every other control in the row: one
  // height, radius and type size, flat until hover supplies a background.
  assert.match(source, /h-8 max-\[640px\]:h-\[34px\] gap-\[5px\] rounded-md px-2 text-xs leading-none text-muted-foreground/);
  assert.match(source, /hover:bg-secondary hover:text-foreground/);
  assert.match(source, /aria-expanded:bg-secondary aria-expanded:text-foreground/);
  assert.doesNotMatch(source, /text-ellipsis/);
  assert.match(source, /"size-\[7px\] shrink-0 rounded-full data-\[tone=ok\]:bg-success data-\[tone=warning\]:bg-warning data-\[tone=error\]:bg-destructive"/);
});
