import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import {
  assertSafeRef,
  assertSafeSha,
  findGitRepositoryRoot,
  getGitCommitDetail,
  getGitCommitFileDiff,
  getGitGraph,
} from "@/lib/git-graph";
import { isDiffPathAllowed } from "@/lib/git-diff-access";
import { hasParentDirectorySegment } from "@/lib/path-security";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Commit paths from Git are relative to the repository root, not cwd.
    const sha = request.nextUrl.searchParams.get("sha")?.trim();
    const filePath = request.nextUrl.searchParams.get("path");
    if (filePath !== null && (!sha || !filePath || path.isAbsolute(filePath)
      || isWindowsAbsolutePath(filePath) || hasParentDirectorySegment(filePath))) {
      return NextResponse.json({ error: "A commit SHA and repository-relative path are required" }, { status: 400 });
    }
    if (sha) {
      assertSafeSha(sha);
      const detail = await getGitCommitDetail(cwd, sha);
      if (!detail) {
        return NextResponse.json({ error: "Commit not found" }, { status: 404 });
      }
      if (filePath === null) return NextResponse.json(detail);

      const repoRoot = await findGitRepositoryRoot(cwd);
      if (!repoRoot) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
      const allowedTarget = (relative: string) => {
        const target = path.resolve(repoRoot, relative);
        return isFilePathAllowed(target, new Set([repoRoot])) && isDiffPathAllowed(target, allowedRoots);
      };
      if (!allowedTarget(filePath)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
      const file = detail.files.find((change) => change.filePath === filePath);
      if (!file) return NextResponse.json({ error: "File not found in commit" }, { status: 404 });
      if (file.originalPath && !allowedTarget(file.originalPath)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      return NextResponse.json({ patch: await getGitCommitFileDiff(repoRoot, sha, file) });
    }

    // 2. Commit graph query
    const branch = request.nextUrl.searchParams.get("branch")?.trim() || undefined;
    if (branch && branch !== "all" && branch !== "current") {
      assertSafeRef(branch);
    }

    const showRemotesParam = request.nextUrl.searchParams.get("showRemotes");
    const showRemotes = showRemotesParam === null ? undefined : showRemotesParam === "true" || showRemotesParam === "1";

    const maxCountParam = request.nextUrl.searchParams.get("maxCount");
    const maxCount = maxCountParam ? Number(maxCountParam) : undefined;
    const skipParam = request.nextUrl.searchParams.get("skip");
    const skip = skipParam ? Number(skipParam) : undefined;

    const data = await getGitGraph(cwd, { branch, showRemotes, maxCount, skip });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Invalid git") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
