import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

// 弹窗通知统一走 sonner（2026-11-20）：自制的聊天列通知架（NoticeShelf）
// 与会话事件卡（SessionEventToast）已删除，addNotice / showSessionEventToast
// 直接发标准 sonner toast；手机端 toaster 顶部居中（底部是停靠的输入框）。

test("the bespoke chat-column notice shelf is gone; notices route through sonner", () => {
  assert.doesNotMatch(chatSource, /NoticeShelf/);
  assert.doesNotMatch(chatSource, /notice-shelf/);
  assert.doesNotMatch(chatSource, /data-search-target.*notice|notices,/);
  // addNotice 发 sonner：同一 id 替换不堆叠，error 常驻到手动关，其余 5s。
  assert.match(hookSource, /import \{ toast \} from "sonner";/);
  assert.match(
    hookSource,
    /toast\[type\]\(message, \{[\s\S]*?id: notice\.id \?\? `notice:[\s\S]*?duration: type === "error" \? Infinity : NOTICE_VISIBLE_MS,/, 
  );
  assert.match(hookSource, /const NOTICE_VISIBLE_MS = 5000;/);
});

test("session events show as standard sonner toasts with an open action", () => {
  // 自制会话事件卡组件与它的 import 已删；只剩 showSessionEventToast 这个函数名。
  assert.doesNotMatch(shellSource, /<SessionEventToast/);
  assert.doesNotMatch(shellSource, /from "\.\/SessionEventToast"/);
  assert.match(
    shellSource,
    /kind === "complete" \? toast\.success : toast\.warning\)\(/,
  );
  // 点击 action 打开会话；同会话稳定 id 替换。
  assert.match(shellSource, /id: `session-event:\$\{kind\}:\$\{target\.id\}`/);
  assert.match(shellSource, /onClick: \(\) => handleSelectSession\(target\)/);
});

test("the sonner toaster sits top-centre on mobile, bottom-right on desktop", () => {
  assert.match(
    shellSource,
    /<Toaster position=\{isMobile \? "top-center" : "bottom-right"\} \/>/,
  );
});
