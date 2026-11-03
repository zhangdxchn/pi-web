import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { computeGraphRows, formatCommitDate, WORKING_TREE_NODE_ID } = await jiti.import("./git-graph-model.ts");
const { findGitGraphMatches } = await jiti.import("./git-graph-search.ts");
const commit = (sha, subject, refs = [], author = "Alice") => ({
  sha, shortSha: sha.slice(0, 7), parents: [], subject, refs,
  author, authorEmail: "alice@example.invalid", committedAt: "2026-11-03T15:24:00Z",
});
const working = commit(WORKING_TREE_NODE_ID, "sections working");
const first = commit("abcdef0123456789abcdef0123456789abcdef01", "Sections and sections", [{ type: "branch", name: "feat/sections" }]);
const middle = commit("bbbbbbb123456789bbbbbbb123456789bbbbbbb1", "Unrelated");
const last = commit("ccccccc123456789ccccccc123456789ccccccc1", "Other", [{ type: "tag", name: "sections" }], "Bob");
const rows = computeGraphRows([working, first, middle, last]);
const find = (q, sensitive = false, regex = false) => findGitGraphMatches(rows, q, sensitive, regex);

test("matches commits rather than occurrences, including refs, without filtering graph rows", () => {
  const result = find("sections");
  assert.equal(result.error, null);
  assert.deepEqual(result.matches.map(({ rowIndex }) => rowIndex), [1, 3]);
  assert.equal(result.matches[0].subject.length, 2);
  assert.equal(result.matches[0].refs[0].length, 1);
  assert.equal(rows.length, 4);
  assert.equal(find("working").matches.length, 0);
});

test("finds author, formatted date and a full SHA prefix; supports literal punctuation", () => {
  assert.deepEqual(find("bob").matches.map((hit) => hit.rowIndex), [3]);
  assert.equal(find(formatCommitDate(first.committedAt)).matches.length, 3);
  assert.deepEqual(find("abcdef01234").matches[0].shortSha, [{ start: 0, end: 7 }]);
  assert.equal(find("123456789abcdef").matches.length, 0, "a full SHA match must start at the beginning");
  assert.equal(find("feat/").matches.length, 1);
  assert.equal(find("sec.ions").matches.length, 0, "a dot is literal unless regex mode is on");
});

test("case and regex options, invalid syntax and zero-length matches", () => {
  assert.deepEqual(find("Sections", true).matches.map((hit) => hit.rowIndex), [1]);
  assert.deepEqual(find("sec.ions", false, true).matches.map((hit) => hit.rowIndex), [1, 3]);
  assert.deepEqual(find("[", false, true), { matches: [], error: "invalid-pattern" });
  assert.deepEqual(find("^", false, true), { matches: [], error: "empty-match" });
  assert.deepEqual(find("sections|$", false, true), { matches: [], error: "empty-match" });
  assert.deepEqual(find(""), { matches: [], error: null });
});
