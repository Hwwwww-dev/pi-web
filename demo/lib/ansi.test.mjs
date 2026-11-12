import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./ansi.ts");
}

test("strips ANSI escape sequences", async () => {
  const { stripAnsi } = await loadSubject();

  assert.equal(stripAnsi("\x1b[31mred\x1b[0m plain"), "red plain");
  assert.equal(stripAnsi("answer\x1b_pi:c\x07"), "answer");
});

test("normalizes boxed custom panel lines while preserving ANSI codes", async () => {
  const { normalizeCustomPanelLines, stripAnsi } = await loadSubject();
  const lines = [
    "┌──────┐",
    "│ \x1b[32mOK\x1b[0m   │",
    "└──────┘",
  ];

  const normalized = normalizeCustomPanelLines(lines);

  assert.equal(normalized.length, 1);
  assert.equal(stripAnsi(normalized[0]), "OK");
  assert.match(normalized[0], /\x1b\[32m/);
});

test("removes pi-tui cursor markers from custom panel output", async () => {
  const { normalizeCustomPanelLines } = await loadSubject();

  assert.deepEqual(normalizeCustomPanelLines(["> value\x1b_pi:c\x07"]), ["> value"]);
});

test("isTuiText accepts terminal layouts and rejects prose", async () => {
  const { isTuiText } = await loadSubject();

  // Box art, tables and progress bars all carry their meaning in the layout.
  assert.equal(isTuiText("┌──────┐\n│ done │\n└──────┘"), true);
  assert.equal(isTuiText("████░░░░ 40%"), true);
  assert.equal(isTuiText("⠋ loading\n⠙ loading"), true);
  assert.equal(isTuiText("name        count\nfoo         3\nbar         7"), true);
  assert.equal(isTuiText("===================="), true);
  assert.equal(isTuiText("▲ rpiv-todos LSP Active: typescript"), true);

  // Prose, single-line values and empty output keep wrapping.
  assert.equal(isTuiText(""), false);
  assert.equal(isTuiText("Build finished in 3.2s"), false);
  assert.equal(isTuiText("第一行\n第二行\n第三行"), false);
  assert.equal(isTuiText("a  b"), false);
});
