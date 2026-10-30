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
