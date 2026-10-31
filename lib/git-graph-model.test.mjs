import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGraphRows,
  formatCommitDate,
  getBezierPath,
  getRefBadgeStyle,
  GRAPH_LANE_WIDTH,
  GRAPH_ROW_HEIGHT,
  withWorkingTreeNode,
  WORKING_TREE_NODE_ID,
} from "./git-graph-model.ts";

function makeCommit(sha, parents, subject = "commit") {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    author: "author",
    authorEmail: "author@test.com",
    committedAt: "2026-04-20T00:00:00Z",
    subject,
    refs: [],
  };
}

test("empty commits list yields empty rows", () => {
  assert.deepEqual(computeGraphRows([]), []);
});

test("uncommitted changes form a display-only node connected to the loaded HEAD", () => {
  const commits = [makeCommit("other", ["root"]), makeCommit("head", ["root"]), makeCommit("root", [])];
  const result = withWorkingTreeNode(commits, "head", 5, "Uncommitted Changes (5)", "2026-10-31T00:00:00Z");
  assert.equal(result.length, 4);
  assert.equal(result[0].sha, WORKING_TREE_NODE_ID);
  assert.equal(result[0].shortSha, "*");
  assert.deepEqual(result[0].parents, ["head"]);
  assert.equal(result[0].subject, "Uncommitted Changes (5)");
  assert.deepEqual(commits.map((commit) => commit.sha), ["other", "head", "root"]);
  const rows = computeGraphRows(result);
  assert.equal(rows[0].lane, rows[2].lane, "working tree connects to HEAD even when another branch is newer");
  assert.equal(rows[0].hasBottomStraight, true);
  assert.ok(rows[1].passThroughLanes.includes(rows[0].lane));
  assert.equal(rows[2].hasTopStraight, true);
});

test("uncommitted node is absent for a clean tree, an unborn HEAD, or an excluded HEAD", () => {
  const commits = [makeCommit("head", ["root"]), makeCommit("root", [])];
  assert.equal(withWorkingTreeNode(commits, "head", 0, "", ""), commits);
  assert.equal(withWorkingTreeNode(commits, "", 3, "", ""), commits);
  assert.equal(withWorkingTreeNode(commits, "other", 3, "", ""), commits);
  assert.equal(withWorkingTreeNode([], "head", 3, "", "").length, 0);
});

test("linear commits stay on lane 0 with top/bottom connections", () => {
  const commits = [
    makeCommit("c3", ["c2"]),
    makeCommit("c2", ["c1"]),
    makeCommit("c1", []),
  ];

  const rows = computeGraphRows(commits);
  assert.equal(rows.length, 3);

  // c3: head, lane 0
  assert.equal(rows[0].lane, 0);
  assert.equal(rows[0].hasTopStraight, false);
  assert.equal(rows[0].hasBottomStraight, true);
  assert.deepEqual(rows[0].passThroughLanes, []);
  assert.equal(rows[0].curves.length, 0);

  // c2: middle, lane 0
  assert.equal(rows[1].lane, 0);
  assert.equal(rows[1].hasTopStraight, true);
  assert.equal(rows[1].hasBottomStraight, true);
  assert.equal(rows[1].curves.length, 0);

  // c1: root, lane 0
  assert.equal(rows[2].lane, 0);
  assert.equal(rows[2].hasTopStraight, true);
  assert.equal(rows[2].hasBottomStraight, false); // no parents
  assert.equal(rows[2].curves.length, 0);
});

test("fork and merge assigns distinct lanes and curves", () => {
  // c4 (merge of c3 and c2) -> c3 -> c1, c2 -> c1, c1 (root)
  const commits = [
    makeCommit("c4", ["c3", "c2"], "merge commit"),
    makeCommit("c3", ["c1"]),
    makeCommit("c2", ["c1"]),
    makeCommit("c1", []),
  ];

  const rows = computeGraphRows(commits);
  assert.equal(rows.length, 4);

  // c4 is a merge commit
  assert.equal(rows[0].isMerge, true);
  assert.equal(rows[0].lane, 0);
  assert.equal(rows[0].hasBottomStraight, true);
  assert.equal(rows[0].curves.length, 1);
  assert.equal(rows[0].curves[0].type, "to-bottom");
  assert.equal(rows[0].curves[0].fromLane, 0);
  assert.equal(rows[0].curves[0].toLane, 1);

  // c3 is on lane 0, c2 passes through lane 1
  assert.equal(rows[1].lane, 0);
  assert.deepEqual(rows[1].passThroughLanes, [1]);

  // c2 is on lane 1 and connects to c1 on lane 0
  assert.equal(rows[2].lane, 1);
});

test("getBezierPath produces valid SVG path commands", () => {
  const fromTop = {
    fromLane: 1,
    toLane: 0,
    type: "from-top",
    colorIndex: 1,
  };
  const path1 = getBezierPath(fromTop, GRAPH_LANE_WIDTH, GRAPH_ROW_HEIGHT);
  assert.ok(path1.startsWith("M "), "starts with M");
  assert.ok(path1.includes(" C "), "contains cubic bezier command C");

  const toBottom = {
    fromLane: 0,
    toLane: 2,
    type: "to-bottom",
    colorIndex: 2,
  };
  const path2 = getBezierPath(toBottom, GRAPH_LANE_WIDTH, GRAPH_ROW_HEIGHT);
  assert.ok(path2.startsWith("M "));
  assert.ok(path2.includes(" C "));
});

test("formatCommitDate converts ISO timestamp with timezone into local date/time", () => {
  const iso = "2026-10-29T22:41:28+01:00";
  const formatted = formatCommitDate(iso, true);
  // Parses as real timestamp (1793310088) and formats local YYYY-MM-DD HH:MM
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatted));
  // Year is 2026
  assert.ok(formatted.startsWith("2026-"));
  // When includeTime = false, only date is returned
  const dateOnly = formatCommitDate(iso, false);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(dateOnly));
});

test("getRefBadgeStyle aligns branch name and border colors with curve color", () => {
  const curveColor = "#22c55e"; // green curve from lane 2

  // 1. Remote branch (like upstream/pi-extension-manager)
  const remoteRef = { type: "remote", name: "upstream/pi-extension-manager" };
  const remoteStyle = getRefBadgeStyle(remoteRef, curveColor);
  assert.equal(remoteStyle.color, curveColor, "remote branch name text color must match curve color");
  assert.equal(remoteStyle.border, `1px dashed ${curveColor}`, "remote branch border must match curve color and be dashed");
  assert.match(remoteStyle.bg, /color-mix/, "remote branch background should use subtle tint");

  // 2. Local branch
  const branchRef = { type: "branch", name: "feat/git-graph" };
  const branchStyle = getRefBadgeStyle(branchRef, "#3b82f6");
  assert.equal(branchStyle.color, "#3b82f6", "local branch name text color must match curve color");
  assert.equal(branchStyle.border, "1px solid #3b82f6", "local branch border must match curve color and be solid");

  // 3. Current local branch
  const currentBranchRef = { type: "branch", name: "main", current: true };
  const currentStyle = getRefBadgeStyle(currentBranchRef, "#f59e0b");
  assert.equal(currentStyle.color, "#f59e0b", "current branch name text color must match curve color");
  assert.equal(currentStyle.border, "1px solid #f59e0b", "current branch border must match curve color");
  assert.equal(currentStyle.fontWeight, 600, "current branch should be highlighted bolder");

  // 4. Tag retains dedicated amber badge
  const tagRef = { type: "tag", name: "v1.0.0" };
  const tagStyle = getRefBadgeStyle(tagRef, curveColor);
  assert.equal(tagStyle.color, "#fcd34d");
  assert.equal(tagStyle.border, "1px solid #78350f");

  // 5. HEAD pointer retains dedicated head badge
  const headRef = { type: "head", name: "HEAD" };
  const headStyle = getRefBadgeStyle(headRef, curveColor);
  assert.equal(headStyle.color, "#6ee7b7");
  assert.equal(headStyle.border, "1px solid #047857");
});


