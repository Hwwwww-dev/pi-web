import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-lazy-load.ts");
}

test("treats only the real message tail as attached", async () => {
  const { isScrollAtTail } = await loadSubject();
  // 1px 容差只吸收亚像素：差 0.5/2px 都不算贴底。
  assert.deepEqual(
    [400, 399.5, 398].map((scrollTop) => isScrollAtTail(scrollTop, 600, 1000)),
    [true, true, false],
  );
  // 内容短于视口时永远是贴底。
  assert.equal(isScrollAtTail(0, 600, 400), true);
});
