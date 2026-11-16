import { NextResponse } from "next/server";
import { readInspirationImage, removeInspirationImage } from "@/lib/inspirations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 按 uuid 供应一张灵感图片。id 不在清单即 404——这里没有路径参数可解析，
 * 永远不会成为文件系统浏览入口（文件名由上传路由生成，客户端无法命名）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const image = await readInspirationImage(id);
    if (!image) return NextResponse.json({ error: "Inspiration image not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to read inspiration image" }, { status: 500 });
  }
}

/** 从所属灵感摘除一张图片：引用、清单条目、文件三者同删。 */
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
    await removeInspirationImage(sessionId, itemId, id);
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove inspiration image" }, { status: 400 });
  }
}

