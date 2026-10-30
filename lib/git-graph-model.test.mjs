import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGraphRows,
  getBezierPath,
  GRAPH_LANE_WIDTH,
  GRAPH_ROW_HEIGHT,
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
