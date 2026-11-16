import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";

/**
 * 灵感的单一存储来源：每个会话一个 JSON（`<sessionId>.json`），图片二进制按
 * uuid 落盘在 images/ 下、清单在 images.json。文件名一律由这里生成——调用方
 * （路由）只传 id 与内容，从不传路径，因此不与 /api/files 的边界发生关系。
 *
 * 归属由时间戳推导：灵感 = 无 doneAt 无 deletedAt；历史 = 有 doneAt；已删除 =
 * 有 deletedAt。恢复只清 deletedAt，完成过的落回历史。
 */

/** 与 composer 附件同一上限：灵感就是要回到输入框的，超限的存了也发不出。 */
export const MAX_INSPIRATION_IMAGE_BYTES = 10 * 1024 * 1024;
/** 灵感文本上限：超过它是把整份文档当灵感存（粘贴有 /api/paste 负责）。 */
export const MAX_INSPIRATION_TEXT_CHARS = 64 * 1024;

export interface InspirationItem {
  id: string;
  text: string;
  imageIds: string[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  deletedAt: string | null;
}

interface InspirationImageRecord {
  file: string;
  mime: string;
  createdAt: string;
}

type InspirationImageManifest = Record<string, InspirationImageRecord>;

/** 会话与条目都是 uuid 形态的 id：既是文件名，也是唯一的合法输入形态。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
function parseItems(path: string, text: string): InspirationItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`${path}: ${reason}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) throw new Error(`Invalid inspirations file: ${path}`);
  return parsed.items as InspirationItem[];
}

function readImageManifest(root: string): InspirationImageManifest {
  const path = join(root, "images.json");
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Invalid inspirations image manifest: ${path}`);
  return parsed as InspirationImageManifest;
}

/** 读改写全程持锁；写走 tmp+rename 原子落盘，两标签页并发写不互相覆盖。 */
async function mutateSession<T>(sessionId: string, root: string, mutate: (items: InspirationItem[]) => T): Promise<T> {
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

async function mutateImageManifest<T>(root: string, mutate: (manifest: InspirationImageManifest) => T): Promise<T> {
  const path = join(root, "images.json");
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(path, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    const manifest = readImageManifest(root);
    const result = mutate(manifest);
    const tmp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    return result;
  } finally {
    await release();
  }
}

function requireItem(items: InspirationItem[], itemId: string): InspirationItem {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new Error(`Inspiration not found: ${itemId}`);
  return item;
}

/** 已删除的条目只接受恢复与彻底删除；其余改写都显式拒绝，不静默改状态。 */
function requireLive(item: InspirationItem, itemId: string): void {
  if (item.deletedAt) throw new Error(`Inspiration has been deleted: ${itemId}`);
}

const ACTIONS = new Set(["done", "remount", "delete", "restore"]);

export async function listInspirations(sessionId: string, root = inspirationsRoot()): Promise<InspirationItem[]> {
  const path = sessionFilePath(sessionId, root);
  if (!existsSync(path)) return [];
  return parseItems(path, readFileSync(path, "utf8"));
}

export async function createInspiration(sessionId: string, text: string, imageIds: string[] = [], root = inspirationsRoot()): Promise<InspirationItem> {
  // 空文本合法：灵感可以只有一张截图。
  if (typeof text !== "string" || text.length > MAX_INSPIRATION_TEXT_CHARS) throw new Error("Invalid inspiration text");
  if (!Array.isArray(imageIds) || imageIds.some((id) => !UUID_PATTERN.test(id))) throw new Error("Invalid inspiration image ids");
  const stamp = new Date().toISOString();
  const item: InspirationItem = { id: randomUUID(), text, imageIds: [...imageIds], createdAt: stamp, updatedAt: stamp, doneAt: null, deletedAt: null };
  await mutateSession(sessionId, root, (items) => {
    items.unshift(item);
  });
  return item;
}

async function mutateItem(sessionId: string, itemId: string, root: string, mutate: (item: InspirationItem) => void): Promise<InspirationItem> {
  return mutateSession(sessionId, root, (items) => {
    const item = requireItem(items, itemId);
    mutate(item);
    item.updatedAt = new Date().toISOString();
    return item;
  });
}

/** 改文本；时间字段走 transition，绝不混在一处。 */
export async function editInspiration(sessionId: string, itemId: string, text: string, root = inspirationsRoot()): Promise<InspirationItem> {
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
): Promise<InspirationItem> {
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

/** 软删除的记录与图片文件一起消失；清单条目一并清理。条目已不在时是幂等的 no-op。 */
export async function purgeInspiration(sessionId: string, itemId: string, root = inspirationsRoot()): Promise<void> {
  const removedIds = await mutateSession(sessionId, root, (items) => {
    const index = items.findIndex((entry) => entry.id === itemId);
    if (index === -1) return [];
    const [item] = items.splice(index, 1);
    return item.imageIds;
  });
  await mutateImageManifest(root, (manifest) => {
    for (const imageId of removedIds) {
      const record = manifest[imageId];
      if (!record) continue;
      try {
        unlinkSync(join(root, record.file));
      } catch {
        // 幂等：文件已不在即视为清理完成。
      }
      delete manifest[imageId];
    }
  });
}

/** 保存一张图片并挂到灵感上；同一张图只属于一条灵感。 */
export async function addInspirationImage(sessionId: string, itemId: string, bytes: Buffer, mime: string, root = inspirationsRoot()): Promise<string> {
  if (!Number.isInteger(bytes.length) || bytes.length <= 0 || bytes.length > MAX_INSPIRATION_IMAGE_BYTES) throw new Error("Invalid inspiration image size");
  if (!/^image\/(png|jpeg|gif|webp)$/.test(mime)) throw new Error(`Unsupported inspiration image mime: ${mime}`);
  const imageId = randomUUID();
  const imagesDir = join(root, "images");
  mkdirSync(imagesDir, { recursive: true });
  const file = join("images", imageId);
  writeFileSync(join(root, file), bytes, { mode: 0o600 });
  try {
    await mutateImageManifest(root, (manifest) => {
      manifest[imageId] = { file, mime, createdAt: new Date().toISOString() };
    });
    await mutateItem(sessionId, itemId, root, (item) => {
      requireLive(item, itemId);
      item.imageIds.push(imageId);
    });
  } catch (error) {
    // 挂接失败就不留孤儿文件与清单条目。
    try {
      unlinkSync(join(root, file));
    } catch { /* 尽力清理 */ }
    try {
      await mutateImageManifest(root, (manifest) => {
        delete manifest[imageId];
      });
    } catch { /* 尽力清理 */ }
    throw error;
  }
  return imageId;
}

/** 从灵感上摘掉一张图片：引用、清单条目、文件三者同删（文件缺失幂等）。 */
export async function removeInspirationImage(sessionId: string, itemId: string, imageId: string, root = inspirationsRoot()): Promise<void> {
  if (!UUID_PATTERN.test(imageId)) throw new Error(`Invalid inspiration image id: ${imageId}`);
  await mutateItem(sessionId, itemId, root, (item) => {
    requireLive(item, itemId);
    const index = item.imageIds.indexOf(imageId);
    if (index === -1) throw new Error(`Inspiration image not attached: ${imageId}`);
    item.imageIds.splice(index, 1);
  });
  await mutateImageManifest(root, (manifest) => {
    const record = manifest[imageId];
    if (!record) return;
    try {
      unlinkSync(join(root, record.file));
    } catch {
      // 幂等：文件已不在即视为清理完成。
    }
    delete manifest[imageId];
  });
}

export async function readInspirationImage(imageId: string, root = inspirationsRoot()): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!UUID_PATTERN.test(imageId)) return null;
  const record = readImageManifest(root)[imageId];
  if (!record) return null;
  const path = join(root, record.file);
  if (!existsSync(path)) return null;
  return { bytes: readFileSync(path), mime: record.mime };
}
