import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useSessionUiState } = await jiti.import("./useSessionUiState.ts");
const answers = [];
const requests = [];
globalThis.fetch = async (_url, init = {}) => {
  requests.push({ method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
  const answer = answers.shift();
  if (!answer) throw new Error("No answer scripted");
  return answer();
};
const response = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const served = (state) => response(200, { state });
const state = (revision, extra = {}) => ({ version: 1, revision, sessions: {}, projects: {}, ...extra });
async function settle(hook) {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
  hook.flush();
}
test.afterEach(() => {
  assert.equal(answers.length, 0, "all scripted answers used");
  requests.length = 0;
});

test("section writes are optimistic, queued, and reconciled with server revisions", async () => {
  answers.push(served(state(1)));
  const hook = renderHook(useSessionUiState);
  await settle(hook);
  const created = state(2, { sections: [{ id: "work", name: "Work" }] });
  const assigned = state(3, { sections: created.sections, projectSections: { "/repo": "work" }, projectOrder: ["/repo"] });
  answers.push(served(created), served(assigned));
  const first = hook.result.apply({ action: "create-section", id: "work", name: "Work" });
  const second = hook.result.apply({ action: "assign-project-section", projectKey: "/repo", sectionId: "work", add: [] });
  hook.flush();
  assert.deepEqual(hook.result.state.projectSections, { "/repo": "work" });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  hook.flush();
  assert.deepEqual(hook.result.state, assigned);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "POST", "POST"]);
  hook.unmount();
});

test("a refused section write rolls back to the current server state", async () => {
  const initial = state(2, { sections: [{ id: "work", name: "Work" }] });
  const latest = state(3, { sections: [{ id: "work", name: "Work" }, { id: "personal", name: "Personal" }] });
  answers.push(served(initial));
  const hook = renderHook(useSessionUiState);
  await settle(hook);
  answers.push(response(409, { reason: "duplicate-section", error: "Name already exists" }), served(latest));
  const writing = hook.result.apply({ action: "create-section", id: "new", name: "Personal" });
  hook.flush();
  assert.equal(hook.result.state.sections.length, 2);
  assert.equal(await writing, false);
  hook.flush();
  assert.deepEqual(hook.result.state, latest);
  assert.equal(hook.result.error, "Name already exists");
  hook.unmount();
});
