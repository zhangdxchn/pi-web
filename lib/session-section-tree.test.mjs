import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildSessionTree, adjacentProjectMove, getRowOffsets, groupBlocks, groupDropAt, sectionDropAt } = await createJiti(import.meta.url).import("./session-tree.ts");
const timestamp = "2026-10-01T00:00:00.000Z";
const session = (id, project) => ({ id, path: `${project}/${id}.jsonl`, cwd: project, projectRoot: project, projectKey: project, created: timestamp, modified: timestamp, messageCount: 1, firstMessage: id });
const input = (extra = {}) => ({ sessions: [session("a", "/a"), session("b", "/b"), session("c", "/c")], uiState: { version: 1, revision: 0, sessions: {}, projects: {}, projectOrder: ["/a", "/b", "/c"], sections: [{ id: "work", name: "Work" }, { id: "personal", name: "Personal" }], projectSections: { "/a": "work", "/b": "personal" } }, runningIds: new Set(), unreadIds: new Set(), selectedSessionId: null, currentProject: null, groupExpansion: {}, moreShown: {}, pinnedCollapsed: false, sectionCollapsed: new Set(), ...extra });
const outline = (rows) => rows.flatMap((row) => row.kind === "section" ? [`section:${row.sectionId ?? "ungrouped"}:${row.count}`] : row.kind === "group" ? [`project:${row.project.key}`] : []);

test("projects appear under their section, with an ungrouped bucket", () => {
  const model = buildSessionTree(input());
  assert.deepEqual(outline(model.rows), ["section:work:1", "project:/a", "section:personal:1", "project:/b", "section:ungrouped:1", "project:/c"]);
  assert.deepEqual(model.projects.map((project) => project.key), ["/a", "/b", "/c"]);
});

test("pinned projects remain globally first, retaining their section label", () => {
  const options = input();
  options.uiState.projects["/b"] = { root: "/b", pinnedAt: 10 };
  const model = buildSessionTree(options);
  assert.deepEqual(outline(model.rows), ["project:/b", "section:work:1", "project:/a", "section:personal:0", "section:ungrouped:1", "project:/c"]);
  assert.equal(model.projects[0].sectionName, "Personal");
  assert.equal(model.rows.find((row) => row.kind === "section-empty" && row.key === "section-empty:personal").pinnedCount, 1);
});

test("collapsed sections summarize unread and running families of their visible projects", () => {
  const model = buildSessionTree(input({
    sessions: [session("a", "/a"), session("a-read", "/a"), session("b", "/b")],
    sectionCollapsed: new Set(["work"]), runningIds: new Set(["a"]), unreadIds: new Set(["a"]),
  }));
  const section = model.rows.find((row) => row.kind === "section" && row.sectionId === "work");
  assert.equal(section.collapsed, true);
  assert.equal(section.count, 1);
  assert.equal(section.running, 1);
  assert.equal(section.unread, 1);
  assert.ok(model.rows.some((row) => row.key === "session:unread:a"));
  assert.equal(model.rows.some((row) => row.key === "session:group:a"), false);
  assert.equal(model.rows.some((row) => row.kind === "group" && row.project.key === "/a"), false);
  assert.equal(model.projects.some((project) => project.key === "/a"), true);
});

test("an unread-only non-current project stays out of the project tree", () => {
  const options = input({ unreadIds: new Set(["a"]), sectionCollapsed: new Set(["work"]) });
  const model = buildSessionTree(options);
  const section = model.rows.find((row) => row.kind === "section" && row.sectionId === "work");
  assert.ok(model.rows.some((row) => row.key === "session:unread:a"));
  assert.equal(model.projects.some((project) => project.key === "/a"), false);
  assert.equal(section.count, 0);
  assert.equal(section.unread, 0);
  assert.equal(options.uiState.projectSections["/a"], "work", "membership is retained");
});

test("current and pinned projects with only unread sessions keep their project groups", () => {
  const current = buildSessionTree(input({ unreadIds: new Set(["a"]), currentProject: { key: "/a", root: "/a" } }));
  assert.ok(current.rows.some((row) => row.key === "session:unread:a"));
  assert.ok(current.rows.some((row) => row.key === "group:/a"));
  const options = input({ unreadIds: new Set(["a"]) });
  options.uiState.projects["/a"] = { root: "/a", pinnedAt: 1 };
  const pinned = buildSessionTree(options);
  assert.ok(pinned.rows.some((row) => row.key === "session:unread:a"));
  assert.ok(pinned.rows.some((row) => row.key === "group:/a"));
  assert.equal(pinned.projects[0].sectionName, "Work");
});

test("unread precedes pinned; pinned unread families are not counted in the Section", () => {
  const options = input({
    sessions: [session("a", "/a"), session("a-read", "/a"), session("b", "/b")],
    unreadIds: new Set(["a"]), sectionCollapsed: new Set(["work"]),
  });
  options.uiState.sessions.a = { pinnedAt: 1 };
  options.uiState.sessions.b = { pinnedAt: 1 };
  const model = buildSessionTree(options);
  const unread = model.rows.findIndex((row) => row.kind === "unread-header");
  const pinned = model.rows.findIndex((row) => row.kind === "pinned-header");
  assert.ok(unread >= 0 && pinned > unread);
  assert.ok(model.rows.some((row) => row.key === "session:unread:a" && row.status.pinned));
  assert.equal(model.rows.some((row) => row.key === "session:pinned:a"), false);
  const section = model.rows.find((row) => row.kind === "section" && row.sectionId === "work");
  assert.equal(section.count, 1);
  assert.equal(section.unread, 0, "a pinned family already belongs to a global section");
});

test("archived unread sessions do not appear in unread or their Section", () => {
  const options = input({ unreadIds: new Set(["a"]) });
  options.uiState.sessions.a = { archivedAt: Date.parse(timestamp) + 1 };
  const model = buildSessionTree(options);
  const section = model.rows.find((row) => row.kind === "section" && row.sectionId === "work");
  assert.equal(model.archivedCount, 1);
  assert.equal(model.rows.some((row) => row.key === "session:unread:a"), false);
  assert.equal(model.projects.some((project) => project.key === "/a"), false);
  assert.equal(section.count, 0);
  assert.equal(options.uiState.projectSections["/a"], "work");
});

test("without sections the existing flat tree remains, with a create entry", () => {
  const options = input();
  delete options.uiState.sections;
  delete options.uiState.projectSections;
  const model = buildSessionTree(options);
  assert.deepEqual(outline(model.rows), ["project:/a", "project:/b", "project:/c"]);
  assert.ok(model.rows.some((row) => row.kind === "footer-new-section"));
});

test("reordering stays within a section; section headers accept cross-section drops", () => {
  const model = buildSessionTree(input());
  assert.equal(adjacentProjectMove(model.projects, "/a", "down"), null);
  const offsets = getRowOffsets(model.rows, "desktop");
  const blocks = groupBlocks(model.rows, offsets);
  const personal = model.rows.findIndex((row) => row.kind === "section" && row.sectionId === "personal");
  assert.deepEqual(sectionDropAt(model.rows, offsets, blocks, "/a", offsets[personal] + 3), { sectionId: "personal", lineY: offsets[personal + 1] });
  assert.equal(sectionDropAt(model.rows, offsets, blocks, "/b", offsets[personal] + 3), null);
  const otherGroup = model.rows.findIndex((row) => row.kind === "group" && row.project.key === "/b");
  assert.equal(sectionDropAt(model.rows, offsets, blocks, "/a", offsets[otherGroup] + 3), null, "another section's body is not an in-section reorder target");
  assert.equal(sectionDropAt(model.rows, offsets, blocks, "/b", offsets[otherGroup] + 3), undefined);
  assert.equal(groupDropAt(blocks, "/a", offsets[personal] + 3), null);
});
