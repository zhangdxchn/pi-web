import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-open-in-explorer-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");
allowFileRoot(agentDir);

test.after(() => rm(agentDir, { recursive: true, force: true }));

function open(cwd, host = "localhost:30141", application, headers = {}) {
  return POST(new Request("http://localhost/api/open-in-explorer", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: host, ...headers },
    body: JSON.stringify({ cwd, ...(application === undefined ? {} : { application }) }),
  }));
}

test("rejects a path outside the allowed roots before looking at it", async (t) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "pi-web-open-in-explorer-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));

  // Existing and missing paths answer the same, so the route is no existence oracle.
  for (const cwd of [outside, path.join(outside, "missing")]) {
    const response = await open(cwd);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "access-denied" });
  }
});

test("refuses requests that are not addressed to this machine", async () => {
  const response = await open(os.tmpdir(), "192.168.1.20:30141");
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "remote" });
});

test("reports VS Code availability without starting an application", async () => {
  const response = await GET(new Request("http://localhost/api/open-in-explorer", { headers: { Host: "localhost:30141" } }));
  const body = await response.json();
  assert.equal(body.platform, process.platform);
  assert.equal(typeof body.vscodeAvailable, "boolean");
});

test("refuses command-shaped requests and missing application paths", async () => {
  const invalid = await open(agentDir, undefined, { kind: "command", command: "echo" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "application-invalid" });
  const missing = await open(agentDir, undefined, { kind: "custom", path: path.join(agentDir, "missing.app") });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "application-not-found" });
});

test("refuses cross-origin launch requests", async () => {
  const response = await open(agentDir, undefined, { kind: "vscode" }, { Origin: "http://untrusted.example", "Sec-Fetch-Site": "cross-site" });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "request-denied" });
});
