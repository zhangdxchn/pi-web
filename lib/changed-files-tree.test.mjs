import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildChangedFilesTree, visibleChangedFileRows } = await jiti.import("./changed-files-tree.ts");
const { getRelativeFilePath } = await jiti.import("./file-paths.ts");

function rows(files, choices = new Map()) {
  return visibleChangedFileRows(buildChangedFilesTree(files, (file) => file.path), choices);
}

test("groups changed files and opens only first-level directories", () => {
  const files = [
    { path: "root.txt", status: "deleted" },
    { path: "app/other.ts", status: "modified" },
    { path: "app/deep/中文.ts", status: "untracked" },
    { path: "docs/other.ts", status: "renamed" },
  ];
  const visible = rows(files);
  assert.deepEqual(visible.map((row) => [row.kind, row.path, row.depth]), [
    ["folder", "app", 0], ["folder", "app/deep", 1], ["file", "app/other.ts", 1],
    ["folder", "docs", 0], ["file", "docs/other.ts", 1], ["file", "root.txt", 0],
  ]);
  assert.equal(visible.find((row) => row.path === "app/deep").expanded, false);
  assert.equal(visible.find((row) => row.path === "root.txt").file, files[0]);
  const expanded = rows(files, new Map([["app/deep", true], ["docs", false]]));
  assert.ok(expanded.some((row) => row.path === "app/deep/中文.ts"));
  assert.ok(!expanded.some((row) => row.path === "docs/other.ts"));
  assert.equal(new Set(expanded.map((row) => row.filePath)).size, expanded.length);
});

test("preserves a deleted file when a directory replaces it", () => {
  for (const files of [
    [{ path: "name", status: "deleted" }, { path: "name/new.txt", status: "added" }],
    [{ path: "name/new.txt", status: "added" }, { path: "name", status: "deleted" }],
  ]) {
    const visible = rows(files);
    assert.deepEqual(visible.map((row) => [row.kind, row.path]), [
      ["folder", "name"], ["file", "name/new.txt"], ["file", "name"],
    ]);
    assert.equal(new Set(visible.map((row) => row.filePath)).size, 3);
  }
});

test("retains original paths for Windows and POSIX names", () => {
  const windows = { path: "C:\\repo\\src\\file.ts" };
  const tree = buildChangedFilesTree([windows], (file) => getRelativeFilePath(file.path, "C:\\repo"));
  const file = visibleChangedFileRows(tree, new Map()).find((row) => row.kind === "file");
  assert.equal(file.path, "src/file.ts");
  assert.equal(file.file, windows);
  assert.equal(getRelativeFilePath("/repo/literal\\name.txt", "/repo"), "literal\\name.txt");
  assert.deepEqual(rows([]), []);
});

test("large changed trees can collapse without materializing hidden rows", () => {
  const files = Array.from({ length: 43_817 }, (_, i) => ({ path: `src/file-${String(i).padStart(5, "0")}.ts` }));
  const tree = buildChangedFilesTree(files, (file) => file.path);
  assert.equal(visibleChangedFileRows(tree, new Map()).length, 43_818);
  const collapsed = visibleChangedFileRows(tree, new Map([["src", false]]));
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].expanded, false);
});
