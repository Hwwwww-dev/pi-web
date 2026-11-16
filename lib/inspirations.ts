import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import {
  INSPIRATION_UPLOAD_PREFIX,
  MAX_INSPIRATION_FILE_BYTES,
  MAX_INSPIRATION_TEXT_CHARS,
  type Inspiration,
  type InspirationFileRef,
} from "./inspiration-shared";

// 共享形态（常量与类型）的真实定义在 lib/inspiration-shared.ts；re-export 保持既有 import 路径不变。
export { MAX_INSPIRATION_FILE_BYTES, MAX_INSPIRATION_TEXT_CHARS };
export type { Inspiration, InspirationFileRef };

/**
 * 灵感的单一存储来源：每个会话一个 JSON（`<sessionId>.json`）。附件本体不归这里
 * 管——它们由统一上传接口（`POST /api/files?type=upload`）写进仓库
 * `~/.pi-web/upload/inspiration/<日期>/<原名>`；条目只保存引用
 * （name/mime/path，见 InspirationFileRef）。挂接（attach）时服务端校验 path
 * 必须在灵感子域内，客户端给不出仓库外的引用。仓库是共享的 append-only 存储，
 * 彻底删除只删条目，不删文件——引用别的文件不受牵连，也没有死链清理职责。
 *
 * 归属由时间戳推导：灵感 = 无 doneAt 无 deletedAt；历史 = 有 doneAt；已删除 =
 * 有 deletedAt。恢复只清 deletedAt，完成过的落回历史。
 */

/** 会话与条目都是 uuid 形态的 id：既是文件名，也是唯一的合法输入形态。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 服务端展示/实现要按它分流图片，必须是个像样的 mime，但不限制类型。 */
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;
/** 附件引用的 path 是 `~` 形态的仓库路径，逐字符校验，绝不接受别的写法。 */
const INSPIRATION_PATH_PATTERN = /^~\/\.pi-web\/upload\/inspiration\/\d{4}-\d{2}-\d{2}\/[^/]+$/;
/** 展示名同附件落盘规则：无分隔符、无控制字符、有界。 */
const NAME_MAX_CHARS = 120;

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

/** 展示名保留原名做展示与实现引用，剥掉路径分隔符与控制字符，绝不还原成路径。 */
function sanitizeFileName(raw: string): string {
  const cleaned = raw.replace(/[\\/\u0000-\u001f\u007f]/g, "").trim();
  const safe = cleaned || "file";
  return safe.length <= NAME_MAX_CHARS ? safe : safe.slice(0, NAME_MAX_CHARS);
}

/** attach 的单条校验：path 必须在灵感子域内，mime 与展示名干净。校验不过整体失败。 */
function normalizeFileRef(raw: unknown): InspirationFileRef {
  if (!isRecord(raw)) throw new Error("Invalid inspiration file reference");
  const { name, mime, path } = raw as { name?: unknown; mime?: unknown; path?: unknown };
  const basename = typeof path === "string" ? path.slice(path.lastIndexOf("/") + 1) : "";
  if (typeof path !== "string" || !INSPIRATION_PATH_PATTERN.test(path) || basename === "." || basename === "..") {
    throw new Error(`Invalid inspiration file path: ${String(path)}`);
  }
  if (typeof mime !== "string") throw new Error("Invalid inspiration file mime");
  const cleanMime = mime.trim().toLowerCase();
  if (cleanMime.length > 100 || !MIME_PATTERN.test(cleanMime)) throw new Error(`Invalid inspiration file mime: ${mime}`);
  if (typeof name !== "string") throw new Error("Invalid inspiration file name");
  return { name: sanitizeFileName(name), mime: cleanMime, path };
}

export async function listInspirations(sessionId: string, root = inspirationsRoot()): Promise<Inspiration[]> {
  const path = sessionFilePath(sessionId, root);
  if (!existsSync(path)) return [];
  const items = parseItems(path, readFileSync(path, "utf8"));
  // 引用的唯一合法形态是 {name,mime,path}：旧版（id 定位、自有仓库）引用的
  // serve 路由已删除，读出来也无法展示或实现，读取时一并规整掉。
  return items.map((item) => ({ ...item, files: Array.isArray(item.files) ? item.files.filter((ref) => isRecord(ref) && typeof ref.path === "string") : [] }));
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

/** 批量挂接附件引用；同一 path 重复挂接是 no-op（同名 skip 上传后仍要挂上）。 */
export async function attachInspirationFiles(
  sessionId: string,
  itemId: string,
  files: unknown,
  root = inspirationsRoot(),
): Promise<Inspiration> {
  if (!Array.isArray(files) || files.length === 0) throw new Error("attach needs at least one file reference");
  const refs = files.map((file) => normalizeFileRef(file));
  return mutateItem(sessionId, itemId, root, (item) => {
    requireLive(item, itemId);
    const known = new Set(item.files.map((ref) => ref.path));
    for (const ref of refs) {
      if (known.has(ref.path)) continue;
      item.files.push(ref);
      known.add(ref.path);
    }
  });
}

/** 按仓库路径摘掉一份附件引用；引用不存在是显式错误，不静默成功。 */
export async function detachInspirationFile(sessionId: string, itemId: string, filePath: string, root = inspirationsRoot()): Promise<Inspiration> {
  if (typeof filePath !== "string" || !filePath.startsWith(INSPIRATION_UPLOAD_PREFIX)) {
    throw new Error(`Invalid inspiration file path: ${String(filePath)}`);
  }
  return mutateItem(sessionId, itemId, root, (item) => {
    requireLive(item, itemId);
    const index = item.files.findIndex((ref) => ref.path === filePath);
    if (index === -1) throw new Error(`Inspiration file not attached: ${filePath}`);
    item.files.splice(index, 1);
  });
}

/** 彻底删除只删条目：附件本体在共享仓库里，别的引用可能还在用。条目已不在时是幂等的 no-op。 */
export async function purgeInspiration(sessionId: string, itemId: string, root = inspirationsRoot()): Promise<void> {
  await mutateSession(sessionId, root, (items) => {
    const index = items.findIndex((entry) => entry.id === itemId);
    if (index === -1) return;
    items.splice(index, 1);
  });
}
