// Isolated browser acceptance for project Sections; no existing sessions or credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-web-project-sections-e2e-"));
const agentDir = path.join(temp, "agent");
const sessionsDir = path.join(agentDir, "sessions", "fixture");
const timestamp = "2026-10-01T00:00:00.000Z";
const projects = [path.join(temp, "alpha"), path.join(temp, "beta")];
await mkdir(sessionsDir, { recursive: true });
for (const [index, cwd] of projects.entries()) {
  await mkdir(cwd, { recursive: true });
  const id = `section-e2e-${index}`;
  const entries = [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: `Section fixture ${index}` } },
  ];
  await writeFile(path.join(sessionsDir, `2026-10-01T00-00-00-000Z_${id}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}
const digest = async (index) => createHash("sha256").update(await readFile(path.join(sessionsDir, `2026-10-01T00-00-00-000Z_section-e2e-${index}.jsonl`))).digest("hex");
const initialDigests = await Promise.all(projects.map((_, index) => digest(index)));
const artifacts = path.join(root, "test-results", "e2e");
await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => { const address = socket.address(); socket.close(() => resolve(address.port)); });
});
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let log = "";
try {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { log += chunk; });
  server.stderr.on("data", (chunk) => { log += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${log}`);
    try { if ((await fetch(`${base}/api/sessions`)).ok) { ready = true; break; } } catch { /* server is starting */ }
    await delay(500);
  }
  assert.ok(ready, `server did not start: ${log}`);
  const getState = async () => (await (await fetch(`${base}/api/sessions/ui-state`)).json()).state;
  const waitState = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) { const value = await getState(); if (predicate(value)) return value; await delay(100); }
    throw new Error(`State did not arrive: ${JSON.stringify(await getState())}`);
  };
  const sessions = (await (await fetch(`${base}/api/sessions`)).json()).sessions;
  const alpha = sessions.find((session) => session.id === "section-e2e-0");
  const beta = sessions.find((session) => session.id === "section-e2e-1");
  assert.ok(alpha?.projectKey && beta?.projectKey);
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await desktop.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15_000);
  // A fresh Turbopack graph can take longer than the interaction timeout to compile.
  page.setDefaultNavigationTimeout(60_000);
  await page.goto(`${base}/?cwd=${encodeURIComponent(alpha.cwd)}`, { waitUntil: "domcontentloaded" });
  await page.locator(".new-session-hero").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "New Section…" }).click();
  await page.locator("#sidebar-section-name").fill("Work");
  await page.waitForFunction(() => { const menu = document.querySelector(".sidebar-menu"); return menu && getComputedStyle(menu).opacity === "1" && getComputedStyle(menu).transform === "none"; });
  await page.screenshot({ path: path.join(artifacts, "project-sections-form-desktop.png") });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  let state = await waitState((value) => value.sections?.some((section) => section.name === "Work"));
  const work = state.sections.find((section) => section.name === "Work").id;
  await page.getByRole("button", { name: "New Section…" }).click();
  await page.locator("#sidebar-section-name").fill("Work");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").getByText("That Section name is already in use.").waitFor();
  await page.keyboard.press("Escape");
  const group = (target, key) => target.locator(`[data-row-key=${JSON.stringify(`group:${key}`)}]`);
  const section = (target, id) => target.locator(`[data-row-key=${JSON.stringify(`section:${id}`)}]`);
  const groupMenu = async (target, key) => { const row = group(target, key); await row.hover(); await row.locator("button[aria-haspopup=menu]").click(); };
  const sectionMenu = async (target, id) => { const row = section(target, id); await row.hover(); await row.locator("button[aria-haspopup=menu]").click(); };
  await groupMenu(page, alpha.projectKey);
  await page.getByRole("menuitem", { name: "Move to Section…" }).click();
  await page.getByRole("menuitem", { name: "Back to project actions" }).click();
  await page.getByRole("menuitem", { name: "Move to Section…" }).click();
  await page.getByRole("menuitemradio", { name: "Work", exact: true }).click();
  await waitState((value) => value.projectSections?.[alpha.projectKey] === work);
  assert.ok(await section(page, work).getByText("Work", { exact: true }).isVisible());
  const observerContext = await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: "en-US" });
  const observer = await observerContext.newPage();
  await observer.goto(`${base}/?cwd=${encodeURIComponent(alpha.cwd)}`, { waitUntil: "domcontentloaded" });
  await section(observer, work).getByText("Work", { exact: true }).waitFor();
  await page.bringToFront();
  await section(page, work).locator(".session-tree-pinned-toggle").click();
  assert.equal(await section(page, work).locator(".session-tree-pinned-toggle").getAttribute("aria-expanded"), "false");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => document.querySelector(`[data-row-key="section:${id}"] .session-tree-pinned-toggle`)?.getAttribute("aria-expanded") === "false", work);
  assert.equal(await section(page, work).locator(".session-tree-pinned-toggle").getAttribute("aria-expanded"), "false");
  await section(page, work).locator(".session-tree-pinned-toggle").click();
  await sectionMenu(page, work);
  await page.getByRole("menuitem", { name: "Rename Section…" }).click();
  await page.locator("#sidebar-section-name").fill("Team");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await waitState((value) => value.sections?.some((item) => item.id === work && item.name === "Team"));
  await observer.bringToFront();
  await section(observer, work).getByText("Team", { exact: true }).waitFor({ timeout: 15_000 });
  await observerContext.close();
  await page.bringToFront();
  await groupMenu(page, beta.projectKey);
  await page.getByRole("menuitem", { name: "Move to Section…" }).click();
  await page.getByRole("menuitem", { name: "New Section…" }).click();
  await page.locator("#sidebar-section-name").fill("Personal");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  state = await waitState((value) => value.sections?.some((item) => item.name === "Personal") && value.projectSections?.[beta.projectKey]);
  const personal = state.sections.find((item) => item.name === "Personal").id;
  assert.equal(state.projectSections[beta.projectKey], personal);
  await sectionMenu(page, personal);
  await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
  await waitState((value) => value.sections?.[0]?.id === personal);

  // A section moves with its projects; a drag does not toggle its header.
  const workExpanded = await section(page, work).locator(".session-tree-pinned-toggle").getAttribute("aria-expanded");
  await section(page, work).dragTo(section(page, personal), { targetPosition: { x: 40, y: 3 } });
  await waitState((value) => value.sections?.[0]?.id === work);
  assert.equal(await section(page, work).locator(".session-tree-pinned-toggle").getAttribute("aria-expanded"), workExpanded);
  await section(page, work).dragTo(group(page, beta.projectKey), { targetPosition: { x: 40, y: 25 } });
  await waitState((value) => value.sections?.[0]?.id === personal);

  // A project can enter another section at a position in its body.
  await group(page, beta.projectKey).dragTo(group(page, alpha.projectKey), { targetPosition: { x: 40, y: 4 } });
  state = await waitState((value) => value.projectSections?.[beta.projectKey] === work);
  assert.ok(state.projectOrder.indexOf(beta.projectKey) < state.projectOrder.indexOf(alpha.projectKey));
  await page.waitForFunction(({ first, second }) => {
    const a = document.querySelector(`[data-row-key=${JSON.stringify(`group:${first}`)}]`);
    const b = document.querySelector(`[data-row-key=${JSON.stringify(`group:${second}`)}]`);
    return a && b && a.getBoundingClientRect().top < b.getBoundingClientRect().top;
  }, { first: beta.projectKey, second: alpha.projectKey });
  await groupMenu(page, beta.projectKey);
  await page.getByRole("menuitem", { name: "Pin project", exact: true }).click();
  await waitState((value) => Boolean(value.projects?.[beta.projectKey]));
  assert.equal((await getState()).projectSections[beta.projectKey], work);
  await page.screenshot({ path: path.join(artifacts, "project-sections-desktop.png") });
  await page.reload({ waitUntil: "domcontentloaded" });
  await section(page, work).waitFor();
  state = await getState();
  assert.equal(state.projectSections[alpha.projectKey], work);
  assert.equal(state.projectSections[beta.projectKey], work);
  assert.equal(state.sections[0].id, personal);
  console.log("PASS desktop: create, move, rename, create-and-move, reorder, drag, reload");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", hasTouch: true, isMobile: true });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  phone.setDefaultTimeout(15_000);
  await phone.goto(`${base}/?cwd=${encodeURIComponent(alpha.cwd)}`, { waitUntil: "domcontentloaded" });
  await phone.locator(".new-session-hero").waitFor({ state: "visible" });
  await phone.locator("#session-sidebar:not(.sidebar-mobile-pending)").waitFor({ state: "attached" });
  const show = phone.getByRole("button", { name: "Show sidebar", exact: true });
  const hide = phone.getByRole("button", { name: "Hide sidebar", exact: true });
  await show.or(hide).waitFor({ state: "visible" });
  if (await show.isVisible()) await show.click();
  await hide.waitFor({ state: "visible" });
  await phone.waitForFunction(() => {
    const sidebar = document.getElementById("session-sidebar");
    return sidebar && sidebar.getBoundingClientRect().left >= 0;
  });
  await phone.screenshot({ path: path.join(artifacts, "project-sections-mobile.png") });
  await phone.setViewportSize({ width: 320, height: 700 });
  await phone.getByRole("button", { name: "New Section…" }).click();
  await phone.locator("#sidebar-section-name").waitFor({ state: "visible" });
  await phone.waitForFunction(() => { const sheet = document.querySelector(".sidebar-sheet"); return sheet && getComputedStyle(sheet).opacity === "1" && getComputedStyle(sheet).transform === "none"; });
  await phone.screenshot({ path: path.join(artifacts, "project-sections-form-mobile.png") });
  await phone.getByRole("button", { name: "Cancel", exact: true }).click();

  // Exercise the actual browser pointer/touch path, not only simulated events.
  const touchDrag = async (source, destination, targetY) => {
    const sourceBox = await source.boundingBox();
    const targetBox = await destination.boundingBox();
    assert.ok(sourceBox && targetBox, "touch drag source and destination are visible");
    const touch = await mobile.newCDPSession(phone);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sourceBox.x + 50, y: sourceBox.y + sourceBox.height / 2, id: 1 }] });
    await phone.waitForTimeout(400);
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: targetBox.x + 50, y: targetBox.y + (targetY ?? targetBox.height / 2), id: 1 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
  };
  await touchDrag(section(phone, work), section(phone, personal), 3);
  await waitState((value) => value.sections?.[0]?.id === work);
  await touchDrag(group(phone, alpha.projectKey), phone.locator(`[data-row-key=${JSON.stringify(`section-empty:${personal}`)}]`));
  await waitState((value) => value.projectSections?.[alpha.projectKey] === personal);
  await touchDrag(group(phone, alpha.projectKey), section(phone, "__ungrouped__"));
  await waitState((value) => !value.projectSections?.[alpha.projectKey]);

  // The mobile menu offers the same move in both directions without dragging.
  await groupMenu(phone, alpha.projectKey);
  await phone.getByRole("menuitem", { name: "Move to Section…" }).click();
  await phone.getByRole("menuitemradio", { name: "Team", exact: true }).click();
  await waitState((value) => value.projectSections?.[alpha.projectKey] === work);
  await groupMenu(phone, alpha.projectKey);
  await phone.getByRole("menuitem", { name: "Move to Section…" }).click();
  await phone.getByRole("menuitemradio", { name: "Ungrouped", exact: true }).click();
  await waitState((value) => !value.projectSections?.[alpha.projectKey]);
  await phone.getByText("Pinned projects appear above", { exact: true }).waitFor();
  await sectionMenu(phone, work);
  await phone.getByRole("menuitem", { name: "Delete Section…" }).click();
  await phone.getByText(/Projects to move to Ungrouped: 1/).waitFor();
  await phone.getByRole("button", { name: "Delete", exact: true }).click();
  await waitState((value) => !value.sections?.some((item) => item.id === work));
  assert.equal((await getState()).projectSections?.[beta.projectKey], undefined);
  assert.ok((await getState()).projects?.[beta.projectKey], "deleting a Section keeps its project's pin");
  assert.deepEqual(await Promise.all(projects.map((_, index) => digest(index))), initialDigests);
  assert.deepEqual(errors, []);
  console.log("PASS mobile: touch long-press drag, menu moves, delete without removing sessions, cross-browser state");
  await mobile.close();
  for (const [locale, showLabel, hideLabel, createLabel] of [
    ["zh-CN", "显示侧边栏", "隐藏侧边栏", "新建 Section…"],
    ["zh-TW", "顯示側邊欄", "隱藏側邊欄", "新增 Section…"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, locale, colorScheme: "dark", hasTouch: true, isMobile: true });
    const translated = await context.newPage();
    translated.on("pageerror", (error) => errors.push(error.message));
    await translated.goto(`${base}/?cwd=${encodeURIComponent(alpha.cwd)}`, { waitUntil: "domcontentloaded" });
    await translated.locator(".new-session-hero").waitFor({ state: "visible" });
    await translated.locator("#session-sidebar:not(.sidebar-mobile-pending)").waitFor({ state: "attached" });
    const open = translated.getByRole("button", { name: showLabel, exact: true });
    const close = translated.getByRole("button", { name: hideLabel, exact: true });
    await open.or(close).waitFor({ state: "visible" });
    if (await open.isVisible()) await open.click();
    await close.waitFor({ state: "visible" });
    await translated.getByRole("button", { name: createLabel }).waitFor({ state: "visible" });
    await translated.waitForFunction(() => document.getElementById("session-sidebar")?.getBoundingClientRect().left >= 0);
    await translated.screenshot({ path: path.join(artifacts, `project-sections-${locale}.png`) });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS locales: zh-CN and zh-TW at 320px, dark theme");

  const postState = async (body) => {
    const response = await fetch(`${base}/api/sessions/ui-state`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.ok(response.ok, `state write failed: ${response.status} ${await response.text()}`);
  };
  await postState({ action: "assign-project-section", projectKey: alpha.projectKey, sectionId: personal, add: [] });
  await postState({ action: "set", ids: [beta.id], pinned: true });
  for (const isMobile of [false, true]) {
    const context = await browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, locale: "en-US", hasTouch: isMobile, isMobile });
    const combined = await context.newPage();
    combined.on("pageerror", (error) => errors.push(error.message));
    combined.setDefaultTimeout(15_000);
    const showSessions = async () => {
      await combined.locator("#session-sidebar:not(.sidebar-mobile-pending)").waitFor({ state: "attached" });
      const showSidebar = combined.getByRole("button", { name: "Show sidebar", exact: true });
      const hideSidebar = combined.getByRole("button", { name: "Hide sidebar", exact: true });
      await showSidebar.or(hideSidebar).first().waitFor({ state: "visible" });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await combined.waitForFunction(() => document.querySelector("#session-sidebar")?.classList.contains("sidebar-open"));
      if (isMobile) {
        const sessionsTab = combined.getByRole("tab", { name: "Sessions", exact: true });
        if (await sessionsTab.getAttribute("aria-selected") !== "true") await sessionsTab.click();
      }
    };
    await combined.goto(`${base}/?cwd=${encodeURIComponent(alpha.cwd)}`, { waitUntil: "domcontentloaded" });
    await combined.evaluate(({ ids, sectionId }) => {
      localStorage.setItem("pi-web:unread-session-ids", JSON.stringify(ids));
      localStorage.setItem("pi-web:sidebar-project-sections-collapsed", JSON.stringify([sectionId]));
    }, { ids: [alpha.id, beta.id], sectionId: personal });
    await combined.reload({ waitUntil: "domcontentloaded" });
    await showSessions();
    const sectionToggle = section(combined, personal).locator(".session-tree-pinned-toggle");
    await sectionToggle.waitFor({ state: "visible" });
    assert.match(await sectionToggle.innerText(), /Personal\s*·\s*1/i);
    await sectionToggle.locator(".session-tree-summary-unread").waitFor({ state: "visible" });
    assert.equal(await combined.locator('[data-row-key="unread-header"]').count(), 0);
    const pinnedBeta = combined.locator(`[data-row-key=${JSON.stringify(`session:pinned:${beta.id}`)}]`);
    await pinnedBeta.locator(".session-tree-unread").waitFor({ state: "visible" });

    // Expanding the Section keeps unread sessions in their original project group.
    await sectionToggle.click();
    const groupToggle = group(combined, alpha.projectKey).locator(".session-tree-group-toggle");
    await groupToggle.waitFor({ state: "visible" });
    if (await groupToggle.getAttribute("aria-expanded") !== "true") await groupToggle.click();
    const unreadAlpha = combined.locator(`[data-row-key=${JSON.stringify(`session:group:${alpha.id}`)}]`);
    await unreadAlpha.locator(".session-tree-unread").waitFor({ state: "visible" });
    if (!isMobile) {
      await unreadAlpha.hover();
      await unreadAlpha.getByRole("button", { name: "More actions" }).click();
      await combined.getByRole("menuitem", { name: /^Mark as read/ }).click();
      await unreadAlpha.locator(".session-tree-unread").waitFor({ state: "detached" });
      await unreadAlpha.waitFor({ state: "visible" });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS combined: unread project and pinned rows, collapsed summaries, and mark as read on desktop and mobile");
  await desktop.close();
} catch (error) {
  console.error(error);
  console.error(log.slice(-10_000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    const timeout = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await once(server, "exit").catch(() => {});
    clearTimeout(timeout);
  }
  await rm(temp, { recursive: true, force: true });
}
