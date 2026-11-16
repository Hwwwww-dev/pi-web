import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { POST } = await jiti.import("./route.ts");

/** 与路由里同一份目录口径：POSIX 固定 /tmp/pi/pasted，Windows 用系统临时目录。 */
const pasteDir = process.platform === "win32"
  ? path.join(process.env.TEMP ?? process.env.TMP ?? ".", "pi", "pasted")
  : "/tmp/pi/pasted";

async function post(body) {
  const response = await POST(new Request("http://localhost/api/paste", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

test("a long paste lands in /tmp/pi/pasted and answers its absolute path", async () => {
  const text = `line one\nline two\n${"x".repeat(20_000)}`;
  const { status, body } = await post({ text });
  assert.equal(status, 200);
  assert.ok(path.isAbsolute(body.path));
  assert.equal(path.dirname(body.path), pasteDir);
  assert.match(path.basename(body.path), /^pasted-\d{8}-\d{6}-[0-9a-f]{6}\.txt$/);
  // 内容原样落盘：长文本粘贴的整个意义是别丢字符。
  assert.equal(fs.readFileSync(body.path, "utf8"), text);
  fs.rmSync(body.path, { force: true });
});

test("two pastes in the same second never collide", async () => {
  const first = await post({ text: "first" });
  const second = await post({ text: "second" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.body.path, second.body.path);
  assert.equal(fs.readFileSync(first.body.path, "utf8"), "first");
  assert.equal(fs.readFileSync(second.body.path, "utf8"), "second");
  fs.rmSync(first.body.path, { force: true });
  fs.rmSync(second.body.path, { force: true });
});

test("empty and oversized pastes are refused instead of written", async () => {
  assert.equal((await post({ text: "  " })).status, 400);
  assert.equal((await post({ text: 42 })).status, 400);
  assert.equal((await post({ text: "x".repeat(2 * 1024 * 1024 + 1) })).status, 413);
});
