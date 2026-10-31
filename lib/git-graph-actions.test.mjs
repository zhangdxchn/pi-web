import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { performGitGraphAction: act, getAnnotatedTag } = await jiti.import("./git-graph-actions.ts");
const { getGitGraph } = await jiti.import("./git-graph.ts");

function fixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "pi-web-git-actions-"));
  const repo = path.join(base, "repo"); mkdirSync(repo);
  const git = (...args) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  writeFileSync(path.join(repo, "file.txt"), "one\n"); git("add", "."); git("commit", "-qm", "first");
  const first = git("rev-parse", "HEAD");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { repo, base, git, first };
}

test("local branch and tag actions, exact refs, stale targets and invalid inputs", async (t) => {
  const { repo, git, first } = fixture(t);
  await act(repo, { action: "branch-create", sha: first, name: "origin/feature" });
  await act(repo, { action: "tag-create", sha: first, name: "v1", tagType: "annotated", message: "release" });
  const graph = await getGitGraph(repo);
  const refs = graph.commits[0].refs;
  assert.equal(refs.find((r) => r.name === "origin/feature").type, "branch");
  assert.equal(refs.find((r) => r.name === "v1").annotated, true);
  assert.equal((await getAnnotatedTag(repo, "refs/tags/v1")).message, "release");
  await assert.rejects(act(repo, { action: "branch-delete", ref: "refs/heads/origin/feature", expectedTargetSha: "0".repeat(40) }), { code: "stale_target" });
  await assert.rejects(act(repo, { action: "branch-create", sha: first, name: "--help" }), { code: "invalid_request" });
  await assert.rejects(act(repo, { action: "anything", args: ["status"] }), { code: "invalid_request" });
  await act(repo, { action: "branch-rename", ref: "refs/heads/origin/feature", expectedTargetSha: first, name: "topic" });
  await act(repo, { action: "branch-checkout", ref: "refs/heads/topic", expectedTargetSha: first, expectedHead: first });
  assert.equal(git("branch", "--show-current"), "topic");
  await act(repo, { action: "branch-checkout", ref: "refs/heads/main", expectedTargetSha: first, expectedHead: first });
  await act(repo, { action: "branch-delete", ref: "refs/heads/topic", expectedTargetSha: first });
  await act(repo, { action: "tag-delete", ref: "refs/tags/v1", expectedTargetSha: first });
  assert.equal(git("tag", "--list"), "");
});

test("Git hooks do not inherit the web password", { skip: process.platform === "win32" }, async (t) => {
  const { repo, git, first } = fixture(t);
  git("branch", "topic");
  const hook = path.join(repo, ".git", "hooks", "post-checkout");
  const output = path.join(repo, "hook-output");
  writeFileSync(hook, `#!/bin/sh\nprintf '%s' "\${PI_WEB_PASSWORD-unset}" > "${output}"\n`);
  chmodSync(hook, 0o755);
  const previous = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "test-web-password";
  try { await act(repo, { action: "branch-checkout", ref: "refs/heads/topic", expectedTargetSha: first, expectedHead: first }); }
  finally { if (previous === undefined) delete process.env.PI_WEB_PASSWORD; else process.env.PI_WEB_PASSWORD = previous; }
  assert.equal(readFileSync(output, "utf8"), "unset");
});

test("history operations use the intended commit, and reset refuses a stale HEAD", async (t) => {
  const { repo, git, first } = fixture(t);
  git("checkout", "-qb", "topic"); writeFileSync(path.join(repo, "topic.txt"), "topic\n"); git("add", "."); git("commit", "-qm", "topic"); const topic = git("rev-parse", "HEAD");
  git("checkout", "-q", "main");
  await act(repo, { action: "cherry-pick", sha: topic, expectedHead: first });
  const picked = git("rev-parse", "HEAD"); assert.notEqual(picked, first);
  await assert.rejects(act(repo, { action: "reset", sha: first, expectedHead: first, mode: "soft" }), { code: "stale_target" });
  await act(repo, { action: "revert", sha: picked, expectedHead: picked });
  const reverted = git("rev-parse", "HEAD");
  await act(repo, { action: "reset", sha: first, expectedHead: reverted, mode: "hard" });
  assert.equal(git("rev-parse", "HEAD"), first);
  await act(repo, { action: "merge", target: "refs/heads/topic", expectedTargetSha: topic, expectedHead: first });
  assert.equal(git("rev-parse", "HEAD"), topic);
  await act(repo, { action: "commit-checkout", sha: first, expectedHead: topic });
  assert.equal(git("branch", "--show-current"), "");
});

test("merge commits require an explicit mainline parent", async (t) => {
  const { repo, git, first } = fixture(t);
  git("checkout", "-qb", "topic"); writeFileSync(path.join(repo, "topic.txt"), "topic\n"); git("add", "."); git("commit", "-qm", "topic");
  git("checkout", "-q", "main"); writeFileSync(path.join(repo, "main.txt"), "main\n"); git("add", "."); git("commit", "-qm", "main");
  git("merge", "--no-ff", "-qm", "merge topic", "topic"); const merge = git("rev-parse", "HEAD"); git("reset", "--hard", first);
  await assert.rejects(act(repo, { action: "cherry-pick", sha: merge, expectedHead: first }), { code: "invalid_request" });
  await assert.rejects(act(repo, { action: "cherry-pick", sha: merge, expectedHead: first, parentNumber: 3 }), { code: "invalid_request" });
  await act(repo, { action: "cherry-pick", sha: merge, expectedHead: first, parentNumber: 1 });
  assert.equal(readFileSync(path.join(repo, "topic.txt"), "utf8"), "topic\n");
});

test("rebase moves the current branch onto the selected base", async (t) => {
  const { repo, git } = fixture(t);
  git("checkout", "-qb", "topic"); writeFileSync(path.join(repo, "topic.txt"), "topic\n"); git("add", "."); git("commit", "-qm", "topic"); const topic = git("rev-parse", "HEAD");
  git("checkout", "-q", "main"); writeFileSync(path.join(repo, "main.txt"), "main\n"); git("add", "."); git("commit", "-qm", "main"); const main = git("rev-parse", "HEAD");
  git("checkout", "-q", "topic");
  await act(repo, { action: "rebase", target: "refs/heads/main", expectedTargetSha: main, expectedHead: topic });
  assert.equal(git("branch", "--show-current"), "topic"); assert.equal(git("rev-parse", "HEAD^"), main);
});

test("a branch checked out in another worktree returns its path", async (t) => {
  const { repo, base, git, first } = fixture(t);
  const other = path.join(base, "other"); git("worktree", "add", "-qb", "occupied", other);
  await assert.rejects(act(repo, { action: "branch-checkout", ref: "refs/heads/occupied", expectedTargetSha: first, expectedHead: first }), (error) => error.code === "worktree_in_use" && realpathSync(error.worktreePath) === realpathSync(other));
  git("worktree", "remove", other);
});

test("merge conflicts remain available for manual abort", async (t) => {
  const { repo, git, first } = fixture(t);
  git("checkout", "-qb", "topic"); writeFileSync(path.join(repo, "file.txt"), "topic\n"); git("add", "."); git("commit", "-qm", "topic"); const topic = git("rev-parse", "HEAD");
  git("checkout", "-q", "main"); writeFileSync(path.join(repo, "file.txt"), "main\n"); git("add", "."); git("commit", "-qm", "main"); const head = git("rev-parse", "HEAD");
  await assert.rejects(act(repo, { action: "merge", target: "refs/heads/topic", expectedTargetSha: topic, expectedHead: head }), (error) => error.code === "git_conflict" && error.conflictFiles.includes("file.txt"));
  assert.equal(git("rev-parse", "HEAD"), head);
  git("merge", "--abort"); assert.equal(git("status", "--porcelain"), ""); assert.notEqual(first, head);
});

test("remote checkout, fetch, pull and delete use the selected remote", async (t) => {
  const { repo, base, git, first } = fixture(t);
  const bare = path.join(base, "remote.git"); execFileSync("git", ["init", "--bare", "-q", bare]); git("remote", "add", "origin", bare);
  git("push", "-q", "origin", "main:main"); git("branch", "remote-topic"); git("push", "-q", "origin", "remote-topic:remote-topic"); git("branch", "-D", "remote-topic"); git("fetch", "-q", "origin");
  await act(repo, { action: "remote-checkout", ref: "refs/remotes/origin/remote-topic", expectedTargetSha: first, expectedHead: first, remote: "origin", name: "checked-out" });
  assert.equal(git("branch", "--show-current"), "checked-out");
  git("checkout", "-q", "main"); git("branch", "local-copy");
  await act(repo, { action: "remote-fetch", ref: "refs/remotes/origin/remote-topic", expectedTargetSha: first, remote: "origin", name: "local-copy" });
  await act(repo, { action: "remote-pull", ref: "refs/remotes/origin/remote-topic", expectedTargetSha: first, expectedHead: first, remote: "origin" });
  await act(repo, { action: "remote-delete", ref: "refs/remotes/origin/remote-topic", expectedTargetSha: first, remote: "origin" });
  assert.throws(() => execFileSync("git", ["-C", bare, "rev-parse", "--verify", "refs/heads/remote-topic"], { stdio: "ignore" }));
});

test("normal branch and tag push to a local bare remote", async (t) => {
  const { repo, base, git, first } = fixture(t);
  const bare = path.join(base, "remote.git"); execFileSync("git", ["init", "--bare", "-q", bare]); git("remote", "add", "origin", bare);
  await act(repo, { action: "branch-push", ref: "refs/heads/main", expectedTargetSha: first, remote: "origin", setUpstream: true });
  assert.equal(execFileSync("git", ["-C", bare, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim(), first);
  await act(repo, { action: "tag-create", sha: first, name: "v2", tagType: "lightweight" });
  await act(repo, { action: "tag-push", ref: "refs/tags/v2", expectedTargetSha: first, remote: "origin" });
  assert.equal(execFileSync("git", ["-C", bare, "rev-parse", "refs/tags/v2"], { encoding: "utf8" }).trim(), first);
});
