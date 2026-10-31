import fs from "node:fs";
import path from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "./file-access";
import { findGitRepositoryRoot } from "./git-graph";
import { GitGraphActionError } from "./git-graph-actions";

/** A Git operation reaches the whole checkout, not just the selected subdirectory. */
export async function requireGitGraphRepository(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || (!path.isAbsolute(cwd) && !isWindowsAbsolutePath(cwd))) {
    throw new GitGraphActionError("invalid_request", "cwd must be an absolute path");
  }
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots)) {
    throw new GitGraphActionError("forbidden", "Access denied", 403);
  }
  try {
    if (!fs.statSync(cwd).isDirectory()) throw new GitGraphActionError("invalid_request", "Not a directory");
  } catch (error) {
    if (error instanceof GitGraphActionError) throw error;
    throw new GitGraphActionError("not_found", "Directory not found", 404);
  }
  if (!isExistingFilePathAllowed(cwd, roots)) throw new GitGraphActionError("forbidden", "Access denied", 403);
  const root = await findGitRepositoryRoot(cwd);
  if (!root) throw new GitGraphActionError("not_found", "Repository not found", 404);
  if (!isFilePathAllowed(root, roots) || !isExistingFilePathAllowed(root, roots)) {
    throw new GitGraphActionError("forbidden", "Repository root is not allowed; select it in Pi Web first", 403);
  }
  return root;
}

export function gitGraphErrorResponse(error: unknown): Response {
  if (error instanceof GitGraphActionError) {
    return Response.json({ ok: false, code: error.code, error: error.message, ...(error.conflictFiles ? { conflictFiles: error.conflictFiles } : {}), ...(error.worktreePath ? { worktreePath: error.worktreePath } : {}) }, { status: error.status });
  }
  return Response.json({ ok: false, code: "git_failed", error: "Git operation failed" }, { status: 500 });
}
