/**
 * The design-language gate (docs/specs/design-language-alignment.md 第 6 节).
 *
 * The point is not style policing for its own sake: every rule here is a shape
 * the official components already provide, so a hand-rolled version means two
 * sources of truth for the same look. This test fails when one sneaks back in.
 *
 * Allowed on purpose: `components/ui/**` (official source, never edited),
 * `demo/**` (a byte copy), markdown/ANSI rendering (it must show text as data),
 * the `--brand-*` / `--terminal-*` palettes, table and diff grids (their cells
 * are one grid, not stacked panels), and theme swatches (they preview the color
 * they name).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SCANNED_DIRS = ["components", "app", "hooks", "lib"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(path, out);
    } else if (/\.(tsx?|mjs)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function sourceFiles() {
  return SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
    .map((path) => relative(ROOT, path))
    // Official components are the source of truth; the demo is a copy of them.
    .filter((path) =>
      !path.startsWith("components/ui/") &&
      !path.startsWith("demo/") &&
      // The gate quotes the patterns it bans.
      path !== "lib/design-language.test.mjs")
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
}

/** Every line of a file, with its 1-based number. */
function lines(file) {
  return file.text.split("\n").map((text, index) => ({ path: file.path, line: index + 1, text }));
}

function offenders(pattern, allow) {
  return sourceFiles().flatMap((file) =>
    lines(file)
      .filter((entry) => pattern.test(entry.text) && !(allow && allow(entry.text, entry.path)))
      .map((entry) => `${entry.path}:${entry.line}: ${entry.text.trim()}`));
}

test("a surface that paints a background uses the official radius", () => {
  // Square is legal where nothing is drawn (a list row inside a sheet, a tab
  // segment inside the TabsList track, a skeleton filling its row). It is not
  // legal on a surface that paints its own background: that surface is a card,
  // and cards take the official radius.
  const found = offenders(/(?<![-\w])(?<!:)\brounded-(?:t-)?none\b/, (line, path) =>
    // A bare bg-* paints the element itself; hovers and states are not a surface.
    !/(?<![\w:-])bg-(?!transparent)/.test(line) ||
    // A mobile full-screen sheet has no corner to round, diff cells are a grid,
    // and the terminal's own chrome is painted from its own palette.
    path === "components/PatchDiffFiles.tsx" ||
    path === "components/SettingsUi.tsx" ||
    line.includes("--terminal-"));
  assert.deepEqual(found, []);
});

test("no border-r panel dividers", () => {
  const found = offenders(/(?<![-\w])border-r(?![-\w])/, (_line, path) =>
    // One grid's cell separators, not stacked panels.
    path === "components/DelimitedTable.tsx" || path === "components/PatchDiffFiles.tsx");
  assert.deepEqual(found, []);
});

test("no color-mix outside the brand and terminal palettes", () => {
  const found = offenders(/color-mix\(/, (line, path) =>
    path === "app/globals.css" && /--(brand|terminal)-/.test(line));
  assert.deepEqual(found, []);
});

test("no inset shadows", () => {
  assert.deepEqual(offenders(/shadow-\[inset/), []);
});

test("no inline hex colors outside swatches and palettes", () => {
  const found = offenders(/#[0-9a-fA-F]{6}\b/, (line, path) => {
    const trimmed = line.trim();
    return (
      // A swatch has to show the color it names; the ANSI palette maps one to one.
      path === "components/SettingsPanel.tsx" ||
      // The thinking-level scale is a fixed six-step palette with no token set.
      path === "components/ModelsConfig.tsx" ||
      path === "app/globals.css" ||
      // Server routes emit standalone documents (an exported/printed page), not app chrome.
      path.startsWith("app/api/") ||
      // A browser reads theme-color, the manifest and the favicon canvas before CSS exists.
      path === "app/layout.tsx" ||
      path === "app/manifest.webmanifest/route.ts" ||
      path === "lib/favicon-badge.ts" ||
      // xterm takes colors as strings, so the terminal palette is literal too.
      path === "lib/terminal-theme.ts" ||
      path === "components/TerminalPanel.tsx" ||
      // Test fixtures carry the sample markup they assert on.
      path.endsWith(".test.mjs") ||
      // Comments explain what was replaced, never paint anything.
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      /--(brand|terminal|ansi)-/.test(line) ||
      line.includes("`")
    );
  });
  assert.deepEqual(found, []);
});

// ── 第 14 节验收：自制分割线行、自制胶囊、任意字号、内联布局 ──────────────

test("no border-t / border-b list dividers", () => {
  // A row divider is the shape `Separator` (or plain spacing) already provides.
  // A grid's cell edges are one grid, not stacked panels.
  // A pane's own edge (app header, dialog header/footer, popover's bottom edge,
  // terminal chrome) is the surface's boundary, not a divider between rows.
  const found = offenders(/(?<![-\w])border-[tb](?![-\w])/, (line, path) =>
    path.endsWith(".test.mjs") ||
    path === "components/DelimitedTable.tsx" ||
    path === "components/PatchDiffFiles.tsx" ||
    path === "components/TerminalPanel.tsx" ||
    path.startsWith("app/api/") ||
    /safe-area-inset-top|directory-picker|enabled-models-banner|border-0 border-b/.test(line));
  assert.deepEqual(found, []);
});

test("no hand-rolled pills (a rounded-full surface painting its own background)", () => {
  // A status dot is a light, not a label: no text, no padding, a tiny box.
  const isDot = (line) =>
    /\bsize-(?:[\?[0-9.]+px\]?|[12](?:\.5)?)\b/.test(line) && !/\bpx-|\bpy-/.test(line);
  const found = offenders(/(?<![\-\w])rounded-full(?![\-\w])/, (line, path) =>
    path.endsWith(".test.mjs") ||
    isDot(line) || !/(?<![\w:-])bg-(?!(?:current|transparent|inherit)\b)/.test(line));
  assert.deepEqual(found, []);
});

test("no arbitrary font sizes", () => {
  // The `length:calc(…--chat-font-size-offset…)` form is the chat's own font-size
  // control, not a fixed size someone picked by eye.
  const found = offenders(/text-\[[^\]]*\]/, (line, path) =>
    path.endsWith(".test.mjs") ||
    line.includes("--chat-font-size-offset"));
  assert.deepEqual(found, []);
});

test("no inline layout styles", () => {
  // A layout that lives in a `style` object is a second source of truth beside
  // the utility classes. Dynamic geometry (a virtualized row's transform, a
  // zoom factor, an xterm size) is the only thing that has to be inline.
  // Interpolated values and CSS custom properties are data, not a layout
  // decision: a measured width, a drag offset, a zoom factor have nowhere else
  // to live. A literal in a style object does.
  // Only a literal is a layout decision: `style={{ width: 300 }}` and
  // `style={{ padding: "12px" }}` restate a class. A variable, an interpolation
  // or a CSS custom property is data the layout reads.
  const literalLayout = /:\s*(?:-?\d+(?:\.\d+)?\s*[,}]|"[^"]*(?:px|%|rem|em|vh|vw)")/;
  const found = offenders(/style=\{\{/, (line, path) =>
    path.startsWith("app/api/") ||
    line.includes("${") ||
    !literalLayout.test(line) ||
    // A value computed from props/state (tree depth, measured width) is data.
    /:\s*[A-Za-z_$][\w$.]*\s*(?:\?|[+\-*/]|[,}])/.test(line) ||
    // Bidi isolation for a path needs the CSS property itself.
    path === "components/PathLabel.tsx");
  assert.deepEqual(found, []);
});
