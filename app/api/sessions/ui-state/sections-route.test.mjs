import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-sections-route-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { resetSessionUiStateCacheForTests } = await jiti.import("../../../../lib/session-ui-state.ts");
const file = path.join(agentDir, "pi-web-session-state.json");

function post(body) {
  return POST(new Request("http://localhost/api/sessions/ui-state", {
    method: "POST", headers: { host: "localhost", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}
async function ok(response) {
  assert.equal(response.status, 200);
  return (await response.json()).state;
}
async function reset() {
  await rm(file, { force: true });
  resetSessionUiStateCacheForTests();
}

test("section operations round trip atomically without altering sessions", async () => {
  await reset();
  await ok(await post({ action: "set", ids: ["s1"], pinned: true }));
  await ok(await post({ action: "add-projects", keys: ["/a", "/b"] }));
  const created = await ok(await post({ action: "create-section", id: "work", name: "Work", projectKey: "/b" }));
  assert.deepEqual(created.sections, [{ id: "work", name: "Work" }]);
  assert.deepEqual(created.projectSections, { "/b": "work" });
  assert.deepEqual(created.projectOrder, ["/b", "/a"]);
  assert.equal(typeof created.sessions.s1.pinnedAt, "number");
  const read = await ok(await GET());
  assert.deepEqual(read, created);
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(stored.sections, created.sections);
  assert.deepEqual(stored.projectSections, created.projectSections);
  const deleted = await ok(await post({ action: "delete-section", id: "work" }));
  assert.equal(deleted.sections, undefined);
  assert.equal(deleted.projectSections, undefined);
  assert.deepEqual(deleted.sessions, created.sessions);
  assert.deepEqual(deleted.projectOrder, created.projectOrder);
});

test("duplicate and missing sections return 409 without a partial write", async () => {
  await reset();
  await ok(await post({ action: "create-section", id: "one", name: "Work" }));
  const before = await readFile(file, "utf8");
  const duplicate = await post({ action: "create-section", id: "two", name: "Work", projectKey: "/p" });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).reason, "duplicate-section");
  const missing = await post({ action: "assign-project-section", projectKey: "/p", sectionId: "missing" });
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).reason, "missing-section");
  assert.equal(await readFile(file, "utf8"), before);
});

test("concurrent duplicate names serialize to one success and one refusal", async () => {
  await reset();
  const replies = await Promise.all([
    post({ action: "create-section", id: "one", name: "Team" }),
    post({ action: "create-section", id: "two", name: "Team" }),
  ]);
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
  const refused = replies.find((reply) => reply.status === 409);
  assert.equal((await refused.json()).reason, "duplicate-section");
  const stored = await ok(await GET());
  assert.equal(stored.sections.length, 1);
  assert.equal(stored.sections[0].name, "Team");
});

test("a full membership list rejects create-and-assign without creating its section", async () => {
  await reset();
  const projectSections = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`/p${index}`, "one"]));
  const initial = { version: 1, revision: 3, sessions: {}, projects: {}, sections: [{ id: "one", name: "One" }], projectSections };
  await writeFile(file, JSON.stringify(initial));
  const before = await readFile(file, "utf8");
  const response = await post({ action: "create-section", id: "two", name: "Two", projectKey: "/new" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "full");
  assert.equal(await readFile(file, "utf8"), before);
});

test("writes still preserve unknown top-level fields and reject invalid input", async () => {
  await reset();
  await writeFile(file, JSON.stringify({ version: 1, revision: 2, sessions: {}, projects: {}, futureField: { keep: true } }));
  await ok(await post({ action: "create-section", id: "one", name: "One" }));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).futureField, { keep: true });
  const before = await readFile(file, "utf8");
  const response = await post({ action: "rename-section", id: "one", name: "未分组" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, "invalid-request");
  assert.equal(await readFile(file, "utf8"), before);
});
