/**
 * Workspace identity for sessions.
 *
 * The server-provided project identity wins over the resolved project root and
 * the raw cwd, so Windows path variants and all worktrees of one repo map to a
 * single key. Callers group sessions and conversations by it.
 */

/** Workspace identity for a session: resolved project root when known, else cwd. */
export function workspaceKeyOf(session: {
  cwd: string;
  projectRoot?: string | null;
  projectKey?: string | null;
}): string {
  return session.projectKey ?? session.projectRoot ?? session.cwd;
}
