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
import { readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
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
/** 外部进程在读完之后又追加了条目：拒绝改写，让调用方重试。 */
class RewriteRaceError extends Error {}

function rewriteSessionFileSync(path: string, contents: string, mode: number, expectSize: number): void {
  const tempPath = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx", mode, flush: true });
    // rename 一旦落下就整文件覆盖，别人的追加会静默丢失。临时文件写完后再
    // 核一次长度：窗口从「读+解析整文件」缩到「stat→rename 之间」。
    if (statSync(path).size !== expectSize) throw new RewriteRaceError(`target grew while rewriting ${basename(path)}`);
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
              try {
                rewriteSessionFileSync(childPath, lines.join("\n"), before.mode & 0o777, after.size);
                rewritten = true;
              } catch (error) {
                if (!(error instanceof RewriteRaceError)) throw error;
                if (attempt === 2) {
                  console.warn(`[pi-web] left ${basename(childPath)} on its old parent: the file kept changing while re-pointing it`);
                  break;
                }
                continue;
              }
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* skip if dir unreadable */ }
    }
  }

  for (const deletedId of deletedSessionIds) {
    try { await abortSubagent(deletedId); } catch { /* ordinary session, idle or completed */ }
    // 单个会话的 shutdown 失败（扩展钩子抛错等）不许拖垮整个删除：后面还有
    // unlink、路径缓存与侧栏状态要清。
    try { await getRpcSession(deletedId)?.shutdown(); } catch (error) {
      console.warn(`[pi-web] could not shut down ${deletedId} while deleting it: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    for (const [deletedId, deletedPath] of deletedPaths) {
      try {
        unlinkSync(deletedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      invalidateSessionPathCache(deletedId);
      invalidateSessionManagerCache(deletedPath);
    }
  } finally {
    // Drop their pins and archive times; best effort, the files are already gone.
    // 放 finally：中途任一 unlink 抛错（EACCES/EPERM）也不能把 pin/archive 留在盘上、
    // 把已删会话留在侧栏里等 TTL 过期。
    try {
      await forgetSessionUiState(deletedSessionIds);
    } catch (error) {
      console.warn(`[pi-web] could not clear the sidebar state of deleted sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
    invalidateSessionListCache();
  }
  return { deleted: [...deletedSessionIds], missing, running };
}
