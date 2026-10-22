import { NextResponse } from "next/server";
import { resolveSessionPath, openSessionManager, buildTurnIndex } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import type { SessionEntry } from "@/lib/types";

/**
 * The whole-branch turn index the chat minimap lists: one descriptor per turn,
 * oldest first, regardless of how much history the chat has loaded. Clicking
 * an unloaded turn pages its messages in through the context route.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const leafId = new URL(req.url).searchParams.get("leafId") ?? undefined;
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(filePath!);
    // SAFETY: sm.getEntries() returns the SDK's entry records; they are the
    // same shape lib/types.ts mirrors structurally (the context route casts
    // them identically).
    const turns = buildTurnIndex(sm.getEntries() as unknown as SessionEntry[], leafId ?? sm.getLeafId());
    return NextResponse.json({ turns });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
