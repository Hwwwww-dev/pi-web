import { createAgentEventStream } from "@/lib/agent-event-stream";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, watchRpcSession } from "@/lib/rpc-manager";
import { isValidLivenessHolder } from "@/lib/session-liveness";
import { describeStreamClient } from "@/lib/stream-client";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events?holder=<page id> - SSE stream of agent events. The holder, the
// request's reported address and its browser label only label the stream for the debug panel: the
// page's lease renewals keep the session alive, never the stream (#1283).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });
  const holderParam = new URL(req.url).searchParams.get("holder");
  const holder = isValidLivenessHolder(holderParam) ? holderParam : null;

  // Fast path: already-running session
  const session = getRpcSession(id);
  let sessionPromise;
  if (session?.isAlive()) {
    sessionPromise = Promise.resolve(session);
  } else {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    if (req.signal.aborted) return new Response(null, { status: 204 });
    // A stream never starts a session: the page's lease renewals keep it alive (#1283), and a
    // reconnect resurrecting what the idle reaper just reaped would defeat the reap. Watch
    // instead: the stream stays open with heartbeats only (never `connected`) until a start
    // another caller asked for — a prompt, set_tools — registers a wrapper, which the watcher
    // attaches to; the late attach replays what the session still holds.
    sessionPromise = watchRpcSession(id, req.signal);
  }

  const stream = createAgentEventStream(req, id, sessionPromise, { holder, ...describeStreamClient(req.headers) });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
