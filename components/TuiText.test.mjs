import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("./TuiText.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const activityRows = await readFile(new URL("./ActivityRows.tsx", import.meta.url), "utf8");

test("terminal text renders as an unwrapped, scrolled block", () => {
  assert.match(component, /"tui-text"/);
  assert.match(css, /\.tui-text \{[\s\S]{0,220}overflow: auto;/);
  assert.match(css, /\.tui-text \{[\s\S]{0,220}white-space: pre;/);
});

test("notifications, dialog titles and option previews fall back to terminal rendering", () => {
  assert.match(chatWindow, /isTuiText\(notice\.message\) \? \(/);
  assert.match(chatWindow, /isTuiText\(segment\.markdown\) \? \(/);
  assert.match(chatWindow, /if \(isTuiText\(body\)\) \{/);
  assert.match(chatWindow, /<TuiText text=\{body\}/);
});

test("tool results stop reflowing when they are terminal output", () => {
  assert.match(activityRows, /const tui = isTuiText\(text\);/);
  assert.match(activityRows, /whiteSpace: tui \? "pre" : "pre-wrap"/);
});
