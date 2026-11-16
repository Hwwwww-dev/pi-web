import { NextResponse } from "next/server";
import { attachInspirationFiles, detachInspirationFile, editInspiration, purgeInspiration, transitionInspiration } from "@/lib/inspirations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["done", "remount", "delete", "restore"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; itemId: string }> }
) {
  const { sessionId, itemId } = await params;
  let body: { text?: unknown; action?: unknown; files?: unknown; path?: unknown };
  try {
    body = await req.json() as { text?: unknown; action?: unknown; files?: unknown; path?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    if (typeof body.text === "string") {
      return NextResponse.json({ item: await editInspiration(sessionId, itemId, body.text) });
    }
    if (body.action === "attach") {
      return NextResponse.json({ item: await attachInspirationFiles(sessionId, itemId, body.files) });
    }
    if (body.action === "detach") {
      return NextResponse.json({ item: await detachInspirationFile(sessionId, itemId, body.path as string) });
    }
    if (typeof body.action === "string" && ACTIONS.has(body.action)) {
      return NextResponse.json({ item: await transitionInspiration(sessionId, itemId, body.action as "done" | "remount" | "delete" | "restore") });
    }
    return NextResponse.json({ error: "Nothing to do: give text or a known action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update inspiration" }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; itemId: string }> }
) {
  const { sessionId, itemId } = await params;
  const purge = new URL(req.url).searchParams.get("purge") === "1";
  try {
    if (purge) {
      await purgeInspiration(sessionId, itemId);
      return NextResponse.json({ purged: true });
    }
    return NextResponse.json({ item: await transitionInspiration(sessionId, itemId, "delete") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete inspiration" }, { status: 400 });
  }
}
