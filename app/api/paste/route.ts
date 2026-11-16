import { mkdir, writeFile } from "fs/promises";
import { randomBytes } from "crypto";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 一次粘贴最多保留这么多字符：超过它是误操作（整份文件被粘进输入框），不是长文案。 */
const MAX_PASTE_CHARS = 2 * 1024 * 1024;

/**
 * 大段粘贴的落地目录：POSIX 下固定 `/tmp/pi/pasted`（与用户、pi 自己的临时文件约定一致），
 * Windows 没有 `/tmp`，落到系统临时目录的 `pi/pasted`。
 */
function pasteDirectory(): string {
  return process.platform === "win32" ? path.join(os.tmpdir(), "pi", "pasted") : "/tmp/pi/pasted";
}

function pasteFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // 同一秒内连粘两次也不会撞名（上传链里的 `wx` 语义：绝不覆盖已有文件）。
  return `pasted-${stamp}-${randomBytes(3).toString("hex")}.txt`;
}

/**
 * Writes a long paste to `pi/pasted` in the OS temp directory and answers its
 * absolute path. The composer turns that into an `@` reference, so the text
 * never lands in a chat message or in the session's working directory.
 * The directory is fixed and the file name is generated here: a client cannot
 * name a path, so this route never widens `/api/files`' boundary.
 */
export async function POST(request: Request) {
  let text: unknown;
  try {
    ({ text } = await request.json() as { text?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text-required" }, { status: 400 });
  }
  if (text.length > MAX_PASTE_CHARS) {
    return NextResponse.json({ error: "text-too-large" }, { status: 413 });
  }

  const directory = pasteDirectory();
  const filePath = path.join(directory, pasteFileName(new Date()));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, text, { flag: "wx" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  return NextResponse.json({ path: filePath, directory });
}
