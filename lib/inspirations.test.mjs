import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  addInspirationFile,
  createInspiration,
  editInspiration,
  inspirationsRoot,
  isValidSessionId,
  listInspirations,
  purgeInspiration,
  readInspirationFile,
  removeInspirationFile,
  transitionInspiration,
} = await createJiti(import.meta.url, { moduleCache: false })
  .import("./inspirations.ts");

async function storageRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-inspirations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const SESSION = "0f7d2c18-3f0a-4b8e-9c1d-2e4a5b6c7d8e";
const PNG_1PX = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001" +
  "0d0a2db40000000049454e44ae426082",
  "hex",
);
const PDF_MIN = Buffer.from("%PDF-1.4\n%minimal test document\n%%EOF\n", "utf8");

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

test("any file type up to 10MB round-trips with its name; non-images serve under their stored mime", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "带附件", root);
  const imageRef = await addInspirationFile(SESSION, item.id, PNG_1PX, "image/png", "截图.png", root);
  const pdfRef = await addInspirationFile(SESSION, item.id, PDF_MIN, "application/pdf", "文档.pdf", root);

  const image = await readInspirationFile(imageRef.id, root);
  assert.equal(image.mime, "image/png");
  assert.equal(image.name, "截图.png");
  assert.ok(image.bytes.equals(PNG_1PX));
  const pdf = await readInspirationFile(pdfRef.id, root);
  assert.equal(pdf.mime, "application/pdf");
  assert.ok(pdf.bytes.equals(PDF_MIN));

  const stored = (await listInspirations(SESSION, root)).find((entry) => entry.id === item.id);
  assert.deepEqual(stored.files, [
    { id: imageRef.id, name: "截图.png", mime: "image/png" },
    { id: pdfRef.id, name: "文档.pdf", mime: "application/pdf" },
  ]);

  await removeInspirationFile(SESSION, item.id, pdfRef.id, root);
  assert.equal(await readInspirationFile(pdfRef.id, root), null);
  assert.equal(existsSync(join(root, "files", pdfRef.id)), false);
  assert.deepEqual((await listInspirations(SESSION, root)).find((entry) => entry.id === item.id).files, [imageRef]);
  await assert.rejects(removeInspirationFile(SESSION, item.id, pdfRef.id, root), /not attached/);
});

test("attachment names are sanitized: no path separators, no control characters, bounded length", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "命名", root);
  const hostile = await addInspirationFile(SESSION, item.id, PDF_MIN, "application/pdf", "../../etc/passwd\u0000\u001b隐藏", root);
  assert.equal(hostile.name, "....etcpasswd隐藏");
  const long = await addInspirationFile(SESSION, item.id, PDF_MIN, "text/plain", "很".repeat(300), root);
  assert.equal(long.name.length, 120);
  const empty = await addInspirationFile(SESSION, item.id, PDF_MIN, "text/plain", "///", root);
  assert.equal(empty.name, "file");
});

test("addFile validates size and mime, and cleans up after itself when attaching fails", async (t) => {
  const root = await storageRoot(t);
  await assert.rejects(addInspirationFile(SESSION, "no-such-item", PDF_MIN, "application/pdf", "a.pdf", root), /Inspiration not found/);
  await assert.rejects(
    addInspirationFile(SESSION, "0f7d2c18-3f0a-4b8e-9c1d-2e4a5b6c7d8f", PDF_MIN, "not a mime", "a.pdf", root),
    /Invalid inspiration file mime/,
  );
  await assert.rejects(
    addInspirationFile(SESSION, "0f7d2c18-3f0a-4b8e-9c1d-2e4a5b6c7d8f", Buffer.alloc(10 * 1024 * 1024 + 1), "application/pdf", "big.pdf", root),
    /Invalid inspiration file size/,
  );

  // 挂接失败（条目不存在）：文件与索引条目都不留孤儿。
  const manifest = JSON.parse(await readFile(join(root, "files.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest), []);
  const leftover = (await readdir(join(root, "files"))).filter((name) => !name.startsWith("."));
  assert.deepEqual(leftover, []);
});

test("purge removes the record, its attachment files and index entries, and is idempotent", async (t) => {
  const root = await storageRoot(t);
  const item = await createInspiration(SESSION, "将消失", root);
  const imageRef = await addInspirationFile(SESSION, item.id, PNG_1PX, "image/png", "图.png", root);
  const pdfRef = await addInspirationFile(SESSION, item.id, PDF_MIN, "application/pdf", "书.pdf", root);

  await purgeInspiration(SESSION, item.id, root);
  assert.deepEqual(await listInspirations(SESSION, root), []);
  assert.equal(await readInspirationFile(imageRef.id, root), null);
  assert.equal(await readInspirationFile(pdfRef.id, root), null);
  assert.equal(existsSync(join(root, "files", imageRef.id)), false);
  const manifest = JSON.parse(await readFile(join(root, "files.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest), []);

  await purgeInspiration(SESSION, item.id, root);
  await purgeInspiration(SESSION, "0f7d2c18-3f0a-4b8e-9c1d-2e4a5b6c7d90", root);
});

test("sessions are isolated: one session's file never serves another", async (t) => {
  const root = await storageRoot(t);
  const other = "11111111-2222-4333-8444-555555555555";
  await createInspiration(SESSION, "本会话", root);
  assert.deepEqual(await listInspirations(other, root), []);
  await assert.rejects(
    addInspirationFile(other, "does-not-matter", PDF_MIN, "application/pdf", "x.pdf", root),
    /Inspiration not found/,
  );
});
