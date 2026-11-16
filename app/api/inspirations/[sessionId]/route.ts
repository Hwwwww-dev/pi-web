import { NextResponse } from "next/server";
import { createInspiration, listInspirations, MAX_INSPIRATION_TEXT_CHARS } from "@/lib/inspirations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  try {
    return NextResponse.json({ items: await listInspirations(sessionId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list inspirations" }, { status: 400 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  let body: { text?: unknown };
  try {
    body = await req.json() as { text?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > MAX_INSPIRATION_TEXT_CHARS) return NextResponse.json({ error: "Inspiration text too long" }, { status: 400 });
  try {
    return NextResponse.json({ item: await createInspiration(sessionId, text) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create inspiration" }, { status: 400 });
  }
}
