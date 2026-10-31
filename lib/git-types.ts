export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
  additions: number;
  deletions: number;
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}

export interface GitCommitDiff {
  cwd: string;
  sha: string;
  filePath: string;
}

export type GitGraphRefType = "head" | "branch" | "tag" | "remote";

export interface GitGraphRef {
  type: GitGraphRefType;
  name: string;
  current?: boolean;
  /** Fully qualified Git reference, distinct from its display name. */
  fullName?: string;
  annotated?: boolean;
  remote?: string;
  symbolic?: boolean;
}

export interface GitGraphCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  committedAt: string;
  subject: string;
  refs: GitGraphRef[];
}

export interface GitGraphData {
  isGitRepository: boolean;
  commits: GitGraphCommit[];
  branches: string[];
  currentBranch: string;
  hasMore: boolean;
  headSha?: string;
  remotes?: string[];
}

export interface GitCommitFileChange {
  filePath: string;
  /** The previous repository-relative path when Git detects a rename. */
  originalPath?: string;
  status: GitFileStatusKind;
  additions: number;
  deletions: number;
}

export interface GitCommitDetail {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  committedAt: string;
  parents: string[];
  files: GitCommitFileChange[];
}

