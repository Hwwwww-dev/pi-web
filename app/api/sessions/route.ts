import { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/json-response";
import {
  attachSessionProjectInfo,
  getSessionListVersion,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";
import { startServerPerf } from "@/lib/perf";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const perf = startServerPerf("GET /api/sessions");
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    perf?.span("start");
    // Capture before awaiting: mutations during the scan still require a later refresh.
    const sessionListVersion = getSessionListVersion();
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    perf?.span("scan+projects");
    const body = {
      sessions: mergeSessionLists(persistedSessions, runtimeSessions),
      sessionListVersion,
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
    };
    const headers = { "Cache-Control": "no-store" };
    return perf?.attach(jsonResponse(req, body, { headers }))
      ?? jsonResponse(req, body, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
