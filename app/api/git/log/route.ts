import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { isEmptyRepositoryError, parseLogLimit, parseLogOffset, readCommitLog } from "@/lib/git-history";

export async function GET(request: NextRequest) {
  try {
    const repo = request.nextUrl.searchParams.get("repo")?.trim() ?? "";
    if (!repo || (!repo.startsWith("/") && !isWindowsAbsolutePath(repo))) {
      return NextResponse.json({ error: "repo must be an absolute path" }, { status: 400 });
    }
    const limit = parseLogLimit(request.nextUrl.searchParams.get("limit"));
    const offset = parseLogOffset(request.nextUrl.searchParams.get("offset"));
    if (limit === null || offset === null) {
      return NextResponse.json({ error: "limit must be 1-100 and offset must be >= 0" }, { status: 400 });
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

    const result = await readCommitLog(repo, limit, offset);
    return NextResponse.json(result);
  } catch (error) {
    // A repository without commits is a normal empty state, not a failure.
    if (isEmptyRepositoryError(error)) {
      return NextResponse.json({ commits: [], hasMore: false });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
