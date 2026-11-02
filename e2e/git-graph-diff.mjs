import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

/** A real repository: the selected commit differs from both HEAD and the worktree. */
export function createGitGraphDiffFixture({ agentDir }) {
  const root = join(realpathSync(agentDir), "git-graph-diff");
  const hooks = join(agentDir, "git-graph-empty-hooks");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(hooks);
  const git = (...args) => execFileSync("git", [
    "-C", root, "-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false",
    "-c", "user.name=Pi Web E2E", "-c", "user.email=pi-web-test@example.invalid", ...args,
  ], { encoding: "utf8", timeout: 10_000 });
  const file = join(root, "src", "feature notes.txt");
  git("init", "-q");
  writeFileSync(file, "original historical line\n");
  git("add", ".");
  git("commit", "-qm", "E2E original");
  writeFileSync(file, "second historical line\n");
  git("add", ".");
  git("commit", "-qm", "E2E second change");
  const second = git("rev-parse", "HEAD").trim();
  writeFileSync(file, "third historical line\n");
  git("add", ".");
  git("commit", "-qm", "E2E third change");
  const third = git("rev-parse", "HEAD").trim();
  writeFileSync(file, "uncommitted working line\n");
  return { root, filePath: "src/feature notes.txt", second, third };
}

export async function checkGitGraphDiff({ browser, base, artifacts, fixture }) {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      locale: "en-US", hasTouch: mobile, isMobile: mobile,
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const panel = page.locator("#file-panel");
    const graphTab = panel.getByRole("tab", { name: "Git Graph", exact: true });
    const diffTab = (sha) => panel.getByRole("tab", { name: `feature notes.txt · ${sha.slice(0, 7)}`, exact: true });
    const closeDiff = (sha) => panel.getByRole("button", { name: `Close feature notes.txt · ${sha.slice(0, 7)}`, exact: true });
    const selectCommit = async (subject) => {
      await panel.getByTestId("git-graph-body").getByText(subject, { exact: true }).click();
      await panel.getByText(fixture.filePath, { exact: true }).waitFor();
    };
    const openDiff = async (sha) => {
      const request = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/git/graph" && url.searchParams.get("sha") === sha
          && url.searchParams.get("path") === fixture.filePath;
      });
      await panel.getByText(fixture.filePath, { exact: true }).click();
      assert.equal((await request).status(), 200);
      await diffTab(sha).waitFor();
      await panel.locator(".file-diff-view").waitFor();
    };
    const assertLines = async (removed, added) => {
      await panel.locator(".file-diff-line-content").filter({ hasText: removed }).first().waitFor();
      const lineContents = panel.locator(".file-diff-line-content");
      const lines = await lineContents.allTextContents();
      assert.equal(await lineContents.first().evaluate((element) => getComputedStyle(element).whiteSpace), "pre", "historical diffs stay unwrapped");
      assert.ok(lines.includes(removed), `missing removed line ${removed}`);
      assert.ok(lines.includes(added), `missing added line ${added}`);
      assert.ok(!lines.includes("uncommitted working line"), "must not show the worktree diff");
    };
    try {
      await page.goto(`${base}/?cwd=${encodeURIComponent(fixture.root)}`, { waitUntil: "domcontentloaded" });
      await page.locator(".new-session-hero").waitFor();
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await showSidebarFiles(page);
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
      if (!mobile) await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
      const search = panel.getByLabel("Search commits (message, SHA, author)…");
      await search.fill("E2E");
      await selectCommit("E2E second change");
      await openDiff(fixture.second);
      await assertLines("original historical line", "second historical line");
      await closeDiff(fixture.second).click();
      assert.equal(await graphTab.getAttribute("aria-selected"), "true", "closing the last diff selects Git Graph");
      await panel.getByText(fixture.filePath, { exact: true }).waitFor();
      assert.equal(await search.inputValue(), "E2E", "returning keeps the graph search and selected commit");

      // Different commits of the same file are independent tabs.
      await openDiff(fixture.second);
      await graphTab.click();
      await selectCommit("E2E third change");
      await openDiff(fixture.third);
      await assertLines("second historical line", "third historical line");
      assert.equal(await diffTab(fixture.second).count(), 1);
      await closeDiff(fixture.third).click();
      await assertLines("original historical line", "second historical line");
      await graphTab.click();
      await closeDiff(fixture.second).click();
      assert.equal(await graphTab.getAttribute("aria-selected"), "true");
      assert.match(await panel.getAttribute("class"), /right-panel-open/, "closing an inactive file must not hide the graph");
      await panel.getByText(fixture.filePath, { exact: true }).waitFor();
      if (!mobile) {
        await panel.getByRole("button", { name: "Restore file panel width", exact: true }).click();
        await showSidebarFiles(page);
        await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
        await page.locator(".terminal-panel:visible .is-ready").waitFor();
        await panel.getByRole("button", { name: "Terminate terminal git-graph-diff", exact: true }).click();
        await panel.locator(".terminal-panel").waitFor({ state: "detached" });
        assert.equal(await graphTab.getAttribute("aria-selected"), "true", "closing the terminal selects Git Graph");
        assert.match(await panel.getAttribute("class"), /right-panel-open/);
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(artifacts, `git-graph-diff-${mobile ? "mobile" : "desktop"}.png`) });
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} historical Git Diff, independent commit tabs, graph state and close behavior`);
      await context.tracing.stop();
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `git-graph-diff-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
      await context.tracing.stop({ path: join(artifacts, "git-graph-diff-trace.zip") }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
}
