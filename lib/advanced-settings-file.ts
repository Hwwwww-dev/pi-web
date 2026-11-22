import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import {
  differencesFromDefaults,
  normalizeAdvancedSettings,
  type AdvancedSettings,
  type AdvancedSettingValue,
} from "@/lib/advanced-settings";

/**
 * 「高级参数」页的落盘位置：`~/.pi-web/settings.json`，pi-web 自己的目录
 * （与 `~/.pi-web/upload`、`~/.pi-web/inspirations` 同级）。不写 pi 的
 * `~/.pi/agent/settings.json`：那份由 pi 的 SettingsManager 读写，混写会让
 * 两个进程互相覆盖。
 *
 * 文件里只存与默认值不同的键；读取时缺的键补默认值、越界的值钳制回范围。
 */

export function advancedSettingsPath(home = homedir()): string {
  return join(home, ".pi-web", "settings.json");
}

function parseSettings(path: string): Record<string, unknown> {
  // 与 pi 的读法一致：BOM 不是 JSON，空文件等于没有设置。
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("expected an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    // 路径写进消息里：解析器的原文说不清是哪个文件坏了。
    const reason = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`${path}: ${reason}`);
  }
}

/** mtime 缓存：每次请求都重读文件，但内容没变就不重新解析。 */
let cached: { path: string; mtimeMs: number; size: number; values: AdvancedSettings } | null = null;

export function readAdvancedSettings(path = advancedSettingsPath()): AdvancedSettings {
  if (!existsSync(path)) {
    cached = null;
    return normalizeAdvancedSettings({});
  }
  const stat = statSync(path);
  if (cached && cached.path === path && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.values;
  }
  const values = normalizeAdvancedSettings(parseSettings(path));
  cached = { path, mtimeMs: stat.mtimeMs, size: stat.size, values };
  return values;
}

/** 服务端读一个参数：每次重读文件（mtime + 大小不变时用缓存），改完不用重启。 */
export function serverAdvancedValue<K extends AdvancedSettingValue>(key: string): K {
  return readAdvancedSettings()[key] as K;
}

/**
 * 写一条参数（白名单 + 钳制都在 `normalizeAdvancedSettings` 里）。返回写后的
 * 整份值，调用方不必再读一遍。
 */
export async function writeAdvancedSettings(
  patch: Record<string, AdvancedSettingValue>,
  path = advancedSettingsPath(),
): Promise<AdvancedSettings> {
  mkdirSync(dirname(path), { recursive: true });
  // 首次创建走 wx：两个标签页同时开写时，输的一方拿 EEXIST 而不是覆盖。
  try {
    writeFileSync(path, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    // 只取认识的值：请求体里多出来的键直接丢掉，不落盘。
    const current = normalizeAdvancedSettings(parseSettings(path));
    const next = normalizeAdvancedSettings({ ...current, ...patch });
    const stored = differencesFromDefaults(next);
    writePrivateFileAtomicSync(path, JSON.stringify(stored, null, 2));
    cached = null;
    return next;
  } finally {
    await release();
  }
}

/** 整页恢复默认：直接写一个空对象（与默认值相同的键本来就不落盘）。 */
export async function resetAdvancedSettings(path = advancedSettingsPath()): Promise<AdvancedSettings> {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    writePrivateFileAtomicSync(path, "{}");
    cached = null;
    return normalizeAdvancedSettings({});
  } finally {
    await release();
  }
}
