import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findRegisteredBranchWorktree, invalidateProjectCache } from "./worktree";
import { samePath } from "./paths";

const exec = promisify(execFile);
const LOCAL_TIMEOUT = 30_000;
const REMOTE_TIMEOUT = 60_000;

export class GitGraphActionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public conflictFiles?: string[],
    public worktreePath?: string,
  ) { super(message); }
}

type Input = Record<string, unknown>;

function text(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new GitGraphActionError("invalid_request", `Invalid ${key}`);
  }
  return value;
}

function commit(input: Input, key = "sha"): string {
  const value = text(input, key);
  if (!/^[a-fA-F0-9]{40}$/.test(value)) throw new GitGraphActionError("invalid_request", `Invalid ${key}`);
  return value.toLowerCase();
}

function safeMessage(value: string): string {
  // Git may print a remote URL containing credentials. Never send the URL back.
  return value.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, "[remote URL]").slice(0, 4000);
}

async function run(cwd: string, args: string[], remote = false): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" };
  // Git can run repository hooks and credential helpers, neither needs the web password.
  delete env.PI_WEB_PASSWORD;
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    timeout: remote ? REMOTE_TIMEOUT : LOCAL_TIMEOUT,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
  return stdout;
}

async function validName(cwd: string, name: string, kind: "heads" | "tags"): Promise<void> {
  if (name.startsWith("-") || name.includes("\n") || name.includes("\r")) {
    throw new GitGraphActionError("invalid_request", "Invalid Git reference name");
  }
  try { await run(cwd, ["check-ref-format", `refs/${kind}/${name}`]); }
  catch { throw new GitGraphActionError("invalid_request", "Invalid Git reference name"); }
}

async function resolveCommit(cwd: string, ref: string): Promise<string> {
  try { return (await run(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim(); }
  catch { throw new GitGraphActionError("not_found", "Git reference or commit not found", 404); }
}

async function reference(cwd: string, input: Input, kinds: readonly string[], key = "ref"): Promise<string> {
  const ref = text(input, key);
  if (!kinds.some((kind) => ref.startsWith(`refs/${kind}/`)) || ref.includes("\n") || ref.includes("\r")) {
    throw new GitGraphActionError("invalid_request", `Invalid ${key}`);
  }
  try { await run(cwd, ["check-ref-format", ref]); }
  catch { throw new GitGraphActionError("invalid_request", `Invalid ${key}`); }
  const actual = await resolveCommit(cwd, ref);
  if (actual !== commit(input, "expectedTargetSha")) {
    throw new GitGraphActionError("stale_target", "The selected reference changed. Refresh and try again.", 409);
  }
  return ref;
}

async function checkHead(cwd: string, input: Input): Promise<void> {
  const expected = commit(input, "expectedHead");
  const actual = await resolveCommit(cwd, "HEAD");
  if (actual !== expected) throw new GitGraphActionError("stale_target", "HEAD changed. Refresh and try again.", 409);
}

async function checkBranchWorktree(cwd: string, ref: string): Promise<void> {
  const branch = ref.slice("refs/heads/".length);
  const holder = await findRegisteredBranchWorktree(cwd, branch);
  if (holder && !samePath(holder.path, cwd)) {
    throw new GitGraphActionError("worktree_in_use", `Branch '${branch}' belongs to another worktree: ${holder.path}`, 409, undefined, holder.path);
  }
}

async function remoteFor(cwd: string, input: Input, ref?: string): Promise<{ remote: string; branch?: string }> {
  const remote = text(input, "remote");
  const remotes = (await run(cwd, ["remote"])).split(/\r?\n/).filter(Boolean);
  if (remote.startsWith("-") || !remotes.includes(remote)) throw new GitGraphActionError("invalid_request", "Unknown remote");
  if (!ref) return { remote };
  const prefix = `refs/remotes/${remote}/`;
  if (!ref.startsWith(prefix) || ref === `${prefix}HEAD`) throw new GitGraphActionError("invalid_request", "Invalid remote branch");
  const branch = ref.slice(prefix.length);
  await validName(cwd, branch, "heads");
  return { remote, branch };
}

const ACTIONS = new Set([
  "branch-create", "tag-create", "branch-checkout", "branch-rename", "branch-delete", "tag-delete",
  "commit-checkout", "cherry-pick", "revert", "merge", "rebase", "reset", "remote-checkout",
  "branch-push", "tag-push", "remote-fetch", "remote-pull", "remote-delete",
]);

/** Execute one explicitly supported operation; no caller-provided command or flags are accepted. */
export async function performGitGraphAction(cwd: string, body: unknown): Promise<void> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GitGraphActionError("invalid_request", "Invalid request");
  const input = body as Input;
  const action = text(input, "action");
  if (!ACTIONS.has(action)) throw new GitGraphActionError("invalid_request", "Unknown Git action");
  let args: string[];
  let isRemote = false;

  switch (action) {
    case "branch-create": {
      const sha = commit(input); await resolveCommit(cwd, sha);
      const name = text(input, "name"); await validName(cwd, name, "heads");
      args = ["branch", "--", name, sha]; break;
    }
    case "tag-create": {
      const sha = commit(input); await resolveCommit(cwd, sha);
      const name = text(input, "name"); await validName(cwd, name, "tags");
      const type = text(input, "tagType");
      if (type !== "lightweight" && type !== "annotated") throw new GitGraphActionError("invalid_request", "Invalid tag type");
      args = type === "annotated" ? ["tag", "-a", "-m", text(input, "message"), "--", name, sha] : ["tag", "--", name, sha];
      break;
    }
    case "branch-checkout": {
      const ref = await reference(cwd, input, ["heads"]); await checkHead(cwd, input); await checkBranchWorktree(cwd, ref);
      args = ["switch", "--no-guess", "--", ref.slice("refs/heads/".length)]; break;
    }
    case "branch-rename": {
      const ref = await reference(cwd, input, ["heads"]); await checkBranchWorktree(cwd, ref);
      const name = text(input, "name"); await validName(cwd, name, "heads");
      args = ["branch", "-m", "--", ref.slice("refs/heads/".length), name]; break;
    }
    case "branch-delete": {
      const ref = await reference(cwd, input, ["heads"]); await checkBranchWorktree(cwd, ref);
      args = ["branch", "-d", "--", ref.slice("refs/heads/".length)]; break;
    }
    case "tag-delete": {
      const ref = await reference(cwd, input, ["tags"]);
      args = ["tag", "-d", "--", ref.slice("refs/tags/".length)]; break;
    }
    case "commit-checkout": {
      const sha = commit(input); await resolveCommit(cwd, sha); await checkHead(cwd, input);
      args = ["switch", "--detach", "--", sha]; break;
    }
    case "cherry-pick":
    case "revert": {
      const sha = commit(input); await resolveCommit(cwd, sha); await checkHead(cwd, input);
      const parents = (await run(cwd, ["rev-list", "--parents", "-n", "1", sha])).trim().split(/\s+/).slice(1);
      const parent = input.parentNumber;
      if (parents.length > 1 && (!Number.isInteger(parent) || Number(parent) < 1 || Number(parent) > parents.length)) {
        throw new GitGraphActionError("invalid_request", "A mainline parent is required for a merge commit");
      }
      if (parents.length <= 1 && parent !== undefined) throw new GitGraphActionError("invalid_request", "Unexpected mainline parent");
      args = [action, "--no-edit", ...(parents.length > 1 ? ["-m", String(parent)] : []), sha]; break;
    }
    case "merge":
    case "rebase": {
      const target = text(input, "target");
      let sha: string;
      if (/^[a-fA-F0-9]{40}$/.test(target)) {
        sha = await resolveCommit(cwd, target);
        if (sha !== commit(input, "expectedTargetSha")) throw new GitGraphActionError("stale_target", "The target changed", 409);
      } else {
        await reference(cwd, input, ["heads", "remotes"], "target");
      }
      await checkHead(cwd, input);
      args = action === "merge" ? ["merge", "--no-edit", "--", target] : ["rebase", "--", target]; break;
    }
    case "reset": {
      const sha = commit(input); await resolveCommit(cwd, sha); await checkHead(cwd, input);
      const mode = text(input, "mode");
      if (!["soft", "mixed", "hard"].includes(mode)) throw new GitGraphActionError("invalid_request", "Invalid reset mode");
      args = ["reset", `--${mode}`, sha]; break;
    }
    case "remote-checkout": {
      const ref = await reference(cwd, input, ["remotes"]); await checkHead(cwd, input);
      await remoteFor(cwd, input, ref);
      const name = text(input, "name"); await validName(cwd, name, "heads");
      args = ["switch", "--track", "-c", name, "--", ref]; break;
    }
    case "branch-push":
    case "tag-push": {
      const ref = await reference(cwd, input, [action === "branch-push" ? "heads" : "tags"]);
      const { remote } = await remoteFor(cwd, input);
      if (action === "branch-push" && typeof input.setUpstream !== "boolean") throw new GitGraphActionError("invalid_request", "Invalid upstream option");
      args = ["push", ...(action === "branch-push" && input.setUpstream ? ["--set-upstream"] : []), "--", remote, `${ref}:${ref}`]; isRemote = true; break;
    }
    case "remote-fetch":
    case "remote-pull":
    case "remote-delete": {
      const ref = await reference(cwd, input, ["remotes"]);
      const { remote, branch } = await remoteFor(cwd, input, ref);
      if (action === "remote-fetch") {
        const name = text(input, "name"); await validName(cwd, name, "heads");
        await resolveCommit(cwd, `refs/heads/${name}`);
        args = ["fetch", "--", remote, `refs/heads/${branch}:refs/heads/${name}`];
      } else if (action === "remote-pull") {
        await checkHead(cwd, input);
        args = ["pull", "--no-rebase", "--no-edit", "--", remote, `refs/heads/${branch}`];
      } else {
        args = ["push", "--", remote, `:refs/heads/${branch}`];
      }
      isRemote = true; break;
    }
    default: throw new GitGraphActionError("invalid_request", "Unknown Git action");
  }

  try {
    await run(cwd, args, isRemote);
  } catch (error) {
    const e = error as { stderr?: string; message?: string; killed?: boolean; signal?: string };
    if (e.killed || e.signal) throw new GitGraphActionError("result_unknown", "Git timed out; inspect the repository and remote before retrying.", 504);
    const conflicts = ["merge", "rebase", "cherry-pick", "revert", "remote-pull"].includes(action)
      ? await run(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => "") : "";
    if (conflicts) throw new GitGraphActionError("git_conflict", safeMessage(e.stderr || "Git conflict"), 409, conflicts.split("\0").filter(Boolean));
    if (isRemote) throw new GitGraphActionError("result_unknown", `Remote result not confirmed; inspect the remote before retrying. ${safeMessage(e.stderr || "")}`, 504);
    throw new GitGraphActionError("git_failed", safeMessage(e.stderr || e.message || "Git command failed"), 500);
  } finally {
    invalidateProjectCache();
  }
}

/** Resolve an authorized ref for read-only tag/archive endpoints. */
export async function validateGitGraphRef(cwd: string, ref: string, kinds: readonly string[]): Promise<string> {
  if (!kinds.some((kind) => ref.startsWith(`refs/${kind}/`)) || ref.includes("\n") || ref.includes("\r")) {
    throw new GitGraphActionError("invalid_request", "Invalid Git reference");
  }
  try { await run(cwd, ["check-ref-format", ref]); }
  catch { throw new GitGraphActionError("invalid_request", "Invalid Git reference"); }
  return resolveCommit(cwd, ref);
}

export async function getAnnotatedTag(cwd: string, ref: string): Promise<{ name: string; tagger: string; date: string; message: string }> {
  await validateGitGraphRef(cwd, ref, ["tags"]);
  const output = await run(cwd, ["for-each-ref", "--format=%(objecttype)%00%(taggername)%00%(taggeremail)%00%(taggerdate:iso-strict)%00%(contents)", ref]);
  const [type, name, email, date, ...message] = output.split("\0");
  if (type !== "tag") throw new GitGraphActionError("not_found", "This is not an annotated tag", 404);
  return { name: ref.slice("refs/tags/".length), tagger: `${name} ${email}`.trim(), date, message: message.join("\0").trim() };
}
