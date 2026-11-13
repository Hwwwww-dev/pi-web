import { NextResponse } from "next/server";
import { resolveSessionPath, openSessionManager, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { attachTranscriptNotices, readSessionTranscriptNotices } from "@/lib/transcript-notices-server";
import type { SessionEntry } from "@/lib/types";

/**
 * Where a page starts: `before` pages up from the oldest loaded entry, `anchor`
 * centres a page on one entry (a minimap jump), `newerThan` pages down.
 */
function parseWindowParams(url: URL) {
  const between = (raw: string | null) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 1000) : 0;
  };
  return {
    before: url.searchParams.get("before") ?? undefined,
    anchor: url.searchParams.get("anchor") ?? undefined,
    newerThan: url.searchParams.get("newerThan") ?? undefined,
    after: between(url.searchParams.get("after")),
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  // `tail` caps the ancestor chain returned (default 50); `before` rewinds the
  // walk start to an older entry so the client can page upward without
  // re-fetching the whole active branch.
  const rawTail = Number(url.searchParams.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  const { before, anchor, newerThan, after } = parseWindowParams(url);

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(filePath!);
    // `before` is the oldest entry already on the client; fetch its ancestors
    // only (excludeLeaf) so prepending the page does not duplicate `before`.
    const entries = sm.getEntries();
    const transcriptNotices = readSessionTranscriptNotices({
      entries: entries as unknown as SessionEntry[],
      cwd: sm.getHeader()?.cwd ?? "",
      leafId: leafId ?? sm.getLeafId(),
      models: liveRpc?.inner.modelRuntime,
    });
    // A window request walks the branch to the real leaf; only upward paging
    // rewinds the walk start to `before`.
    const leaf = anchor || newerThan ? leafId : (before ?? leafId);
    const context = attachTranscriptNotices(buildSessionContext(entries as never, leaf, {
      deferThinking,
      deferToolResultImages,
      tail,
      excludeLeaf: Boolean(before) && !anchor && !newerThan,
      anchor,
      after,
      newerThan,
      sessionId: id,
    }), transcriptNotices);

    return NextResponse.json({ context, tail, before: before ?? null });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
