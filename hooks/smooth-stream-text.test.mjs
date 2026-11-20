import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// 活跃回合的折叠行标题在段重组、列表重读里会整体重挂载：打字机进度若只存在
// 组件状态里，一重挂载就贴齐全文，看起来就是“整段蹦出来、没有打字机”。
// 所以进度按 progressKey 存模块里，重挂载接着吐。
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useSmoothStreamText } = await jiti.import("./useSmoothStreamText.ts");

let frames = [];
globalThis.requestAnimationFrame = (callback) => {
  frames.push(callback);
  return frames.length;
};
globalThis.cancelAnimationFrame = (id) => {
  frames[id - 1] = null;
};

function pump() {
  for (let round = 0; round < 400 && frames.some(Boolean); round += 1) {
    const batch = frames;
    frames = [];
    for (const callback of batch) callback?.(0);
  }
}

test("without a progress key a remount starts from the full text (no replay)", () => {
  const hook = () => useSmoothStreamText("已经写好的思考", true);
  assert.equal(renderHook(hook).result, "已经写好的思考");
  assert.equal(renderHook(hook).result, "已经写好的思考");
});

test("a progress key carries the typed position across a remount", () => {
  const hook = ({ text }) => useSmoothStreamText(text, true, "continuity");
  const first = renderHook(hook, { text: "abcdefghijklmnop" });
  assert.equal(first.result, "", "首帧从头吐，不整段蹦出");
  pump();
  first.unmount();

  frames = [];
  const second = renderHook(hook, { text: "abcdefghijklmnopQRST" });
  assert.ok(second.result.length > 0, "重挂载接着上次进度，不从零开始");
  assert.ok(second.result.length < "abcdefghijklmnopQRST".length, "重挂载后仍在吐字");
  pump();
  second.rerender();
  assert.equal(second.result, "abcdefghijklmnopQRST");
});

test("a completed block ignores the animated state and shows the whole text", () => {
  const hook = ({ text, active }) => useSmoothStreamText(text, active, "settled");
  const running = renderHook(hook, { text: "abc", active: true });
  assert.equal(running.result, "");
  running.rerender({ text: "abc", active: false });
  assert.equal(running.result, "abc");
});
