import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applySessionUiStateRequest,
  emptySessionUiState,
  normalizeSessionUiState,
  parseSessionUiStateRequest,
} = await jiti.import("./session-ui-state-shared.ts");

function request(body) {
  const parsed = parseSessionUiStateRequest(body);
  assert.equal(parsed.ok, true, parsed.error);
  return parsed.request;
}

function apply(state, body) {
  return applySessionUiStateRequest(state, request(body), 100);
}

const create = (id, name, projectKey) => ({ action: "create-section", id, name, ...(projectKey ? { projectKey } : {}) });
const assign = (projectKey, sectionId, add = []) => ({ action: "assign-project-section", projectKey, sectionId, add });

test("normalizes sections and valid memberships without disturbing older state", () => {
  const result = normalizeSessionUiState({
    version: 1, revision: 5, sessions: {}, projects: {},
    sections: [{ id: "work", name: " Work " }, { id: "work", name: "Other" }, { id: "bad/id", name: "Bad" }, { id: "duplicate", name: "Work" }, { id: "personal", name: "Personal" }],
    projectSections: { "/work": "work", "/missing": "missing", "/personal": "personal" },
  });
  assert.deepEqual(result.sections, [{ id: "work", name: "Work" }, { id: "personal", name: "Personal" }]);
  assert.deepEqual(result.projectSections, { "/work": "work", "/personal": "personal" });
  assert.equal(result.revision, 5);
  assert.deepEqual(normalizeSessionUiState({ version: 1, sessions: {}, projects: {} }), emptySessionUiState());
});

test("parses section actions and refuses malformed ids, names, and targets", () => {
  assert.deepEqual(request(create("work", "  Team  ", "/repo")), create("work", "Team", "/repo"));
  assert.deepEqual(request(assign("/repo", null)), assign("/repo", null));
  assert.deepEqual(request({ action: "move-section", id: "work", anchorId: "personal", position: "after" }), { action: "move-section", id: "work", anchorId: "personal", position: "after" });
  for (const body of [
    create("../work", "Team"), create("work", ""), create("work", "未分组"),
    create("work", "未分組"), create("work", "Ungrouped"), create("work", "line\nbreak"),
    create("work", "a".repeat(81)), create("a".repeat(129), "Team"),
    { action: "rename-section", id: "work", name: null },
    { action: "delete-section", id: "" },
    { action: "move-section", id: "same", anchorId: "same", position: "after" },
    { action: "move-section", id: "work", anchorId: "personal", position: "middle" },
    assign("__proto__", "work"), assign("/repo", "missing/slash"),
  ]) assert.equal(parseSessionUiStateRequest(body).ok, false, JSON.stringify(body));
});

test("create, rename, order and delete sections without touching projects or sessions", () => {
  const initial = { ...emptySessionUiState(), sessions: { a: { pinnedAt: 1 } }, projects: { "/p": { root: "/p", pinnedAt: 1 } } };
  const copy = structuredClone(initial);
  let state = apply(initial, create("work", "Work")).state;
  state = apply(state, create("personal", "Personal")).state;
  state = apply(state, { action: "rename-section", id: "work", name: "Team" }).state;
  state = apply(state, { action: "move-section", id: "personal", anchorId: "work", position: "before" }).state;
  assert.deepEqual(state.sections, [{ id: "personal", name: "Personal" }, { id: "work", name: "Team" }]);
  state = apply(state, assign("/p", "work")).state;
  state = apply(state, assign("/x", "work")).state;
  state = apply(state, { action: "delete-section", id: "work" }).state;
  assert.deepEqual(state.sections, [{ id: "personal", name: "Personal" }]);
  assert.equal(state.projectSections, undefined);
  assert.deepEqual(state.sessions, initial.sessions);
  assert.deepEqual(state.projects, initial.projects);
  assert.deepEqual(initial, copy, "no input mutation");
});

test("moving a project changes its membership and puts it first; pinned project order stays", () => {
  let state = { ...emptySessionUiState(), sections: [{ id: "work", name: "Work" }, { id: "other", name: "Other" }], projectOrder: ["/pinned", "/a", "/b"], projects: { "/pinned": { pinnedAt: 1, root: "/pinned" } }, projectSections: { "/a": "work", "/b": "work" } };
  state = apply(state, assign("/b", "other")).state;
  assert.deepEqual(state.projectOrder, ["/b", "/pinned", "/a"]);
  assert.equal(state.projectSections["/b"], "other");
  const before = [...state.projectOrder];
  state = apply(state, assign("/pinned", "work")).state;
  assert.deepEqual(state.projectOrder, before);
  assert.equal(state.projectSections["/pinned"], "work");
  state = apply(state, assign("/b", null)).state;
  assert.equal(Object.hasOwn(state.projectSections, "/b"), false);
  assert.equal(state.projectOrder[0], "/b");
});

test("assignment records unsaved projects first and a repeated assignment does not reorder", () => {
  const start = { ...emptySessionUiState(), sections: [{ id: "work", name: "Work" }], projectOrder: ["/old"] };
  const moved = apply(start, assign("/moving", "work", ["/unsaved", "/moving"]));
  assert.deepEqual(moved.state.projectOrder, ["/moving", "/unsaved", "/old"]);
  const same = apply(moved.state, assign("/moving", "work", []));
  assert.equal(same.changed, false);
  assert.deepEqual(same.state, moved.state);
});

test("create-and-assign is atomic and handles stale or duplicate requests", () => {
  const start = { ...emptySessionUiState(), projectOrder: ["/other", "/repo"] };
  const created = apply(start, create("work", "Work", "/repo"));
  assert.deepEqual(created.state.projectSections, { "/repo": "work" });
  assert.deepEqual(created.state.projectOrder, ["/repo", "/other"]);
  const repeated = apply(created.state, create("work", "Work", "/repo"));
  assert.equal(repeated.changed, false);
  const duplicate = apply(created.state, create("other", "Work", "/other"));
  assert.equal(duplicate.reason, "duplicate-section");
  assert.deepEqual(duplicate.state, created.state);
  const missing = apply(created.state, assign("/repo", "missing"));
  assert.equal(missing.reason, "missing-section");
  assert.deepEqual(missing.state, created.state);
});

test("full section and membership lists reject additions without losing prior data", () => {
  const sections = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, name: `Section ${i}` }));
  const fullSections = { ...emptySessionUiState(), sections };
  const refused = apply(fullSections, create("new", "New", "/project"));
  assert.equal(refused.reason, "full");
  assert.deepEqual(refused.state, fullSections);
  const projectSections = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`/p${i}`, "s0"]));
  const fullMemberships = { ...emptySessionUiState(), sections: sections.slice(0, 1), projectSections };
  const refusedMove = apply(fullMemberships, assign("/new", "s0"));
  assert.equal(refusedMove.reason, "full");
  assert.deepEqual(refusedMove.state, fullMemberships);
  const removed = apply(fullMemberships, assign("/p0", null));
  assert.equal(removed.reason, undefined);
  assert.equal(Object.hasOwn(removed.state.projectSections, "/p0"), false);
});

test("UTF-8 budgets reject additions without evicting existing sections or memberships", () => {
  const encoder = new TextEncoder();
  const sections = [];
  for (let index = 0; index < 1000; index++) {
    const section = { id: `s${String(index).padStart(4, "0")}${"x".repeat(110)}`, name: `${index}${"界".repeat(76)}` };
    if (encoder.encode(JSON.stringify([...sections, section])).length > 256 * 1024) break;
    sections.push(section);
  }
  const beforeSections = { ...emptySessionUiState(), sections };
  const next = create(`new${"x".repeat(125)}`, `新${"界".repeat(79)}`);
  const refusedSection = apply(beforeSections, next);
  assert.equal(refusedSection.reason, "full");
  assert.deepEqual(refusedSection.state, beforeSections);

  const projectSections = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`/${String(index).padStart(3, "0")}${"x".repeat(3995)}`, "work"]));
  const beforeMemberships = { ...emptySessionUiState(), sections: [{ id: "work", name: "Work" }], projectSections };
  const refusedMembership = apply(beforeMemberships, assign(`/${"y".repeat(4095)}`, "work"));
  assert.equal(refusedMembership.reason, "full");
  assert.deepEqual(refusedMembership.state, beforeMemberships);
});
