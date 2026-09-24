import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PathLabel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("path labels ellipsize on the left and keep the path itself left-to-right", () => {
  // direction: rtl moves the ellipsis to the left edge, so the trailing segments
  // stay visible; the inner plaintext isolation stops bidi reordering the path.
  assert.match(css, /\.path-label \{\n  display: block;[\s\S]{0,260}direction: rtl;[\s\S]{0,160}text-overflow: ellipsis;/);
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
    "SessionSidebar.tsx",
    "SkillsConfig.tsx",
    "AgentsConfig.tsx",
  ];
  for (const file of renderers) {
    const text = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(text, /from "\.\/PathLabel"/, `${file} imports PathLabel`);
    assert.match(text, /<PathLabel/, `${file} renders PathLabel`);
  }
  // The sidebar no longer keeps its own copy of the trick.
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sidebar, /function PathLabel\(/);
});
