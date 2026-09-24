import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  getSessionListVersion,
  listSessionSummaries,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
// The summary-grade session catalogue rides along (incremental scan: only
// files changed since the last poll are re-read) so the sidebar rows refresh
// their counts and timing without waiting for a full catalogue reload.
export async function GET() {
  const [summaries, runtimeSessions] = await Promise.all([
    listSessionSummaries(),
    attachSessionProjectInfo(getRpcSessionInfos()),
  ]);
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
      sessions: mergeSessionLists(summaries, runtimeSessions),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
