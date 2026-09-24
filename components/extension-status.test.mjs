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
  // The pill is styled inline: a CSS rule here once lagged the component and the
  // marker fell back to plain red text.
  assert.match(source, /color: "#dc2626"/);
  assert.match(source, /borderRadius: 4/);
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

  assert.match(html, /class="extension-status-button-root"/);
  assert.match(html, /class="composer-chip"/);
  assert.match(html, /<span class="extension-status-dot" data-tone="ok" aria-hidden="true"><\/span>/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /extension-status-popover/);
  assert.doesNotMatch(html, /<svg/);
  // The label is one generic word, never the extension's own status text.
  assert.doesNotMatch(html, /LSP Active/);
});

test("marks a broken status line with the dot", () => {
  assert.match(renderStatusButton("LSP Inactive"), /class="extension-status-dot" data-tone="error"/);
  assert.match(
    renderStatusButton("LSP Active: typescript · LSP Failed: pyright"),
    /class="extension-status-dot" data-tone="warning"/,
  );
});

test("counts the reporting extensions on the label", () => {
  assert.doesNotMatch(renderStatusButton("LSP Inactive"), /· 1/);
  assert.match(renderStatusButton("LSP Inactive", "2 running, 1 queued agents"), /· 2/);
});

test("lists every status text in the popover without extension names", async () => {
  const source = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");

  assert.match(source, /className="extension-status-popover"/);
  assert.match(source, /className="extension-status-entry"/);
  assert.match(source, /<pre className="extension-status-entry-text">/);
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

  const moreIndex = chatInput.indexOf('{t("chat.moreControls")}');
  const statusIndex = chatInput.indexOf("<ExtensionStatusButton statuses=");
  const chipIndex = chatInput.indexOf("{permissiveStatus && <PermissiveModeChip");

  // Row order: controls → 扩展 → 更多(移动端) → YOLO at the far right.
  assert.ok(statusIndex > 0 && moreIndex > 0 && chipIndex > 0, "all three sit in the composer row");
  assert.ok(statusIndex < moreIndex, "the status chip sits before the mobile More button");
  assert.ok(moreIndex < chipIndex, "YOLO closes the row at the far right");
  assert.match(chatInput, /extensionStatuses\?: ExtensionStatusItem\[\]/);
  assert.match(chatWindow, /extensionStatuses=\{extensionStatuses\}/);
});

test("leaves no status line behind in the shelf", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const shelfRule = css.match(/^\.extension-status-shelf\s*\{([^}]*)\}/m)?.[1] ?? "";
  const triggersRule = css.match(/^\.extension-widget-triggers\s*\{([^}]*)\}/m)?.[1] ?? "";

  // The shelf only ever carries widget triggers now, so nothing shares the row
  // with them and the fixed 55%/240px split is gone.
  assert.match(shelfRule, /flex-wrap:\s*wrap/);
  assert.match(triggersRule, /flex:\s*1 1 100%/);
  assert.doesNotMatch(css, /^\.extension-status-line|^\.extension-status-text|^\.extension-status-warning/m);
  assert.doesNotMatch(css, /has-widgets\.has-status/);
});

test("scrolls status text sideways instead of wrapping it", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const popoverRule = css.match(/^\.extension-status-popover\s*\{([^}]*)\}/m)?.[1] ?? "";
  const textRule = css.match(/^\.extension-status-entry-text\s*\{([^}]*)\}/m)?.[1] ?? "";
  const chipSource = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");

  assert.match(popoverRule, /max-height:/);
  assert.match(popoverRule, /overflow:\s*auto/);
  assert.match(popoverRule, /bottom:\s*calc\(100% \+ 6px\)/);
  assert.match(textRule, /white-space:\s*pre\s*;/);
  assert.match(textRule, /overflow-x:\s*auto/);
  assert.doesNotMatch(textRule, /overflow-wrap:\s*anywhere/);
  // YOLO is a marker, not a control: its own red pill, styled inline so a stale
  // stylesheet cannot turn it back into plain text or a button.
  assert.match(chipSource, /color: "#dc2626"/);
  assert.match(chipSource, /fontFamily: "var\(--font-mono\)"/);
  assert.match(chipSource, /border: "1px solid color-mix\(in srgb, #dc2626 35%, transparent\)"/);
  assert.match(chipSource, /cursor: "default"/);
});

test("keeps the status button a compact single-line chip", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("./ExtensionStatus.tsx", import.meta.url), "utf8");
  const chipRule = css.match(/^\.composer-chip\s*\{([^}]*)\}/m)?.[1] ?? "";
  const dotRule = css.match(/^\.extension-status-dot\s*\{([^}]*)\}/m)?.[1] ?? "";

  // The status chip is the same box as every other control in the row.
  assert.match(source, /className="composer-chip"/);
  assert.match(chipRule, /height:\s*32px/);
  assert.match(chipRule, /white-space:\s*nowrap/);
  assert.match(chipRule, /border-radius:\s*8px/);
  // Flat by design: a box per control is what made the row look like a wall of
  // buttons; hover supplies the only background.
  assert.match(chipRule, /background:\s*none/);
  assert.match(chipRule, /border:\s*0/);
  assert.doesNotMatch(chipRule, /text-overflow/);
  assert.match(dotRule, /border-radius:\s*50%/);
  assert.match(css, /\.extension-status-dot\[data-tone="error"\]\s*\{\s*background:\s*#dc2626;\s*\}/);
});
