import { NextResponse } from "next/server";
import { readInspirationFile, removeInspirationFile } from "@/lib/inspirations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 图片 inline 供缩略图与实现；其余一律 attachment，绝不以内联形态落在我们源上渲染。 */
const INLINE_IMAGE_PATTERN = /^image\/(png|jpeg|gif|webp)$/;

/**
 * 按 uuid 供应一份灵感附件。id 不在索引即 404——这里没有路径参数可解析，
 * 永远不会成为文件系统浏览入口（文件名由上传路由生成，客户端无法命名）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const file = await readInspirationFile(id);
    if (!file) return NextResponse.json({ error: "Inspiration file not found" }, { status: 404 });
    const headers: Record<string, string> = {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    if (!INLINE_IMAGE_PATTERN.test(file.mime)) {
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`;
    }
    return new NextResponse(new Uint8Array(file.bytes), { headers });
  } catch {
    return NextResponse.json({ error: "Failed to read inspiration file" }, { status: 500 });
  }
}

/** 从所属灵感摘除一份附件：引用、索引条目、文件三者同删。 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  const sessionId = searchParams.get("sessionId");
  const itemId = searchParams.get("itemId");
  if (!sessionId || !itemId) return NextResponse.json({ error: "Missing sessionId or itemId" }, { status: 400 });
  try {
    await removeInspirationFile(sessionId, itemId, id);
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove inspiration file" }, { status: 400 });
  }
}
