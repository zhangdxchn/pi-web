import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { applicationCommand, findVisualStudioCode, isApplicationAvailable, launchApplication, parseApplicationTarget, visualStudioCodeCandidates } = await jiti.import("./open-in-application.ts");

test("only an application selection is parsed", () => {
  assert.deepEqual(parseApplicationTarget({ kind: "vscode" }), { kind: "vscode" });
  assert.deepEqual(parseApplicationTarget({ kind: "custom", path: " /Applications/My App.app " }), { kind: "custom", path: "/Applications/My App.app" });
  for (const input of [null, [], "code", {}, { kind: "custom", path: " " }, { kind: "command", command: "echo" }]) assert.equal(parseApplicationTarget(input), null);
});

test("passes application and project paths as separate arguments without a shell", () => {
  assert.deepEqual(applicationCommand("darwin", "/Applications/A & B.app", "/work/project; touch bad"), { command: "/usr/bin/open", args: ["-a", "/Applications/A & B.app", "/work/project; touch bad"] });
  assert.deepEqual(applicationCommand("win32", "C:\\Tools\\App.exe", "C:\\work\\a b"), { command: "C:\\Tools\\App.exe", args: ["C:\\work\\a b"] });
  assert.deepEqual(applicationCommand("linux", "/opt/my app", "/work/a b"), { command: "/opt/my app", args: ["/work/a b"] });
});

test("discovers VS Code in the supported standard locations", () => {
  assert.deepEqual(visualStudioCodeCandidates("darwin", {}, "/Users/dev"), ["/Applications/Visual Studio Code.app", "/Users/dev/Applications/Visual Studio Code.app"]);
  assert.deepEqual(visualStudioCodeCandidates("win32", { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ProgramFiles: "C:\\Program Files" }, "C:\\Users\\me"), ["C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", "C:\\Program Files\\Microsoft VS Code\\Code.exe"]);
  assert.deepEqual(visualStudioCodeCandidates("linux", { PATH: "/usr/bin:relative:/opt/bin" }, "/home/dev"), ["/usr/bin/code", "/opt/bin/code"]);
  assert.deepEqual(visualStudioCodeCandidates("aix", {}, "/"), []);
});

test("validates local app bundles and executables without launching them", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-open-app-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bundle = path.join(dir, "My App.app");
  await mkdir(bundle);
  assert.equal(await isApplicationAvailable("darwin", bundle), true);
  assert.equal(await isApplicationAvailable("darwin", dir), false);
  assert.equal(await isApplicationAvailable("darwin", "relative.app"), false);
  const code = path.join(dir, "code");
  await writeFile(code, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(code, 0o755);
  if (process.platform !== "win32") {
    assert.equal(await isApplicationAvailable("linux", code), true);
    assert.equal(await findVisualStudioCode("linux", { PATH: dir }, dir), code);
    await chmod(code, 0o644);
    assert.equal(await isApplicationAvailable("linux", code), false);
  }
  assert.equal(await isApplicationAvailable("aix", code), false);
});

test("launches a local fixture with one literal path and without the web password", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-open-app-launch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = path.join(dir, "app ; literal");
  const result = path.join(dir, "result.json");
  const target = path.join(dir, "project ; not-a-command");
  await writeFile(app, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.TEST_RESULT, JSON.stringify({ args: process.argv.slice(2), password: process.env.PI_WEB_PASSWORD ?? null }));\n`, { mode: 0o755 });
  const oldResult = process.env.TEST_RESULT;
  const oldPassword = process.env.PI_WEB_PASSWORD;
  process.env.TEST_RESULT = result;
  process.env.PI_WEB_PASSWORD = "must-not-leak";
  t.after(() => {
    if (oldResult === undefined) delete process.env.TEST_RESULT; else process.env.TEST_RESULT = oldResult;
    if (oldPassword === undefined) delete process.env.PI_WEB_PASSWORD; else process.env.PI_WEB_PASSWORD = oldPassword;
  });
  await launchApplication(app, target, "linux");
  let output;
  for (let i = 0; i < 100; i++) {
    try { output = await readFile(result, "utf8"); break; } catch { await delay(20); }
  }
  assert.ok(output, "fixture wrote its result");
  assert.deepEqual(JSON.parse(output), { args: [target], password: null });
});
