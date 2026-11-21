import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession, setRpcSessionTools } from "@/lib/rpc-manager";
import { cwdMissingBody, missingCwdFromBody } from "@/lib/missing-cwd";
import { EXTENSION_REPORTED_CODE } from "@/lib/agent-client";

// 无存活会话也该幂等成功的命令：语义是“让某件事停下来/清空”，没有会话
 // 时本来就无事可做。曾把整備会话完整启起来再执行，白起一次（扩展、MCP、
 // session_start 全跑），abort 又无事可中止（2026-11-21 审计）。
const IDEMPOTENT_WITHOUT_SESSION = new Set(["abort", "abort_bash", "abort_compaction", "clear_queue"]);

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    const body = await req.json().catch(() => null) as { type?: unknown; message?: unknown; [key: string]: unknown } | null;
    // 形状校验在拿会话/启会话之前：坏输入一律 400，不先白起一个 wrapper。
    if (body === null || typeof body !== "object" || Array.isArray(body) || typeof body.type !== "string" || body.type.length === 0) {
      return NextResponse.json({ error: "body must be an object with a non-empty string type" }, { status: 400 });
    }
    commandType = body.type;
    if (commandType === "prompt" && typeof body.message !== "string") {
      return NextResponse.json({ error: "prompt requires a string message", code: "prompt_rejected", accepted: false }, { status: 400 });
    }
    const requestedToolNames = body.toolNames;
    if (
      requestedToolNames !== undefined
      && (!Array.isArray(requestedToolNames) || requestedToolNames.some((name) => typeof name !== "string"))
    ) {
      throw new Error("toolNames must be an array of strings");
    }
    const toolNames = requestedToolNames as string[] | undefined;

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (body.type === "set_tools") {
      const filePath = existing?.sessionFile || await resolveSessionPath(id) || undefined;
      if (!existing?.isAlive() && !filePath) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const changed = await setRpcSessionTools(id, filePath, toolNames);
      return NextResponse.json({
        success: true,
        data: { sessionId: changed.sessionId, recreated: changed.recreated },
      });
    }
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      promptAccepted = body.type === "prompt";
      return NextResponse.json({ success: true, data: result });
    }
    if (IDEMPOTENT_WITHOUT_SESSION.has(body.type)) {
      // 回收/不存在的会话上发 stop/abort/清队列：无事可做，幂等成功，
      // 不为它把会话完整启起来。
      return NextResponse.json({ success: true, data: null });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({
        error: "Session not found",
        ...(body.type === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 404 });
    }

    const { session } = await startRpcSession(id, filePath, undefined, {
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
    const result = await session.send(body);
    promptAccepted = body.type === "prompt";

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    // Read by its fields: the wrapper that threw may come from another route's bundle.
    const missingCwd = missingCwdFromBody(error);
    const status = (error as { status?: number })?.status;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(missingCwd ? cwdMissingBody(missingCwd) : {}),
      ...((error as { code?: unknown } | null)?.code === EXTENSION_REPORTED_CODE ? { code: EXTENSION_REPORTED_CODE } : {}),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: status === 404 ? status : 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" }) as Record<string, unknown>;
    // The authoritative counters ride along with the state snapshot: the toolbar
    // and the stats panel read one reading, and no extra command is needed.
    const stats = await session.send({ type: "get_session_stats" });
    // Status reads leave out the system prompt, most of the reply (agentStatusUrl()).
    if (new URL(req.url).searchParams.get("systemPrompt") === "0") delete state.systemPrompt;
    return NextResponse.json({ running: true, state, stats });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
