import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { MAX_INSPIRATION_FILE_BYTES, MAX_INSPIRATION_TEXT_CHARS, type Inspiration, type InspirationFileRef } from "./inspiration-shared";

// 共享形态（常量与类型）的真实定义在 lib/inspiration-shared.ts；re-export 保持既有 import 路径不变。
export { MAX_INSPIRATION_FILE_BYTES, MAX_INSPIRATION_TEXT_CHARS };
export type { Inspiration, InspirationFileRef };

/**
 * 灵感的单一存储来源：每个会话一个 JSON（`<sessionId>.json`），附件（图片与
 * 任意文件，≤10MB）按 uuid 落盘在 files/ 下、磁盘索引在 files.json。文件名一律
 * 由这里生成——调用方（路由）只传 id 与内容，从不传路径，因此不与 /api/files
 * 的边界发生关系。
 *
 * 归属由时间戳推导：灵感 = 无 doneAt 无 deletedAt；历史 = 有 doneAt；已删除 =
 * 有 deletedAt。恢复只清 deletedAt，完成过的落回历史。
 *
 * 条目上的 `files`（id/name/mime）是展示与实现用的副本；磁盘索引（files.json）
 * 是服务真相（Content-Type、落盘位置）。两处只在下方加锁的 add/remove/purge
 * 流程里同步改动，任何一方都不会被单独改写。
 */

/** 附件引用：id 定位文件；name/mime 供列表与「实现」直接使用（见上方同步说明）。 */

interface InspirationFileRecord {
  file: string;
  mime: string;
  name: string;
  createdAt: string;
}

type InspirationFileManifest = Record<string, InspirationFileRecord>;

/** 会话与附件都是 uuid 形态的 id：既是文件名，也是唯一的合法输入形态。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 服务端要按它发 Content-Type，必须是个像样的 mime，但不限制类型。 */
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

export function isValidSessionId(sessionId: string): boolean {
  return UUID_PATTERN.test(sessionId);
}

export function inspirationsRoot(root = join(homedir(), ".pi-web", "inspirations")): string {
  return root;
}

function sessionFilePath(sessionId: string, root: string): string {
  if (!isValidSessionId(sessionId)) throw new Error(`Invalid inspiration session id: ${sessionId}`);
  return join(root, `${sessionId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 坏 JSON 与坏结构都显式抛出：文件是用户数据，静默清零等于销毁。 */
function parseItems(path: string, text: string): Inspiration[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`${path}: ${reason}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) throw new Error(`Invalid inspirations file: ${path}`);
  return parsed.items as Inspiration[];
}

function readFileManifest(root: string): InspirationFileManifest {
  const path = join(root, "files.json");
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Invalid inspirations file manifest: ${path}`);
  return parsed as InspirationFileManifest;
}

/** 读改写全程持锁；写走 tmp+rename 原子落盘，两标签页并发写不互相覆盖。 */
async function mutateSession<T>(sessionId: string, root: string, mutate: (items: Inspiration[]) => T): Promise<T> {
  const path = sessionFilePath(sessionId, root);
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(path, JSON.stringify({ items: [] }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    // 并发首写由下面的持锁读改写兜住，建档遇 EEXIST 不是错误。
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    const items = parseItems(path, readFileSync(path, "utf8"));
    const result = mutate(items);
    const tmp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ items }, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    return result;
  } finally {
    await release();
  }
}

async function mutateFileManifest<T>(root: string, mutate: (manifest: InspirationFileManifest) => T): Promise<T> {
  const path = join(root, "files.json");
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(path, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    const manifest = readFileManifest(root);
    const result = mutate(manifest);
    const tmp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    return result;
  } finally {
    await release();
  }
}

function requireItem(items: Inspiration[], itemId: string): Inspiration {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new Error(`Inspiration not found: ${itemId}`);
  return item;
}

/** 已删除的条目只接受恢复与彻底删除；其余改写都显式拒绝，不静默改状态。 */
function requireLive(item: Inspiration, itemId: string): void {
  if (item.deletedAt) throw new Error(`Inspiration has been deleted: ${itemId}`);
}

const ACTIONS = new Set(["done", "remount", "delete", "restore"]);

/** 附件名只做展示与实现下载，剥掉路径分隔符与控制字符，绝不还原成路径。 */
function sanitizeFileName(raw: string): string {
  const cleaned = raw.replace(/[\\/\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "file").slice(0, 120);
}

export async function listInspirations(sessionId: string, root = inspirationsRoot()): Promise<Inspiration[]> {
  const path = sessionFilePath(sessionId, root);
  if (!existsSync(path)) return [];
  return parseItems(path, readFileSync(path, "utf8"));
}

export async function createInspiration(sessionId: string, text: string, root = inspirationsRoot()): Promise<Inspiration> {
  // 空文本合法：灵感可以只有一份附件。
  if (typeof text !== "string" || text.length > MAX_INSPIRATION_TEXT_CHARS) throw new Error("Invalid inspiration text");
  const stamp = new Date().toISOString();
  const item: Inspiration = { id: randomUUID(), text, files: [], createdAt: stamp, updatedAt: stamp, doneAt: null, deletedAt: null };
  await mutateSession(sessionId, root, (items) => {
    items.unshift(item);
  });
  return item;
}

async function mutateItem(sessionId: string, itemId: string, root: string, mutate: (item: Inspiration) => void): Promise<Inspiration> {
  return mutateSession(sessionId, root, (items) => {
    const item = requireItem(items, itemId);
    mutate(item);
    item.updatedAt = new Date().toISOString();
    return item;
  });
}

/** 改文本；时间字段走 transition，绝不混在一处。 */
export async function editInspiration(sessionId: string, itemId: string, text: string, root = inspirationsRoot()): Promise<Inspiration> {
  if (typeof text !== "string" || text.length > MAX_INSPIRATION_TEXT_CHARS) throw new Error("Invalid inspiration text");
  return mutateItem(sessionId, itemId, root, (item) => {
    requireLive(item, itemId);
    item.text = text;
  });
}

/** 完成进历史；重新挂入回灵感；删除（软）；恢复——只清 deletedAt。 */
export async function transitionInspiration(
  sessionId: string,
  itemId: string,
  action: "done" | "remount" | "delete" | "restore",
  root = inspirationsRoot(),
): Promise<Inspiration> {
  if (!ACTIONS.has(action)) throw new Error(`Invalid inspiration action: ${String(action)}`);
  return mutateItem(sessionId, itemId, root, (item) => {
    if (action === "restore") {
      if (!item.deletedAt) throw new Error(`Inspiration is not deleted: ${itemId}`);
      item.deletedAt = null;
      return;
    }
    requireLive(item, itemId);
    if (action === "done") item.doneAt = new Date().toISOString();
    else if (action === "remount") item.doneAt = null;
    else item.deletedAt = new Date().toISOString();
  });
}

/** 软删除的记录与附件文件一起消失；索引条目一并清理。条目已不在时是幂等的 no-op。 */
export async function purgeInspiration(sessionId: string, itemId: string, root = inspirationsRoot()): Promise<void> {
  const removedIds = await mutateSession(sessionId, root, (items) => {
    const index = items.findIndex((entry) => entry.id === itemId);
    if (index === -1) return [];
    const [item] = items.splice(index, 1);
    return item.files.map((ref) => ref.id);
  });
  await mutateFileManifest(root, (manifest) => {
    for (const fileId of removedIds) {
      const record = manifest[fileId];
      if (!record) continue;
      try {
        unlinkSync(join(root, record.file));
      } catch {
        // 幂等：文件已不在即视为清理完成。
      }
      delete manifest[fileId];
    }
  });
}

/** 保存一份附件（任意类型 ≤10MB）并挂到灵感上；同一份只属于一条灵感。 */
export async function addInspirationFile(
  sessionId: string,
  itemId: string,
  bytes: Buffer,
  mime: string,
  name: string,
  root = inspirationsRoot(),
): Promise<InspirationFileRef> {
  if (!Number.isInteger(bytes.length) || bytes.length <= 0 || bytes.length > MAX_INSPIRATION_FILE_BYTES) throw new Error("Invalid inspiration file size");
  const cleanMime = mime.trim().toLowerCase();
  if (cleanMime.length > 100 || !MIME_PATTERN.test(cleanMime)) throw new Error(`Invalid inspiration file mime: ${mime}`);
  const cleanName = sanitizeFileName(name);
  const fileId = randomUUID();
  const filesDir = join(root, "files");
  mkdirSync(filesDir, { recursive: true });
  const file = join("files", fileId);
  writeFileSync(join(root, file), bytes, { mode: 0o600 });
  const ref: InspirationFileRef = { id: fileId, name: cleanName, mime: cleanMime };
  try {
    await mutateFileManifest(root, (manifest) => {
      manifest[fileId] = { file, mime: cleanMime, name: cleanName, createdAt: new Date().toISOString() };
    });
    await mutateItem(sessionId, itemId, root, (item) => {
      requireLive(item, itemId);
      item.files.push(ref);
    });
  } catch (error) {
    // 挂接失败就不留孤儿文件与索引条目。
    try {
      unlinkSync(join(root, file));
    } catch { /* 尽力清理 */ }
    try {
      await mutateFileManifest(root, (manifest) => {
        delete manifest[fileId];
      });
    } catch { /* 尽力清理 */ }
    throw error;
  }
  return ref;
}

/** 从灵感上摘掉一份附件：引用、索引条目、文件三者同删（文件缺失幂等）。 */
export async function removeInspirationFile(sessionId: string, itemId: string, fileId: string, root = inspirationsRoot()): Promise<void> {
  if (!UUID_PATTERN.test(fileId)) throw new Error(`Invalid inspiration file id: ${fileId}`);
  await mutateItem(sessionId, itemId, root, (item) => {
    requireLive(item, itemId);
    const index = item.files.findIndex((ref) => ref.id === fileId);
    if (index === -1) throw new Error(`Inspiration file not attached: ${fileId}`);
    item.files.splice(index, 1);
  });
  await mutateFileManifest(root, (manifest) => {
    const record = manifest[fileId];
    if (!record) return;
    try {
      unlinkSync(join(root, record.file));
    } catch {
      // 幂等：文件已不在即视为清理完成。
    }
    delete manifest[fileId];
  });
}

export async function readInspirationFile(fileId: string, root = inspirationsRoot()): Promise<{ bytes: Buffer; mime: string; name: string } | null> {
  if (!UUID_PATTERN.test(fileId)) return null;
  const record = readFileManifest(root)[fileId];
  if (!record) return null;
  const path = join(root, record.file);
  if (!existsSync(path)) return null;
  return { bytes: readFileSync(path), mime: record.mime, name: record.name };
}
