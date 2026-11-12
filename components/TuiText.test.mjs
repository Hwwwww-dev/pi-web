import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("./TuiText.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const terminalTrace = await readFile(new URL("./transcript/TerminalTrace.tsx", import.meta.url), "utf8");
const toolTrace = await readFile(new URL("./transcript/ToolTrace.tsx", import.meta.url), "utf8");

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
  // 第 8 节第 8 条：终端输出默认不 reflow，行头提供换行开关。
  assert.match(terminalTrace, /isTuiText\(output\)/);
  assert.match(terminalTrace, /const \[wrap, setWrap\] = useState\(false\)/);
  assert.match(terminalTrace, /<CodeBlockContent wrap=\{wrap\}/);
  // 其它代码段默认换行（参数/结果），终端是例外。
  assert.match(toolTrace, /wrap = true/);
});
