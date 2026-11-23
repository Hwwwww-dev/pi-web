/**
 * Deleting session files: DELETE /api/sessions/[id] (a row's Delete) and
 * POST /api/sessions/delete (a project group's "Delete all sessions"). Each
 * named session goes with every subagent session below it, persisted or
 * live. A session left behind whose header names a deleted one as its parent
 * is re-pointed at the nearest ancestor still there (`parentSession` is
 * display metadata only, so the rewrite is safe; a file a live wrapper still
 * appends to is left alone). Open wrappers are shut down, subagents before
 * their parents, before the files go; then the pins and archive times of every
 * deleted id are forgotten.
 *
 * One call lists the catalogue and reads each folder once, however many
 * sessions it deletes: a project's hundreds of sessions deleted one request
 * each would read every file of the folder once per session.
 */

import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { abortSubagent, getRpcSession, getRpcSessionInfos, getRunningRpcSessionIds } from "./rpc-manager";
import {
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  invalidateSessionPathCache,
  listAllSessions,
  mergeSessionLists,
  readSessionHeader,
  resolveSessionPath,
} from "./session-reader";
import { sessionPathKey } from "./session-path";
import { forgetSessionUiState } from "./session-ui-state";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";
import { readSideRelation } from "./side-session";
import type { SessionEntry } from "./types";

/** Most ids one POST /api/sessions/delete takes; the sidebar sends a bigger project in parts. */
export const MAX_SESSION_DELETE_IDS = 500;

export interface SessionDeleteResult {
  /** Every session removed: the named ones and the subagent sessions below them. */
  deleted: string[];
  /** Named ids with neither a file nor a cached path. */
  missing: string[];
  /** Named ids kept because a session of theirs runs (`keepRunning` only). */
  running: string[];
}

function addChild(childrenByParent: Map<string, string[]>, parentId: string, childId: string): void {
  const children = childrenByParent.get(parentId) ?? [];
  children.push(childId);
  childrenByParent.set(parentId, children);
}

/**
 * Replace a session file atomically: a temporary file in its folder, then a
 * rename over it, so a crash or a concurrent reader never sees half a file.
 * The original mode is kept — pi owns these files, unlike the credentials the
 * 0600 writer in lib/atomic-file.ts covers.
 */
function rewriteSessionFileSync(path: string, contents: string, mode: number): void {
  const tempPath = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx", mode, flush: true });
    renameSync(tempPath, path);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Never created, or already renamed.
    }
    throw error;
  }
}

export interface DeletedSessionTombstone { path: string; until: number }

/**
 * 刚删掉的会话 id 留一段时间的墓碑。被 abort 的那一轮会在 `shutdown()` 返回之后才落
 * 最后一条（工具结果 / aborted 标记），文件被重建后列表又把它带回来，看起来就是「删除
 * 要点两次」。补删靠的是时间窗，而跑着的会话收尾可能比窗口长，所以列表这一侧也记着：
 * 墓碑期内的 id 直接过滤，文件一旦重新出现就再删一次。
 * Next 的每个路由是独立模块实例，放 `globalThis` 上共用一份。
 */
const DELETED_SESSION_TOMBSTONE_MS = 60_000;

export function deletedSessionTombstones(): Map<string, DeletedSessionTombstone> {
  const store = globalThis as Record<string, unknown>;
  const existing = store.__piDeletedSessionTombstones;
  if (existing instanceof Map) return existing as Map<string, DeletedSessionTombstone>;
  const created = new Map<string, DeletedSessionTombstone>();
  store.__piDeletedSessionTombstones = created;
  return created;
}

/** 删掉文件之后调用：墓碑期内列表隐藏这些 id，文件被重建就再删。 */
export function markDeletedSessions(paths: Map<string, string>): void {
  if (paths.size === 0) return;
  const tombstones = deletedSessionTombstones();
  const until = Date.now() + DELETED_SESSION_TOMBSTONE_MS;
  for (const [id, path] of paths) {
    tombstones.set(id, { path, until });
    try {
      unlinkSync(path);
    } catch { /* already gone */ }
    invalidateSessionPathCache(id);
    invalidateSessionManagerCache(path);
  }
  invalidateSessionListCache();
}

/** 列表出口：过滤墓碑期内的 id；过期的墓碑顺手清掉，并补删重建出来的文件。 */
export function filterDeletedSessions<T extends { id: string }>(sessions: T[]): T[] {
  const tombstones = deletedSessionTombstones();
  if (tombstones.size === 0) return sessions;
  const now = Date.now();
  for (const [id, tombstone] of tombstones) {
    if (tombstone.until > now) continue;
    // 墓碑在效期内从不出现，所以这次补删不会让正在看的那一行消失。
    if (existsSync(tombstone.path)) {
      try {
        unlinkSync(tombstone.path);
      } catch { /* already gone */ }
      invalidateSessionPathCache(id);
      invalidateSessionManagerCache(tombstone.path);
      invalidateSessionListCache();
    }
    tombstones.delete(id);
  }
  return tombstones.size === 0 ? sessions : sessions.filter((session) => !tombstones.has(session.id));
}

/**
 * Deletes `ids` and their subagent sessions. With `keepRunning`, a named
 * session is left alone when it or a subagent below it runs: a bulk delete
 * the user confirmed a moment ago must not stop a run that started since.
 */
export async function deleteSessions(
  ids: readonly string[],
  options: { keepRunning?: boolean } = {},
): Promise<SessionDeleteResult> {
  const targets = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const filePath = await resolveSessionPath(id);
    if (filePath) targets.set(id, filePath);
    else missing.push(id);
  }
  if (targets.size === 0) return { deleted: [], missing, running: [] };

  // Read only the bounded headers before deleting.
  const parentPathByKey = new Map<string, string | undefined>();
  for (const filePath of targets.values()) {
    let parentSessionPath: string | undefined;
    try {
      parentSessionPath = readSessionHeader(filePath)?.parentSession;
    } catch (error) {
      // Empty runtime sessions have a cached path before their first disk write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    parentPathByKey.set(sessionPathKey(filePath), parentSessionPath);
  }

  const targetPathKeys = new Set([...targets.values()].map((path) => sessionPathKey(path)));
  const targetDirs = new Set([...targets.values()].map((path) => dirname(path)));
  // Deleting a session also deletes every persisted or live subagent below it.
  const sessions = mergeSessionLists(
    await listAllSessions({ force: true }),
    getRpcSessionInfos({ includeTransient: true }),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.relation?.kind === "subagent" || session.relation?.kind === "side") {
      addChild(childrenByParent, session.relation.parentSessionId, session.id);
    }
  }
  const sessionPaths = new Map(sessions.map((session) => [session.id, session.path]));
  // Include local files even when the global catalogue is stale or incomplete.
  for (const dir of targetDirs) {
    try {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
        const childPath = join(dir, file);
        if (targetPathKeys.has(sessionPathKey(childPath))) continue;
        try {
          const lines = readFileSync(childPath, "utf8").split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; id?: string };
          if (header.type !== "session" || typeof header.id !== "string") continue;
          const entries = lines.slice(1).flatMap((line) => {
            try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
          });
          const subagent = readSubagentRun(entries, header.id, childPath);
          if (subagent) {
            addChild(childrenByParent, subagent.parentSessionId, header.id);
            sessionPaths.set(header.id, childPath);
            continue;
          }
          const side = readSideRelation(entries);
          if (side) {
            addChild(childrenByParent, side.parentSessionId, header.id);
            sessionPaths.set(header.id, childPath);
          }
        } catch { /* skip malformed or concurrently removed sessions */ }
      }
    } catch { /* skip if dir unreadable */ }
  }

  // Each named session with the subagents below it, children before their
  // parent: wrappers are shut down in this order.
  const runningIds = options.keepRunning ? new Set(getRunningRpcSessionIds()) : new Set<string>();
  const deletedSessionIds = new Set<string>();
  const running: string[] = [];
  for (const id of targets.keys()) {
    if (deletedSessionIds.has(id)) continue;
    const family: string[] = [];
    const seen = new Set<string>();
    const visit = (sessionId: string) => {
      if (seen.has(sessionId) || deletedSessionIds.has(sessionId)) return;
      seen.add(sessionId);
      for (const childId of childrenByParent.get(sessionId) ?? []) visit(childId);
      family.push(sessionId);
    };
    visit(id);
    if (family.some((sessionId) => runningIds.has(sessionId))) {
      running.push(id);
      continue;
    }
    for (const sessionId of family) deletedSessionIds.add(sessionId);
  }

  const deletedPaths = new Map<string, string>();
  for (const deletedId of deletedSessionIds) {
    const sessionPath = targets.get(deletedId) ?? sessionPaths.get(deletedId) ?? getRpcSession(deletedId)?.sessionFile
      ?? await resolveSessionPath(deletedId);
    if (sessionPath) deletedPaths.set(deletedId, sessionPath);
  }
  const deletedPathKeys = new Map([...deletedPaths.values()].map((path) => [sessionPathKey(path), path]));

  // A session left behind whose parent goes is re-attached to the nearest
  // ancestor that stays (cascade re-parent).
  const survivingParent = (parentSessionPath: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let current = parentSessionPath;
    while (current) {
      const key = sessionPathKey(current);
      const deletedPath = deletedPathKeys.get(key);
      if (deletedPath === undefined) return current;
      if (seen.has(key)) return undefined;
      seen.add(key);
      if (!parentPathByKey.has(key)) {
        let parent: string | undefined;
        // A subagent's file may be gone already; it then re-attaches nothing.
        try { parent = readSessionHeader(deletedPath)?.parentSession; } catch { parent = undefined; }
        parentPathByKey.set(key, parent);
      }
      current = parentPathByKey.get(key);
    }
    return undefined;
  };
  if (deletedPaths.size > 0) {
    const scanDirs = new Set([...deletedPaths.values()].map((path) => dirname(path)));
    for (const dir of scanDirs) {
      try {
        const files = readdirSync(dir).filter(
          (file) => file.endsWith(".jsonl") && !deletedPathKeys.has(sessionPathKey(join(dir, file))),
        );
        for (const file of files) {
          const childPath = join(dir, file);
          try {
            // The bounded header says whether it needs a rewrite at all.
            const head = readSessionHeader(childPath);
            const childParent = head?.parentSession;
            if (!childParent || !deletedPathKeys.has(sessionPathKey(childParent))) continue;

            // A live wrapper appends to this very file while the rewrite runs;
            // entries landing between its read and the rename would be lost
            // under the replaced file. The header is display metadata, so the
            // re-parent is skipped until the run that writes is done.
            const wrapper = getRpcSession(head?.id ?? "");
            if (
              wrapper
              && typeof wrapper.isAlive === "function"
              && wrapper.isAlive()
              && sessionPathKey(wrapper.sessionFile) === sessionPathKey(childPath)
            ) continue;

            const parentSessionPath = survivingParent(childParent);
            let parentSessionId: string | undefined;
            if (parentSessionPath) {
              try {
                // The parent may have been deleted or moved already; treat it as absent.
                parentSessionId = readSessionHeader(parentSessionPath)?.id;
              } catch {
                parentSessionId = undefined;
              }
            }

            // Another pi process can append between the read and the write:
            // stat the file around the read and start over when it moved, so a
            // rewrite never lands on a file seen growing.
            let rewritten = false;
            for (let attempt = 0; attempt < 3 && !rewritten; attempt += 1) {
              const before = statSync(childPath);
              const lines = readFileSync(childPath, "utf8").split("\n");
              const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
              if (header.type !== "session") break;
              // Rewrite header with new parentSession
              header.parentSession = parentSessionPath;
              lines[0] = JSON.stringify(header);
              if (parentSessionPath && parentSessionId) {
                for (let index = 1; index < lines.length; index += 1) {
                  let entry: { type?: string; customType?: string; data?: unknown };
                  try {
                    entry = JSON.parse(lines[index]);
                  } catch {
                    continue;
                  }
                  if (
                    entry.type !== "custom"
                    || entry.customType !== SUBAGENT_META_TYPE
                    || typeof entry.data !== "object"
                    || entry.data === null
                    || Array.isArray(entry.data)
                  ) continue;
                  entry.data = {
                    ...entry.data,
                    parentSessionId,
                    parentSessionPath,
                  };
                  lines[index] = JSON.stringify(entry);
                  break;
                }
              }
              const after = statSync(childPath);
              if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
                if (attempt === 2) {
                  console.warn(`[pi-web] left ${basename(childPath)} on its old parent: the file kept changing while re-pointing it`);
                  break;
                }
                continue;
              }
              rewriteSessionFileSync(childPath, lines.join("\n"), before.mode & 0o777);
              rewritten = true;
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* skip if dir unreadable */ }
    }
  }

  for (const deletedId of deletedSessionIds) {
    try { await abortSubagent(deletedId); } catch { /* ordinary session, idle or completed */ }
    await getRpcSession(deletedId)?.shutdown();
  }
  // 墓碑先立再删文件：跑着的会话要等 abort 收尾，文件可能晚于补删窗口才被重建。
  markDeletedSessions(deletedPaths);
  for (const [deletedId, deletedPath] of deletedPaths) {
    try {
      unlinkSync(deletedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    invalidateSessionPathCache(deletedId);
    invalidateSessionManagerCache(deletedPath);
  }
  // A wrapper can append one last entry just after its shutdown returns (an
  // aborted turn's tool result), which recreates the file we just unlinked:
  // the row then comes back on the next list refresh and Delete looks like it
  // needed a second click. Reap for a moment instead of trusting one unlink.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    let recreated = false;
    for (const [deletedId, deletedPath] of deletedPaths) {
      if (!existsSync(deletedPath)) continue;
      try {
        unlinkSync(deletedPath);
        recreated = true;
      } catch { /* already gone */ }
      invalidateSessionPathCache(deletedId);
      invalidateSessionManagerCache(deletedPath);
    }
    if (!recreated) break;
  }
  // Drop their pins and archive times; best effort, the files are already gone.
  try {
    await forgetSessionUiState(deletedSessionIds);
  } catch (error) {
    console.warn(`[pi-web] could not clear the sidebar state of deleted sessions: ${error instanceof Error ? error.message : String(error)}`);
  }
  invalidateSessionListCache();
  return { deleted: [...deletedSessionIds], missing, running };
}
