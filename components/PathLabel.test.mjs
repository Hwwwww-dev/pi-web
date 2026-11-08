import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PathLabel.tsx", import.meta.url), "utf8");

test("path labels ellipsize on the left and keep the path itself left-to-right", () => {
  // direction: rtl moves the ellipsis to the left edge, so the trailing segments
  // stay visible; the inner plaintext isolation stops bidi reordering the path.
  assert.match(source, /\[direction:rtl\]/);
  assert.match(source, /\[text-overflow:ellipsis\]/);
  assert.match(source, /text-left/);
  assert.match(source, /unicodeBidi: "plaintext"/);
  // The hidden head stays reachable.
  assert.match(source, /title=\{title \?\? text\}/);
});

test("every path display that can truncate renders the shared label", async () => {
  const renderers = [
    "FileViewer.tsx",
    "FileToolbar.tsx",
    "GitPanel.tsx",
    "TerminalPanel.tsx",
    "SkillsConfig.tsx",
    "AgentsConfig.tsx",
  ];
  for (const file of renderers) {
    const text = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(text, /from "\.\/PathLabel"/, `${file} imports PathLabel`);
    assert.match(text, /<PathLabel/, `${file} renders PathLabel`);
  }
  // The project/worktree picker is main's component: it keeps its own ~
  // shortening (displayPath) instead of the shared label.
  const picker = await readFile(new URL("./ProjectWorktreePicker.tsx", import.meta.url), "utf8");
  assert.match(picker, /function displayPath\(/);
  // The sidebar no longer keeps its own copy of the trick.
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sidebar, /function PathLabel\(/);
});
