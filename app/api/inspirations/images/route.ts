import { NextResponse } from "next/server";
import { addInspirationImage } from "@/lib/inspirations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 上传灵感图片。文件名由服务端生成（uuid），客户端永远不提供路径——本路由
 * 与 /api/paste 同一纪律：固定目录 + 生成的文件名，不拓宽 /api/files 的边界。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const itemId = form.get("itemId");
  if (typeof itemId !== "string") return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  const mime = file.type;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const imageId = await addInspirationImage(sessionId, itemId, bytes, mime);
    return NextResponse.json({ imageId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to store inspiration image" }, { status: 400 });
  }
}
