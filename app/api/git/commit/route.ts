import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { isSafeCommitFilePath, isValidCommitHash, readCommitFilePatch, readCommitFiles } from "@/lib/git-history";

export async function GET(request: NextRequest) {
  try {
    const repo = request.nextUrl.searchParams.get("repo")?.trim() ?? "";
    const hash = request.nextUrl.searchParams.get("hash")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
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

    if (filePath) {
      if (!isSafeCommitFilePath(repo, filePath)) {
        return NextResponse.json({ error: "path must stay inside the repository" }, { status: 400 });
      }
      const patch = await readCommitFilePatch(repo, hash, filePath);
      if (patch === null) {
        return NextResponse.json({ error: "file is not changed in this commit" }, { status: 404 });
      }
      return NextResponse.json({ patch });
    }

    const files = await readCommitFiles(repo, hash);
    return NextResponse.json({ files });
  } catch (error) {
    // A well-formed hash that git rejects means the object does not exist here.
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
