import { lstatSync } from "fs";
import path from "path";
import { isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { hasParentDirectorySegment } from "./path-security";

/** Authorize a diff target even when the file or its parent was deleted. */
export function isDiffPathAllowed(filePath: string, allowedRoots: Set<string>): boolean {
  if (hasParentDirectorySegment(filePath)) return false;
  // Never walk past a dangling link or an access error.
  let candidate = filePath;
  while (isFilePathAllowed(candidate, allowedRoots)) {
    try {
      lstatSync(candidate);
      return isExistingFilePathAllowed(candidate, allowedRoots);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  return false;
}
