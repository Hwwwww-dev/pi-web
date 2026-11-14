// 窗口按整轮切（turns）：一次请求拿到的是完整的几轮，起点永远落在用户消息这类
// 锚点上。按条数切会把某一轮劈成两半——被劈开的头渲染成扁平活动行，没有折叠行
// 也没有用量行，读者看到的就是「回复完了却没有用量」。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");

/** `turnSizes[t]` 是第 t 轮的助手消息条数；每轮以用户消息开头。 */
function turns(turnSizes) {
  const entries = [];
  let parentId = null;
  let second = 0;
  turnSizes.forEach((assistants, turn) => {
    const push = (entry) => {
      entries.push({ ...entry, id: entry.id, parentId, timestamp: new Date(second++ * 1000).toISOString() });
      parentId = entry.id;
    };
    push({ id: `u${turn}`, type: "message", message: { role: "user", content: `提问 ${turn}` } });
    for (let i = 0; i < assistants; i++) {
      push({
        id: `a${turn}_${i}`, type: "message",
        message: { role: "assistant", content: [{ type: "text", text: `答复 ${turn}.${i}` }] },
      });
    }
  });
  return entries;
}

const ids = (context) => context.entryIds;

test("a page is the last N whole turns and starts on a user message", () => {
  const entries = turns([2, 2, 2, 2, 2]);
  const context = buildSessionContext(entries, "a4_1", { turns: 2 });
  assert.deepEqual(ids(context), ["u3", "a3_0", "a3_1", "u4", "a4_0", "a4_1"]);
  assert.equal(context.hasMore, true);
  assert.equal(context.hasNewer, false);
  assert.equal(context.turnsBefore, 3);
});

test("more turns than the branch holds: the whole branch, nothing earlier", () => {
  const entries = turns([1, 1, 1]);
  const context = buildSessionContext(entries, "a2_0", { turns: 6 });
  assert.deepEqual(ids(context), ["u0", "a0_0", "u1", "a1_0", "u2", "a2_0"]);
  assert.equal(context.hasMore, false);
  assert.equal(context.turnsBefore, 0);
});

test("a page never splits a turn, however many entries it holds", () => {
  const entries = turns([1, 120, 1]);
  const context = buildSessionContext(entries, "a2_0", { turns: 1 });
  assert.equal(ids(context)[0], "u2");
  assert.equal(context.messages.length, 2);
  const wide = buildSessionContext(entries, "a2_0", { turns: 2 });
  assert.equal(ids(wide)[0], "u1");
  assert.equal(wide.messages.length, 123);
  assert.equal(wide.hasMore, true);
});

test("paging upward rewinds to the turn above the oldest loaded entry", () => {
  const entries = turns([1, 1, 1, 1, 1, 1]);
  const context = buildSessionContext(entries, "u4", { turns: 2, excludeLeaf: true });
  assert.deepEqual(ids(context), ["u2", "a2_0", "u3", "a3_0"]);
  assert.equal(context.hasMore, true);
  assert.equal(context.hasNewer, true);
  assert.equal(context.turnsBefore, 2);
});

test("paging downward continues with whole turns after the loaded end", () => {
  const entries = turns([1, 1, 1, 1, 1, 1]);
  const context = buildSessionContext(entries, "a5_0", { turns: 2, newerThan: "a1_0" });
  assert.deepEqual(ids(context), ["u2", "a2_0", "u3", "a3_0"]);
  assert.equal(context.hasMore, true);
  assert.equal(context.hasNewer, true);
});

test("a jump centres the page on the target turn", () => {
  const entries = turns([1, 1, 1, 1, 1, 1, 1, 1]);
  const context = buildSessionContext(entries, "a7_0", { turns: 4, anchor: "u4" });
  // 4 轮的一页：目标轮下面 2 轮（turns/2），目标轮本身算在上面那份里。
  assert.deepEqual(ids(context), ["u3", "a3_0", "u4", "a4_0", "u5", "a5_0", "u6", "a6_0"]);
  assert.equal(context.hasMore, true);
  assert.equal(context.hasNewer, true);
});
