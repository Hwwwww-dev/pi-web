import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getFileName } from "@/lib/file-paths";
import { getLanguage } from "@/lib/file-types";
import {
  CommitFileMissingError,
  decodeCommitFileText,
  isSafeCommitFilePath,
  isValidCommitHash,
  readCommitFileBytes,
} from "@/lib/git-history";

/**
 * One file as it exists at one commit — the source counterpart to
 * `/api/git/commit`, which serves that file's diff. Same validation, same
 * allow-list rules as the worktree file API.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const repo = params.get("repo")?.trim() ?? "";
    const hash = params.get("hash")?.trim() ?? "";
    const filePath = params.get("path")?.trim() ?? "";
    const download = params.get("download") === "1";

    if (!repo || (!repo.startsWith("/") && !isWindowsAbsolutePath(repo))) {
      return NextResponse.json({ error: "repo must be an absolute path" }, { status: 400 });
    }
    if (!isValidCommitHash(hash)) {
      return NextResponse.json({ error: "hash must be a commit id" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(repo, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(repo);
    } catch {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(repo, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!isSafeCommitFilePath(repo, filePath)) {
      return NextResponse.json({ error: "path must stay inside the repository" }, { status: 400 });
    }

    const bytes = await readCommitFileBytes(repo, hash, filePath);
    if (download) {
      const name = getFileName(filePath);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
          "content-disposition": `attachment; filename="${name.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    }

    const decoded = decodeCommitFileText(bytes);
    if (!decoded) {
      return NextResponse.json({ error: "binary file" }, { status: 400 });
    }
    return NextResponse.json({
      content: decoded.content,
      language: getLanguage(filePath),
      size: bytes.length,
      truncated: decoded.truncated,
    });
  } catch (error) {
    if (error instanceof CommitFileMissingError) {
      return NextResponse.json({ error: "file does not exist in this commit" }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
