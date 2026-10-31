import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-graph-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { NextRequest } = await jiti.import("next/server");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Tester");
  git(root, "config", "user.email", "tester@example.com");
  fs.writeFileSync(path.join(root, "file.txt"), "hello world\n");
  git(root, "add", "file.txt");
  git(root, "commit", "-m", "initial commit");
  allowFileRoot(root);
  return root;
}

test("rejects missing or non-absolute cwd", async () => {
  const res = await GET(new NextRequest("http://localhost/api/git/graph"));
  assert.equal(res.status, 400);

  const resRel = await GET(new NextRequest("http://localhost/api/git/graph?cwd=relative/path"));
  assert.equal(resRel.status, 400);
});

test("returns commits and branches for an allowed git repository", async () => {
  const repo = fixture();
  const url = new URL("http://localhost/api/git/graph");
  url.searchParams.set("cwd", repo);

  const res = await GET(new NextRequest(url));
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.isGitRepository, true);
  assert.equal(data.commits.length, 1);
  assert.equal(data.commits[0].subject, "initial commit");
  assert.ok(data.commits[0].sha);
});

test("returns commit details when sha param is provided", async () => {
  const repo = fixture();
  const graphUrl = new URL("http://localhost/api/git/graph");
  graphUrl.searchParams.set("cwd", repo);

  const graphRes = await GET(new NextRequest(graphUrl));
  const graphData = await graphRes.json();
  const sha = graphData.commits[0].sha;

  const detailUrl = new URL("http://localhost/api/git/graph");
  detailUrl.searchParams.set("cwd", repo);
  detailUrl.searchParams.set("sha", sha);

  const detailRes = await GET(new NextRequest(detailUrl));
  assert.equal(detailRes.status, 200);

  const detail = await detailRes.json();
  assert.equal(detail.sha, sha);
  assert.equal(detail.subject, "initial commit");
  assert.equal(detail.files.length, 1);
  assert.equal(detail.files[0].filePath, "file.txt");
  assert.equal(detail.files[0].additions, 1);
});

function graphRequest(cwd, params) {
  const url = new URL("http://localhost/api/git/graph");
  url.searchParams.set("cwd", cwd);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return GET(new NextRequest(url));
}

test("returns a selected commit's file diff, independent of the current worktree and cwd", async () => {
  const repo = fixture();
  const initial = git(repo, "rev-parse", "HEAD").trim();
  const nested = path.join(repo, "nested");
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(repo, "file.txt"), "committed change\n");
  git(repo, "add", "file.txt");
  git(repo, "commit", "-qm", "change file");
  const selected = git(repo, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(repo, "file.txt"), "uncommitted change\n");

  const response = await graphRequest(nested, { sha: selected, path: "file.txt" });
  assert.equal(response.status, 200);
  const { patch } = await response.json();
  assert.match(patch, /-hello world/);
  assert.match(patch, /\+committed change/);
  assert.doesNotMatch(patch, /uncommitted change/);

  const rootPatch = await (await graphRequest(repo, { sha: initial, path: "file.txt" })).json();
  assert.match(rootPatch.patch, /\+hello world/);
  fs.unlinkSync(path.join(repo, "file.txt"));
  const deletedWorkingFile = await graphRequest(repo, { sha: selected, path: "file.txt" });
  assert.equal(deletedWorkingFile.status, 200);
  assert.match((await deletedWorkingFile.json()).patch, /\+committed change/);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "delete file");
  const deletedSha = git(repo, "rev-parse", "HEAD").trim();
  const deletion = await graphRequest(repo, { sha: deletedSha, path: "file.txt" });
  assert.equal(deletion.status, 200);
  assert.match((await deletion.json()).patch, /-committed change/);
});

test("commit details and diffs preserve spaces, Unicode and rename paths", async () => {
  const repo = fixture();
  const oldPath = "old name.txt";
  const newPath = "新 name.txt";
  const original = Array.from({ length: 12 }, (_, index) => `line ${index}\n`).join("");
  fs.writeFileSync(path.join(repo, oldPath), original);
  git(repo, "add", oldPath);
  git(repo, "commit", "-qm", "add file");
  git(repo, "mv", oldPath, newPath);
  fs.writeFileSync(path.join(repo, newPath), original.replace("line 5\n", "renamed line\n"));
  git(repo, "add", newPath);
  git(repo, "commit", "-qm", "rename file");
  const sha = git(repo, "rev-parse", "HEAD").trim();

  const detail = await (await graphRequest(repo, { sha })).json();
  const renamed = detail.files.find((file) => file.filePath === newPath);
  assert.ok(renamed, "commit details must expose the actual new path");
  assert.equal(renamed.status, "renamed");
  assert.equal(renamed.originalPath, oldPath);
  const response = await graphRequest(repo, { sha, path: newPath });
  assert.equal(response.status, 200);
  const { patch } = await response.json();
  assert.match(patch, /rename from old name\.txt/);
  assert.match(patch, /-line 5/);
  assert.match(patch, /\+renamed line/);
});

test("merge commits compare against the first parent", async () => {
  const repo = fixture();
  const main = git(repo, "branch", "--show-current").trim();
  git(repo, "checkout", "-qb", "topic");
  fs.writeFileSync(path.join(repo, "file.txt"), "topic change\n");
  git(repo, "add", "file.txt");
  git(repo, "commit", "-qm", "topic change");
  git(repo, "checkout", "-q", main);
  git(repo, "merge", "--no-ff", "-qm", "merge topic", "topic");
  const sha = git(repo, "rev-parse", "HEAD").trim();
  const detail = await (await graphRequest(repo, { sha })).json();
  assert.ok(detail.files.some((file) => file.filePath === "file.txt"));
  const response = await graphRequest(repo, { sha, path: "file.txt" });
  assert.equal(response.status, 200);
  const { patch } = await response.json();
  assert.match(patch, /-hello world/);
  assert.match(patch, /\+topic change/);
});

test("historical diffs refuse traversal and paths through an outside symlink", async () => {
  const repo = fixture();
  const sha = git(repo, "rev-parse", "HEAD").trim();
  for (const target of ["../outside.txt", path.join(repo, "file.txt")]) {
    const response = await graphRequest(repo, { sha, path: target });
    assert.ok([400, 403].includes(response.status), target);
  }
  if (process.platform !== "win32") {
    const outside = fs.mkdtempSync(path.join(base, "outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside secret\n");
    fs.symlinkSync(outside, path.join(repo, "linked"), "dir");
    const response = await graphRequest(repo, { sha, path: "linked/secret.txt" });
    assert.equal(response.status, 403);
  }
});

test("rejects unsafe branch or sha parameters", async () => {
  const repo = fixture();

  const unsafeBranchUrl = new URL("http://localhost/api/git/graph");
  unsafeBranchUrl.searchParams.set("cwd", repo);
  unsafeBranchUrl.searchParams.set("branch", "--unsafe-flag");
  const branchRes = await GET(new NextRequest(unsafeBranchUrl));
  assert.equal(branchRes.status, 400);

  const unsafeShaUrl = new URL("http://localhost/api/git/graph");
  unsafeShaUrl.searchParams.set("cwd", repo);
  unsafeShaUrl.searchParams.set("sha", "invalid-sha!");
  const shaRes = await GET(new NextRequest(unsafeShaUrl));
  assert.equal(shaRes.status, 400);
});
