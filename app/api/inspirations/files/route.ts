import { NextResponse } from "next/server";
import { addInspirationFile } from "@/lib/inspirations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 上传灵感附件（图片与任意文件，≤10MB）。文件名由服务端生成（uuid），客户端
 * 永远不提供路径——本路由与 /api/paste 同一纪律：固定目录 + 生成的文件名，不
 * 拓宽 /api/files 的边界。路由本身没有动态段，归属（sessionId/itemId）都来自表单。
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const sessionId = form.get("sessionId");
  if (typeof sessionId !== "string") return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  const itemId = form.get("itemId");
  if (typeof itemId !== "string") return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const ref = await addInspirationFile(sessionId, itemId, bytes, file.type || "application/octet-stream", file.name || "file");
    return NextResponse.json({ fileId: ref.id, name: ref.name, mime: ref.mime }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to store inspiration file" }, { status: 400 });
  }
}
