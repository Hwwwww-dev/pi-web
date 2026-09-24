import { NextResponse } from "next/server";
import { ModelsConfigReadError, readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(readModelsConfig());
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as unknown;
    // Non-object bodies would atomically replace models.json wholesale and leave
    // both this panel and the pi CLI with an unreadable config — refuse them.
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "models config must be a JSON object" }, { status: 400 });
    }
    writeModelsConfig(body as Record<string, unknown>);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
