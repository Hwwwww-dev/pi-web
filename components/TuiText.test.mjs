import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("./TuiText.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const agentSessionHook = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const terminalTrace = await readFile(new URL("./transcript/TerminalTrace.tsx", import.meta.url), "utf8");
const toolTrace = await readFile(new URL("./transcript/ToolTrace.tsx", import.meta.url), "utf8");

test("terminal text renders as an unwrapped, scrolled block", () => {
  assert.match(component, /"tui-text"/);
  assert.match(css, /\.tui-text \{[\s\S]{0,220}overflow: auto;/);
  assert.match(css, /\.tui-text \{[\s\S]{0,220}white-space: pre;/);
});

test("notifications, dialog titles and option previews fall back to terminal rendering", () => {
  // 通知本身走 sonner（ChatWindow.notices.test.mjs）：发送前剥 ANSI；对话框标题、
  // 自定义面板正文与富文本 segment 仍在 ChatWindow 里按终端文本渲染。
  assert.match(chatWindow, /isTuiText\(segment\.markdown\) \? \(/);
  assert.match(chatWindow, /if \(isTuiText\(body\)\) \{/);
  assert.match(chatWindow, /<TuiText text=\{body\}/);
  const hook = agentSessionHook;
  assert.match(hook, /const message = stripAnsi\(notice\.message\)\.trim\(\);/);
});

test("tool results stop reflowing when they are terminal output", () => {
  assert.match(terminalTrace, /isTuiText\(output\)/);
  // 换行选择按 foldKey 持久化（transcript 重设计后默认换行，不再默认免 reflow）。
  assert.match(terminalTrace, /const \[wrap, setWrap\] = useState\(\(\) => getFoldChoice\(wrapKey\) \?\? true\)/);
  assert.match(terminalTrace, /wrap \? "whitespace-pre-wrap break-words" : "whitespace-pre"/);
  // 其它代码段默认换行（参数/结果），终端是例外。
  assert.match(toolTrace, /wrap = true/);
});
