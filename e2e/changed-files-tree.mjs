import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

export function createChangedFilesTreeFixture({ agentDir }) {
  const root = join(realpathSync(agentDir), "changed-files-tree");
  const hooks = join(agentDir, "changed-files-tree-empty-hooks");
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  mkdirSync(join(root, "docs"));
  mkdirSync(hooks);
  const git = (...args) => execFileSync("git", ["-C", root, "-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false", "-c", "user.name=Pi Web E2E", "-c", "user.email=pi-web-test@example.invalid", ...args], { encoding: "utf8", timeout: 10_000 }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "src", "deep", "changed.txt"), "original content\n");
  writeFileSync(join(root, "docs", "removed.txt"), "deleted content\n");
  writeFileSync(join(root, "docs", "old-name.txt"), "renamed content\n");
  writeFileSync(join(root, "root.txt"), "root content\n");
  git("add", ".");
  git("commit", "-qm", "Initial files");
  const sha = git("rev-parse", "HEAD");
  git("mv", "docs/old-name.txt", "docs/new-name.txt");
  unlinkSync(join(root, "docs", "removed.txt"));
  writeFileSync(join(root, "src", "deep", "changed.txt"), "updated working content\n");
  writeFileSync(join(root, "src", "deep", "new.txt"), "untracked content\n");
  return { root, sha };
}

export async function checkChangedFilesTree({ browser, base, artifacts, fixture }) {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale: "en-US", hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sidebar = page.locator("#session-sidebar-panel-files");
    const panel = page.locator("#file-panel");
    const graphTab = panel.getByRole("tab", { name: "Git Graph", exact: true });
    const group = (scope) => scope.getByRole("group", { name: "Changed files view" });
    const button = (scope, name) => group(scope).getByRole("button", { name, exact: true });
    const selected = async (scope, name) => assert.equal(await button(scope, name).getAttribute("aria-pressed"), "true");
    const showChanges = async () => {
      await showSidebarFiles(page);
      const toggle = sidebar.getByRole("button", { name: "4 changed files", exact: true });
      await toggle.waitFor();
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await group(sidebar).waitFor();
    };
    const showGraph = async () => {
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
      if (!mobile) await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
    };
    const openWorking = async (count = 4) => {
      await panel.getByTestId("git-graph-uncommitted").getByText(`Uncommitted Changes (${count})`, { exact: true }).click();
      await panel.getByTestId("git-graph-working-details").waitFor();
      return panel.getByTestId("git-graph-working-details");
    };
    const openCommit = async () => {
      await panel.getByTestId("git-graph-row").filter({ hasText: "Initial files" }).click();
      const count = panel.getByText("Changed files: 4", { exact: true });
      await count.waitFor();
      return count.locator("../..");
    };
    try {
      await page.goto(`${base}/?cwd=${encodeURIComponent(fixture.root)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.locator(".new-session-hero").waitFor();
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await showChanges();
      if (!mobile) {
        const resize = page.locator('[data-resize-handle="sidebar"]');
        await resize.focus();
        await page.keyboard.press("Home");
        await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector(".sidebar-container")).getPropertyValue("--sidebar-width")) === 180);
        const fit = await sidebar.locator(".sidebar-files-section").evaluate((header) => {
          const bounds = header.getBoundingClientRect();
          const keys = [...header.querySelectorAll(".sidebar-files-keys button")].map((key) => key.getBoundingClientRect());
          return { left: bounds.left, right: bounds.right, keys: keys.map((key) => ({ left: key.left, right: key.right })) };
        });
        assert.equal(fit.keys.length, 8);
        assert.ok(fit.keys.every((key, index) => key.left >= fit.left && key.right <= fit.right && (index === 0 || key.left >= fit.keys[index - 1].right - 0.5)), "all eight toolbar keys fit at the 180px minimum");
        await page.keyboard.press("Enter");
      }
      await selected(sidebar, "List");
      await button(sidebar, "Tree").click();
      await selected(sidebar, "Tree");
      const sideSrc = sidebar.getByRole("button", { name: "src", exact: true });
      const sideDeep = sidebar.getByRole("button", { name: "deep", exact: true });
      assert.equal(await sideSrc.getAttribute("aria-expanded"), "true");
      assert.equal(await sideDeep.getAttribute("aria-expanded"), "false");
      await sideDeep.click();
      await sidebar.getByText("changed.txt", { exact: true }).waitFor();
      await sidebar.getByText("new.txt", { exact: true }).waitFor();
      await sidebar.getByText("removed.txt", { exact: true }).waitFor();
      await sidebar.getByText("new-name.txt", { exact: true }).waitFor();
      await button(sidebar, "List").click();
      await button(sidebar, "Tree").click();
      assert.equal(await sideDeep.getAttribute("aria-expanded"), "true", "switching views keeps this folder open");
      if (!mobile) {
        await sideDeep.focus();
        await page.keyboard.press("Space");
        assert.equal(await sideDeep.getAttribute("aria-expanded"), "false");
        await page.keyboard.press("Enter");
        assert.equal(await sideDeep.getAttribute("aria-expanded"), "true");
        const sideFile = sidebar.getByRole("button", { name: /changed\.txt/ });
        await sideFile.focus();
        await sidebar.getByRole("button", { name: "Insert path into chat", exact: true }).click();
        assert.match(await page.locator("textarea.chat-input-textarea").inputValue(), /@src\/deep\/changed\.txt/);
        await sideFile.focus();
        await page.keyboard.press("Enter");
        await panel.getByRole("tab", { name: "changed.txt", exact: true }).waitFor();
        await panel.locator(".file-diff-line-content").filter({ hasText: "updated working content" }).waitFor();
      }
      await page.screenshot({ path: join(artifacts, `changed-files-sidebar-${mobile ? "mobile" : "desktop"}.png`) });
      if (mobile) {
        await page.setViewportSize({ width: 320, height: 844 });
        const bounds = await group(sidebar).evaluate((element) => {
          const control = element.getBoundingClientRect();
          const container = element.closest("#session-sidebar-panel-files").getBoundingClientRect();
          return { left: control.left, right: control.right, containerLeft: container.left, containerRight: container.right };
        });
        assert.ok(bounds.left >= bounds.containerLeft && bounds.right <= bounds.containerRight, "the switch fits a 320px phone");
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await page.screenshot({ path: join(artifacts, "changed-files-sidebar-mobile-dark.png") });
        await page.emulateMedia({ colorScheme: "light" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await showGraph();
      let working = await openWorking();
      await selected(working, "List");
      await selected(sidebar, "Tree");
      await button(working, "Tree").click();
      await selected(working, "Tree");
      await selected(sidebar, "Tree");
      await working.getByRole("button", { name: "deep", exact: true }).click();
      const changed = working.getByRole("button", { name: /changed\.txt/ });
      await changed.click();
      await panel.getByRole("tab", { name: "changed.txt", exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "updated working content" }).waitFor();
      await graphTab.click();
      for (const [name, relative, text] of [
        ["new.txt", "src/deep/new.txt", "untracked content"],
        ["removed.txt", "docs/removed.txt", "deleted content"],
        ["new-name.txt", "docs/new-name.txt", null],
      ]) {
        const response = page.waitForResponse((result) => {
          const url = new URL(result.url());
          return url.pathname === "/api/git/diff" && url.searchParams.get("path") === join(fixture.root, relative);
        });
        await working.getByRole("button", { name: new RegExp(name.replaceAll(".", "\\.")) }).click();
        assert.equal((await response).status(), 200);
        await panel.getByRole("tab", { name, exact: true }).waitFor();
        if (text) await panel.locator(".file-diff-line-content").filter({ hasText: text }).waitFor();
        await graphTab.click();
      }
      await button(working, "List").click();
      await button(working, "Tree").click();
      assert.equal(await working.getByRole("button", { name: "deep", exact: true }).getAttribute("aria-expanded"), "true");
      await button(working, "List").click();
      const commit = await openCommit();
      await selected(commit, "List");
      await button(commit, "Tree").click();
      await selected(commit, "Tree");
      await commit.getByRole("button", { name: "deep", exact: true }).click();
      const commitDiff = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/git/graph" && url.searchParams.get("sha") === fixture.sha && url.searchParams.get("path") === "src/deep/changed.txt";
      });
      await commit.getByRole("button", { name: /changed\.txt/ }).click();
      assert.equal((await commitDiff).status(), 200);
      await panel.getByRole("tab", { name: `changed.txt · ${fixture.sha.slice(0, 7)}`, exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "original content" }).waitFor();
      await graphTab.click();
      await commit.locator("..").evaluate((element) => { element.scrollTop = 0; });
      await button(commit, "List").click();
      await button(commit, "Tree").click();
      assert.equal(await commit.getByRole("button", { name: "deep", exact: true }).getAttribute("aria-expanded"), "true");
      await commit.locator("..").evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: join(artifacts, `changed-files-commit-${mobile ? "mobile" : "desktop"}.png`) });
      working = await openWorking();
      await selected(working, "List");
      await selected(sidebar, "Tree");
      assert.deepEqual(await page.evaluate(() => [
        localStorage.getItem("pi-web:changes-layout-sidebar"),
        localStorage.getItem("pi-web:changes-layout-working"),
        localStorage.getItem("pi-web:changes-layout-commit"),
      ]), ["tree", "list", "tree"]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".new-session-hero").waitFor();
      if (await showSidebar.isVisible()) await showSidebar.click();
      await showChanges();
      await selected(sidebar, "Tree");
      await showGraph();
      working = await openWorking();
      await selected(working, "List");
      const restoredCommit = await openCommit();
      await selected(restoredCommit, "Tree");
      if (!mobile) {
        // Working paths are scoped to cwd; commit paths stay repository-relative.
        const subdir = join(fixture.root, "src");
        await page.goto(`${base}/?cwd=${encodeURIComponent(subdir)}`, { waitUntil: "domcontentloaded" });
        await page.locator(".new-session-hero").waitFor();
        if (await showSidebar.isVisible()) await showSidebar.click();
        await showSidebarFiles(page);
        const subdirChanges = sidebar.getByRole("button", { name: "2 changed files", exact: true });
        await subdirChanges.waitFor();
        await subdirChanges.click();
        await selected(sidebar, "Tree");
        assert.equal(await sidebar.getByRole("button", { name: "deep", exact: true }).getAttribute("aria-expanded"), "true");
        await sidebar.getByText("changed.txt", { exact: true }).waitFor();
        assert.equal(await sidebar.getByText("removed.txt", { exact: true }).count(), 0);
        await showGraph();
        const subdirWorking = await openWorking(2);
        await button(subdirWorking, "Tree").click();
        await subdirWorking.getByText("changed.txt", { exact: true }).waitFor();
        const subdirCommit = await openCommit();
        await selected(subdirCommit, "Tree");
        await subdirCommit.getByRole("button", { name: "deep", exact: true }).click();
        const subdirDiff = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === "/api/git/graph" && url.searchParams.get("sha") === fixture.sha && url.searchParams.get("path") === "src/deep/changed.txt";
        });
        await subdirCommit.getByRole("button", { name: /changed\.txt/ }).click();
        assert.equal((await subdirDiff).status(), 200);

        // The merged Git Graph button must also fit the separate Files tab.
        await page.evaluate(() => {
          localStorage.setItem("pi-web:sidebar-files-placement", "tab");
          localStorage.setItem("pi-sidebar-width", "180");
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(".new-session-hero").waitFor();
        if (await showSidebar.isVisible()) await showSidebar.click();
        await showSidebarFiles(page);
        await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector(".sidebar-container")).getPropertyValue("--sidebar-width")) === 180);
        const tabFit = await sidebar.locator(".sidebar-files-actions").evaluate((row) => {
          const bounds = row.parentElement.getBoundingClientRect();
          const keys = [...row.querySelectorAll("button")].map((key) => key.getBoundingClientRect());
          return { left: bounds.left, right: bounds.right, keys: keys.map((key) => ({ left: key.left, right: key.right })) };
        });
        assert.equal(tabFit.keys.length, 7);
        assert.ok(tabFit.keys.every((key, index) => key.left >= tabFit.left && key.right <= tabFit.right && (index === 0 || key.left >= tabFit.keys[index - 1].right - 0.5)), "all seven Files-tab keys fit at the 180px minimum");
      }
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} independent changed-file layouts, persistence, folders and diffs`);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `changed-files-tree-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
}
