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
