import { execFile } from "child_process";
import { promisify } from "util";
import type {
  GitCommitDetail,
  GitCommitFileChange,
  GitFileStatusKind,
  GitGraphCommit,
  GitGraphData,
  GitGraphRef,
} from "./git-types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const GIT_GRAPH_MAX_BUFFER = 16 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_GRAPH_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

export function formatCommitDate(isoDateStr: string, includeTime = true): string {
  if (!isoDateStr) return "";
  try {
    const d = new Date(isoDateStr);
    if (isNaN(d.getTime())) return isoDateStr.split("T")[0] || isoDateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    if (!includeTime) return `${year}-${month}-${day}`;
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return isoDateStr.split("T")[0] || isoDateStr;
  }
}

export function assertSafeRef(ref: string): void {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("-") || /\s/.test(trimmed) || /[\x00-\x1f\x7f~^:?*\[\\]/.test(trimmed) || trimmed.includes("..") || trimmed.includes("@{")) {
    throw new Error(`Invalid git ref name: ${JSON.stringify(ref)}`);
  }
}

export function assertSafeSha(sha: string): void {
  const trimmed = sha.trim();
  if (!/^[0-9a-fA-F]{4,40}$/.test(trimmed)) {
    throw new Error(`Invalid git commit SHA: ${JSON.stringify(sha)}`);
  }
}

export async function findGitRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    const out = await git(cwd, ["rev-parse", "--show-toplevel"]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function parseGitRefs(
  rawRefNames: string,
  remotes: readonly string[] = [],
  currentBranchName = "HEAD",
): GitGraphRef[] {
  if (!rawRefNames) return [];
  const entries = rawRefNames
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const refs: GitGraphRef[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.startsWith("HEAD -> ")) {
      const branch = entry.slice(8).trim();
      if (!seen.has("head:HEAD")) {
        seen.add("head:HEAD");
        refs.push({ type: "head", name: "HEAD", current: true });
      }
      if (branch && !seen.has(`branch:${branch}`)) {
        seen.add(`branch:${branch}`);
        refs.push({ type: "branch", name: branch, current: true });
      }
    } else if (entry === "HEAD") {
      if (!seen.has("head:HEAD")) {
        seen.add("head:HEAD");
        refs.push({ type: "head", name: "HEAD", current: true });
      }
    } else if (entry.startsWith("tag: ")) {
      const tag = entry.slice(5).trim();
      if (tag && !seen.has(`tag:${tag}`)) {
        seen.add(`tag:${tag}`);
        refs.push({ type: "tag", name: tag });
      }
    } else if (remotes.some((r) => entry === r || entry.startsWith(`${r}/`))) {
      if (!seen.has(`remote:${entry}`)) {
        seen.add(`remote:${entry}`);
        refs.push({ type: "remote", name: entry });
      }
    } else {
      if (!seen.has(`branch:${entry}`)) {
        seen.add(`branch:${entry}`);
        refs.push({ type: "branch", name: entry, current: entry === currentBranchName });
      }
    }
  }
  return refs;
}

export async function listGitRemotes(repoRoot: string): Promise<string[]> {
  try {
    const out = await git(repoRoot, ["remote"]);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getCurrentGitBranch(repoRoot: string): Promise<string> {
  try {
    const out = await git(repoRoot, ["branch", "--show-current"]);
    const branch = out.trim();
    if (branch) return branch;
  } catch {}

  try {
    const out = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return out.trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}

export async function listLocalGitBranches(repoRoot: string): Promise<string[]> {
  try {
    const out = await git(repoRoot, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
    ]);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getGitGraph(
  cwd: string,
  options?: { branch?: string; maxCount?: number; skip?: number },
): Promise<GitGraphData> {
  const repoRoot = await findGitRepositoryRoot(cwd);
  if (!repoRoot) {
    return {
      isGitRepository: false,
      commits: [],
      branches: [],
      currentBranch: "",
      hasMore: false,
    };
  }

  const [currentBranch, remotes, branches] = await Promise.all([
    getCurrentGitBranch(repoRoot),
    listGitRemotes(repoRoot),
    listLocalGitBranches(repoRoot),
  ]);

  const maxCount = Math.max(1, Math.min(10000, options?.maxCount ?? 1000));
  const skip = Math.max(0, options?.skip ?? 0);

  const args = [
    "log",
    "--date-order",
    `--max-count=${maxCount + 1}`,
  ];
  if (skip > 0) {
    args.push(`--skip=${skip}`);
  }
  args.push("--format=%H%x00%P%x00%an%x00%ae%x00%cI%x00%s%x00%D%x1e");

  if (options?.branch && options.branch.trim() && options.branch.trim() !== "all") {
    const branch = options.branch.trim();
    assertSafeRef(branch);
    args.push("--end-of-options", branch);
  } else {
    args.push("--branches", "--tags", "--remotes", "HEAD");
  }

  let logOutput = "";
  try {
    logOutput = await git(repoRoot, args);
  } catch {
    // If branch doesn't exist or git log failed on empty repo
    return {
      isGitRepository: true,
      commits: [],
      branches,
      currentBranch,
      hasMore: false,
    };
  }

  const rawRecords = logOutput.split("\x1e");
  const parsedCommits: GitGraphCommit[] = [];

  for (const raw of rawRecords) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\x00");
    const [sha, parentsStr, author, authorEmail, committedAt, subject, refNames] = parts;
    if (!sha || sha.length < 4) continue;
    const parents = parentsStr ? parentsStr.trim().split(/\s+/).filter(Boolean) : [];
    const refs = parseGitRefs(refNames ?? "", remotes, currentBranch);

    parsedCommits.push({
      sha,
      shortSha: sha.slice(0, 7),
      parents,
      author: (author ?? "").trim(),
      authorEmail: (authorEmail ?? "").trim(),
      committedAt: (committedAt ?? "").trim(),
      subject: (subject ?? "").trim(),
      refs,
    });
  }

  const hasMore = parsedCommits.length > maxCount;
  const commits = hasMore ? parsedCommits.slice(0, maxCount) : parsedCommits;

  return {
    isGitRepository: true,
    commits,
    branches,
    currentBranch,
    hasMore,
  };
}

export async function getGitCommitDetail(
  cwd: string,
  sha: string,
): Promise<GitCommitDetail | null> {
  const repoRoot = await findGitRepositoryRoot(cwd);
  if (!repoRoot) return null;

  assertSafeSha(sha);

  // 1. Get commit metadata & body
  const metaFormat = "%H%x00%s%x00%B%x00%an%x00%ae%x00%cI%x00%P";
  let metaRaw = "";
  try {
    metaRaw = await git(repoRoot, ["show", "-s", `--format=${metaFormat}`, sha]);
  } catch {
    return null;
  }

  const [fullSha, subject, body, author, authorEmail, committedAt, parentsStr] = metaRaw.split("\x00");
  if (!fullSha) return null;

  const parents = parentsStr ? parentsStr.trim().split(/\s+/).filter(Boolean) : [];

  // 2. Get changed files stats with numstat & status
  let numstatOutput = "";
  try {
    numstatOutput = await git(repoRoot, [
      "show",
      "--numstat",
      "--format=",
      sha,
    ]);
  } catch {
    numstatOutput = "";
  }

  let statusOutput = "";
  try {
    statusOutput = await git(repoRoot, [
      "show",
      "--name-status",
      "--format=",
      sha,
    ]);
  } catch {
    statusOutput = "";
  }

  const statusByPath = new Map<string, GitFileStatusKind>();
  for (const line of statusOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const code = parts[0]?.[0]?.toUpperCase();
    const filePath = parts[1] ?? "";
    if (!filePath) continue;

    let kind: GitFileStatusKind = "modified";
    if (code === "A") kind = "added";
    else if (code === "D") kind = "deleted";
    else if (code === "R") kind = "renamed";
    else if (code === "U") kind = "conflict";
    statusByPath.set(filePath, kind);
  }

  const files: GitCommitFileChange[] = [];
  for (const line of numstatOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const [addStr, delStr, filePath] = parts;
    const additions = addStr === "-" ? 0 : Number(addStr) || 0;
    const deletions = delStr === "-" ? 0 : Number(delStr) || 0;
    const status = statusByPath.get(filePath) ?? "modified";

    files.push({
      filePath,
      status,
      additions,
      deletions,
    });
  }

  return {
    sha: fullSha.trim(),
    shortSha: fullSha.trim().slice(0, 7),
    subject: (subject ?? "").trim(),
    body: (body ?? "").trim(),
    author: (author ?? "").trim(),
    authorEmail: (authorEmail ?? "").trim(),
    committedAt: (committedAt ?? "").trim(),
    parents,
    files,
  };
}
