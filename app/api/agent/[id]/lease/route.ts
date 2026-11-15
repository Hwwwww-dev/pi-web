import { NextResponse } from "next/server";
import { getRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { hasUnsettledSubagentRun } from "@/lib/subagent-runtime";

/**
 * A wrapper built before a hot reload lacks the state getters (its own timer
 * still runs): they read as unknown rather than failing the poll.
 */
function readRunState(session: AgentSessionWrapper | undefined, method: "isRunning" | "isAwaitingInput"): boolean {
  if (!session || typeof session[method] !== "function") return false;
  return Boolean(session[method]());
}

// POST /api/agent/[id]/lease - A page renews the session it has selected, whether or not it
// holds the event stream: the session's idle countdown starts over (renewIdleTimer()), so it
// is reaped one idle timeout after the last page let go. The reply says what is under way:
// a hidden page lets go of an idle stream and opens it again when this reports activity
// (#1283). Never starts a wrapper.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getRpcSession(id);
  const alive = Boolean(session?.isAlive());
  // A wrapper built before a hot reload lacks the method; its own timer still runs.
  if (alive && typeof session!.renewIdleTimer === "function") session!.renewIdleTimer();
  try {
    return NextResponse.json({
      success: true,
      // A run, a queued prompt, a `!` command or a compaction (isRunning()).
      running: alive && readRunState(session, "isRunning"),
      // An extension dialog waiting for an answer.
      awaitingInput: alive && readRunState(session, "isAwaitingInput"),
      // A subagent under this session, at any depth, whose end starts a turn here.
      subagentsActive: hasUnsettledSubagentRun(id),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
