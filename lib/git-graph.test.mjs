import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeRef,
  assertSafeSha,
  parseGitRefs,
  getGitGraph,
  getGitCommitDetail,
} from "./git-graph.ts";

test("assertSafeRef validates branch and ref strings safely", () => {
  // Valid refs
  assert.doesNotThrow(() => assertSafeRef("main"));
  assert.doesNotThrow(() => assertSafeRef("feat/git-graph"));
  assert.doesNotThrow(() => assertSafeRef("v1.0.0"));
  assert.doesNotThrow(() => assertSafeRef("origin/main"));

  // Refusal of flags and injection characters
  assert.throws(() => assertSafeRef(""), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("-f"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("--help"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("foo bar"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("foo..bar"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("foo@{1}"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("foo^"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("foo~2"), /Invalid git ref name/);
  assert.throws(() => assertSafeRef("foo:bar"), /Invalid git ref name/);
});

test("assertSafeSha validates commit SHAs strictly", () => {
  assert.doesNotThrow(() => assertSafeSha("7a8f92b"));
  assert.doesNotThrow(() => assertSafeSha("7a8f92b4198c61a5b4f2c009d57a2c114f6b2819"));

  assert.throws(() => assertSafeSha("abc"), /Invalid git commit SHA/);
  assert.throws(() => assertSafeSha("xyz1234"), /Invalid git commit SHA/);
  assert.throws(() => assertSafeSha("-f"), /Invalid git commit SHA/);
  assert.throws(() => assertSafeSha("7a8f92b; rm -rf"), /Invalid git commit SHA/);
});

test("parseGitRefs correctly extracts HEAD, branches, remotes, and tags", () => {
  const remotes = ["origin", "upstream"];
  const raw = "HEAD -> feat/git-graph, origin/feat/git-graph, tag: v0.13.0, main";

  const refs = parseGitRefs(raw, remotes, "feat/git-graph");

  assert.deepEqual(refs, [
    { type: "head", name: "HEAD", current: true },
    { type: "branch", name: "feat/git-graph", current: true },
    { type: "remote", name: "origin/feat/git-graph" },
    { type: "tag", name: "v0.13.0" },
    { type: "branch", name: "main", current: false },
  ]);
});

test("getGitGraph retrieves commits and branches from the current repository", async () => {
  const result = await getGitGraph(process.cwd(), { maxCount: 10 });

  assert.equal(result.isGitRepository, true);
  assert.ok(result.commits.length > 0, "commits should not be empty");
  assert.ok(result.commits[0].sha.length >= 7, "commit has valid SHA");
  assert.ok(result.commits[0].subject.length > 0, "commit has subject");
  assert.ok(Array.isArray(result.branches), "branches is an array");
});

test("getGitCommitDetail retrieves commit metadata and changed files", async () => {
  const graph = await getGitGraph(process.cwd(), { maxCount: 1 });
  assert.ok(graph.commits.length > 0);

  const headSha = graph.commits[0].sha;
  const detail = await getGitCommitDetail(process.cwd(), headSha);

  assert.ok(detail, "detail should exist");
  assert.equal(detail.sha, headSha);
  assert.ok(detail.subject);
  assert.ok(Array.isArray(detail.files));
});
