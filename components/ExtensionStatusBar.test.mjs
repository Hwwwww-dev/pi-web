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
  ExtensionStatusBar,
  formatExtensionStatusLine,
  isWarningStatusText,
  sanitizeExtensionStatusText,
} = await jiti.import("./ExtensionStatusBar.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderStatusBar(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionStatusBar, props),
    ),
  );
}

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("preserves status line breaks while normalizing horizontal whitespace", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second\nthird",
  );
});

test("preserves explicit status lines without wrapping and scrolls long or tall output", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const statusLineRule = css.match(/^\.extension-status-line\s*\{([^}]*)\}/m)?.[1] ?? "";
  const statusTextRule = css.match(/^\.extension-status-text\s*\{([^}]*)\}/m)?.[1] ?? "";

  assert.match(statusLineRule, /max-height:/);
  assert.match(statusLineRule, /align-items:\s*flex-start/);
  assert.match(statusLineRule, /overflow:\s*auto/);
  assert.match(statusTextRule, /white-space:\s*pre\s*;/);
  assert.doesNotMatch(statusTextRule, /overflow[^:]*:\s*hidden/);
  assert.doesNotMatch(statusTextRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(statusTextRule, /text-overflow:\s*ellipsis/);
});

test("renders a single status line without identifier keys", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
      { key: "05-ponytail", text: "ponytail" },
    ],
  });

  assert.match(html, /aria-label="ponytail memory"/);
  assert.match(html, /extension-status-shelf/);
  assert.match(html, /extension-status-line/);
  assert.match(html, /extension-status-text/);
  assert.match(html, /extension-status-text"><span>ponytail<\/span> <span><span style=/);
  assert.match(html, />memory</);
  assert.doesNotMatch(html, /05-ponytail|20-memory/);
});

test("marks a permissive-mode status as a warning", () => {
  assert.equal(isWarningStatusText("yolo"), true);
  assert.equal(isWarningStatusText("  YOLO\n"), true);
  assert.equal(isWarningStatusText("yolomatic"), false);

  const html = renderStatusBar({
    statuses: [
      { key: "pi-lens", text: "json, marksman, opengrep" },
      { key: "pi-permission-system", text: "yolo" },
    ],
  });

  // The joined line stays the accessible text, and only the warning word
  // carries the red class — the statuses before it stay muted.
  assert.match(html, /aria-label="json, marksman, opengrep yolo"/);
  assert.match(html, /<span class="extension-status-warning"><span>yolo<\/span><\/span>/);
  assert.match(html, /extension-status-text"><span>json, marksman, opengrep<\/span>/);
  assert.doesNotMatch(html, /extension-status-warning"><span><span/);
});

test("keeps the status glyphs clear of the scrollbar", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const statusLineRule = css.match(/^\.extension-status-line\s*\{([^}]*)\}/m)?.[1] ?? "";
  const warningRule = css.match(/^\.extension-status-warning\s*\{([^}]*)\}/m)?.[1] ?? "";

  // An overlay scrollbar floats over the content box on macOS, so the line
  // reserves room for it below the text; a phone has to fit both the chips and
  // the text, so the inline padding stays tight.
  assert.match(statusLineRule, /padding:\s*8px 12px 13px/);
  assert.match(warningRule, /color:\s*#dc2626/);
});

test("renders widgets and status text in one footer", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{
      key: "usage",
      lines: ["42%"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-status-shelf has-widgets has-status/);
  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /usage/);
  assert.match(html, /connected/);
});

test("status text keeps its share of the shelf beside widget triggers", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Fixed 108px triggers used to take up to 70% of the shelf and squeezed the
  // status text into whatever was left. Both sides now share the row, and the
  // status line wraps onto its own row once 240px no longer fit beside them.
  const triggersRule = css.match(/^\.extension-status-shelf\.has-widgets\.has-status \.extension-widget-triggers\s*\{([^}]*)\}/m)?.[1] ?? "";
  const statusRule = css.match(/^\.extension-status-shelf\.has-widgets\.has-status \.extension-status-line\s*\{([^}]*)\}/m)?.[1] ?? "";

  assert.match(triggersRule, /flex:\s*1 1 55%/);
  assert.doesNotMatch(triggersRule, /max-width:\s*70%/);
  assert.match(statusRule, /flex:\s*1 1 240px/);
});

test("a phone keeps the shelf to one row and floats the panel above it", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const narrow = css.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  // One row on a phone: the shelf never wraps and the status text takes what is
  // left of the row beside the chips.
  assert.match(narrow, /\.extension-status-shelf \{\n    position: relative;\n    flex-wrap: nowrap;/);
  assert.match(narrow, /has-status \.extension-widget-triggers \{\n    flex: 0 1 auto;\n    max-width: 45%;/);
  assert.match(narrow, /has-status \.extension-status-line \{\n    flex: 1 1 auto;\n    min-width: 0;/);
  // The panel covers the chat instead of pushing it up.
  assert.match(narrow, /\.extension-widget-panels \{\n    position: absolute;\n    inset: auto 0 100% 0;/);
  assert.match(narrow, /border-radius: 8px 8px 0 0;/);
  assert.match(css, /\.extension-widget-trigger:last-child \{[\s\S]{0,120}border-right: 0;/);
});

test("widget panels keep box drawing intact instead of wrapping it", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Widget output is monospace art (tables, progress bars, frames); wrapping
  // rows shorter broke the alignment, so wide lines scroll instead.
  const contentRule = css.match(/^\.extension-widget-content\s*\{([^}]*)\}/m)?.[1] ?? "";

  assert.match(contentRule, /white-space:\s*pre\s*;/);
  assert.match(contentRule, /overflow-x:\s*auto/);
  assert.doesNotMatch(contentRule, /overflow-wrap:\s*anywhere/);
});
