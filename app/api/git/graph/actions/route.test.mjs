import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "git-actions-route-")));
const previous = process.env.PI_CODING_AGENT_DIR;
const roots = globalThis.__piAdditionalAllowedRoots;
const cache = globalThis.__piAllowedRootsCache;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent"); fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
delete globalThis.__piAdditionalAllowedRoots; delete globalThis.__piAllowedRootsCache;
test.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cache; fs.rmSync(base, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST } = await jiti.import("./route.ts");
const { GET: tag } = await jiti.import("../tag/route.ts");
const { GET: archive } = await jiti.import("../archive/route.ts");
const { allowFileRoot } = await jiti.import("../../../../../lib/file-access.ts");
function fixture() {
  const repo = fs.mkdtempSync(path.join(base, "repo-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main"); git("config", "user.name", "Tester"); git("config", "user.email", "test@example.invalid"); git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "one.txt"), "hello\n"); git("add", "."); git("commit", "-qm", "initial");
  return { repo, git, sha: git("rev-parse", "HEAD") };
}
const post = (body) => POST(new Request("http://localhost/api/git/graph/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const request = (route, cwd, ref) => new Request(`http://localhost/api/git/graph/${route}?${new URLSearchParams({ cwd, ref })}`);

test("writes only to an authorized repository root and rejects invalid requests", async () => {
  const { repo, sha, git } = fixture(); const nested = path.join(repo, "nested"); fs.mkdirSync(nested); allowFileRoot(nested);
  const denied = await post({ cwd: nested, action: "branch-create", sha, name: "topic" }); assert.equal(denied.status, 403);
  allowFileRoot(repo);
  assert.equal((await post({ cwd: repo, action: "unknown" })).status, 400);
  const created = await post({ cwd: repo, action: "branch-create", sha, name: "topic" }); assert.equal(created.status, 200); assert.equal(git("rev-parse", "refs/heads/topic"), sha);
  const stale = await post({ cwd: repo, action: "branch-delete", ref: "refs/heads/topic", expectedTargetSha: "0".repeat(40) }); assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "stale_target");
});

test("annotated tags and streamed archives require access and return real data", async () => {
  const { repo, sha, git } = fixture(); git("tag", "-a", "v1", "-m", "release"); allowFileRoot(repo);
  const tagResponse = await tag(request("tag", repo, "refs/tags/v1")); assert.equal(tagResponse.status, 200); assert.match((await tagResponse.json()).message, /release/);
  const zip = await archive(request("archive", repo, "refs/tags/v1")); assert.equal(zip.status, 200); assert.equal(zip.headers.get("content-type"), "application/zip"); assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), "PK");
  assert.equal((await archive(request("archive", repo, "--help"))).status, 400);
  assert.equal(git("rev-parse", "HEAD"), sha);
});
