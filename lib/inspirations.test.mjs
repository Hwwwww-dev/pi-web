import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  attachInspirationFiles,
  createInspiration,
  detachInspirationFile,
  editInspiration,
  inspirationsRoot,
  isValidSessionId,
  listInspirations,
  purgeInspiration,
  transitionInspiration,
} = await createJiti(import.meta.url, { moduleCache: false })
  .import("./inspirations.ts");

async function storageRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-inspirations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const SESSION = "0f7d2c18-3f0a-4b8e-9c1d-2e4a5b6c7d8e";
const REF = { name: "报价.pdf", mime: "application/pdf", path: "~/.pi-web/upload/inspiration/2026-11-17/报价.pdf" };
const IMAGE_REF = { name: "截图.png", mime: "image/png", path: "~/.pi-web/upload/inspiration/2026-11-17/截图.png" };

test("inspirationsRoot defaults to ~/.pi-web/inspirations under the user home", () => {
  assert.equal(inspirationsRoot(), join(process.env.HOME ?? "", ".pi-web", "inspirations"));
});

test("session ids must be uuids: listing rejects everything else", async () => {
  assert.ok(isValidSessionId(SESSION));
  assert.ok(!isValidSessionId("../etc/passwd"));
  assert.ok(!isValidSessionId("abc"));
  await assert.rejects(listInspirations("../escape"), /Invalid inspiration session id/);
});

test("an empty session has no file and no items", async (t) => {
  const root = await storageRoot(t);
  assert.deepEqual(await listInspirations(SESSION, root), []);
  assert.equal(existsSync(join(root, `${SESSION}.json`)), false);
});

test("create, list and edit round-trip; empty text is legal (an idea can be just attachments)", async (t) => {
  const root = await storageRoot(t);
  const first = await createInspiration(SESSION, "先记一笔", root);
  const attachmentOnly = await createInspiration(SESSION, "", root);
  assert.equal(first.text, "先记一笔");
  assert.equal(first.doneAt, null);
  assert.equal(first.deletedAt, null);
  assert.deepEqual(first.files, []);
  assert.equal(attachmentOnly.text, "");

  const items = await listInspirations(SESSION, root);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, attachmentOnly.id, "newest first");

  await assert.rejects(createInspiration(SESSION, "x".repeat(64 * 1024 + 1), root), /Invalid inspiration text/);

  const edited = await editInspiration(SESSION, first.id, "改好了", root);
  assert.equal(edited.text, "改好了");
  const reread = await listInspirations(SESSION, root);
  assert.equal(reread.find((item) => item.id === first.id).text, "改好了");
  await assert.rejects(editInspiration(SESSION, "no-such-id", "x", root), /Inspiration not found/);
});

test("done moves to history, remount returns it; restore only clears deletedAt", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "待完成", root);

  const done = await transitionInspiration(SESSION, item.id, "done", root);
  assert.ok(done.doneAt);
  await assert.rejects(transitionInspiration(SESSION, item.id, "nope", root), /Invalid inspiration action/);

  const remounted = await transitionInspiration(SESSION, item.id, "remount", root);
  assert.equal(remounted.doneAt, null);

  await transitionInspiration(SESSION, item.id, "done", root);
  const deleted = await transitionInspiration(SESSION, item.id, "delete", root);
  assert.ok(deleted.deletedAt);
  await assert.rejects(transitionInspiration(SESSION, item.id, "done", root), /has been deleted/);

  const restored = await transitionInspiration(SESSION, item.id, "restore", root);
  assert.equal(restored.deletedAt, null, "restore does not rewrite history");
  assert.ok(restored.doneAt, "a finished idea falls back to history after restore");

  await transitionInspiration(SESSION, item.id, "delete", root);
  await assert.rejects(editInspiration(SESSION, item.id, "x", root), /has been deleted/);
});

test("attach stores repository references; duplicate paths and hostile shapes are rejected", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "带附件", root);

  const attached = await attachInspirationFiles(SESSION, item.id, [IMAGE_REF, REF], root);
  assert.deepEqual(attached.files, [IMAGE_REF, REF]);

  // 同一 path 重复挂接是 no-op（同名 skip 上传后仍要挂上），mime 归一化小写。
  const again = await attachInspirationFiles(
    SESSION, item.id,
    [{ name: "截图.png", mime: "IMAGE/PNG", path: IMAGE_REF.path }],
    root,
  );
  assert.deepEqual(again.files, [IMAGE_REF, REF]);

  for (const bad of [
    { ...REF, path: "~/.pi-web/upload/other/2026-11-17/报价.pdf" },
    { ...REF, path: "~/.pi-web/upload/inspiration/not-a-date/报价.pdf" },
    { ...REF, path: "~/.pi-web/upload/inspiration/2026-11-17/../2026-11-16/报价.pdf" },
    { ...REF, path: "/etc/passwd" },
    { ...REF, mime: "not a mime" },
    { name: "无 mime", path: REF.path },
  ]) {
    await assert.rejects(attachInspirationFiles(SESSION, item.id, [bad], root), /Invalid inspiration file/);
  }
  assert.deepEqual((await listInspirations(SESSION, root)).find((entry) => entry.id === item.id).files, [IMAGE_REF, REF], "failed attaches leave the item untouched");
});

test("attach names are sanitized: no path separators, no control characters, bounded length", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "命名", root);
  const hostile = await attachInspirationFiles(
    SESSION, item.id,
    [{ name: "../../etc/passwd\u0000\u001b隐藏", mime: "application/pdf", path: REF.path }],
    root,
  );
  assert.equal(hostile.files[0].name, "....etcpasswd隐藏");
  const long = await attachInspirationFiles(
    SESSION, item.id,
    [{ name: "很".repeat(300), mime: "text/plain", path: "~/.pi-web/upload/inspiration/2026-11-17/long.txt" }],
    root,
  );
  assert.equal(long.files[1].name.length, 120);
});

test("detach removes by repository path and rejects what is not attached", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "摘附件", root);
  await attachInspirationFiles(SESSION, item.id, [IMAGE_REF, REF], root);

  const detached = await detachInspirationFile(SESSION, item.id, REF.path, root);
  assert.deepEqual(detached.files, [IMAGE_REF]);
  await assert.rejects(detachInspirationFile(SESSION, item.id, REF.path, root), /not attached/);
  await assert.rejects(detachInspirationFile(SESSION, item.id, "/etc/passwd", root), /Invalid inspiration file path/);
});

test("purge removes only the record and is idempotent; the shared repository keeps files", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "将消失", root);
  await attachInspirationFiles(SESSION, item.id, [IMAGE_REF, REF], root);

  await purgeInspiration(SESSION, item.id, root);
  assert.deepEqual(await listInspirations(SESSION, root), []);
  assert.equal(existsSync(join(root, "files")), false, "the storage never owned attachment files");

  await purgeInspiration(SESSION, item.id, root);
  await purgeInspiration(SESSION, "0f7d2c18-3f0a-4b8e-9c1d-2e4a5b6c7d90", root);
});

test("legacy references without a path are dropped on read; sessions are isolated", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "旧数据", root);
  await attachInspirationFiles(SESSION, item.id, [REF], root);
  // 手写一个旧版（id 定位）引用进条目：serve 路由已删，读取时规整掉。
  const path = join(root, `${SESSION}.json`);
  const parsed = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
  parsed.items[0].files.push({ id: "0b0e-legacy", name: "旧.bin", mime: "application/octet-stream" });
  await writeFile(path, JSON.stringify(parsed));

  const items = await listInspirations(SESSION, root);
  assert.deepEqual(items[0].files, [REF]);

  const other = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual(await listInspirations(other, root), []);
  await assert.rejects(
    attachInspirationFiles(other, item.id, [REF], root),
    /Inspiration not found/,
  );
});
