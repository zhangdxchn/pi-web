import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

export function createGitGraphUncommittedFixtures({ agentDir }) {
  return ["desktop", "mobile"].map((name) => {
    const root = join(realpathSync(agentDir), `git-graph-uncommitted-${name}`);
    mkdirSync(root, { recursive: true });
    const git = (...args) => execFileSync("git", ["-C", root, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", timeout: 10_000 }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Pi Web E2E"); git("config", "user.email", "e2e@example.invalid");
    writeFileSync(join(root, "working.txt"), "original working file\n");
    writeFileSync(join(root, "staged.txt"), "original staged file\n");
    git("add", "."); git("commit", "-qm", "Initial commit"); git("branch", "older-branch");
    writeFileSync(join(root, "head.txt"), "head\n"); git("add", "."); git("commit", "-qm", "Current HEAD");
    writeFileSync(join(root, "working.txt"), "updated working file\n");
    writeFileSync(join(root, "staged.txt"), "updated staged file\n"); git("add", "staged.txt");
    writeFileSync(join(root, "staged.txt"), "updated staged and unstaged file\n");
    writeFileSync(join(root, "new.txt"), "untracked content\n");
    return { root, git };
  });
}

export async function checkGitGraphUncommitted({ browser, base, artifacts, fixtures }) {
  for (const [index, mobile] of [false, true].entries()) {
    const fixture = fixtures[index];
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale: "en-US", hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const panel = page.locator("#file-panel");
    const graphTab = panel.getByRole("tab", { name: "Git Graph", exact: true });
    const node = panel.getByTestId("git-graph-uncommitted");
    try {
      await page.goto(`${base}/?cwd=${encodeURIComponent(fixture.root)}`, { waitUntil: "domcontentloaded" });
      await page.locator(".new-session-hero").waitFor();
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await showSidebarFiles(page);
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
      if (!mobile) await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
      await node.getByText("Uncommitted Changes (3)", { exact: true }).waitFor();
      assert.equal(await node.locator("svg circle").last().getAttribute("fill"), "var(--bg)", "working node is hollow");
      assert.equal(await node.getAttribute("role"), "button");
      assert.equal(await node.getAttribute("aria-expanded"), "false");
      assert.equal(await node.getByRole("button").count(), 0, "working tree is not a commit action target");
      if (mobile) await node.click();
      else { await node.focus(); await page.keyboard.press("Enter"); }
      assert.equal(await node.getAttribute("aria-expanded"), "true");
      const details = panel.getByTestId("git-graph-working-details");
      await details.getByText("working.txt", { exact: true }).waitFor();
      await details.getByText("staged.txt", { exact: true }).waitFor();
      await details.getByText("new.txt", { exact: true }).waitFor();
      const workingRow = details.getByRole("button").filter({ hasText: "working.txt" });
      const stagedRow = details.getByRole("button").filter({ hasText: "staged.txt" });
      const newRow = details.getByRole("button").filter({ hasText: "new.txt" });
      for (const row of [workingRow, stagedRow]) {
        assert.equal(await row.getByText("+1", { exact: true }).count(), 1, "each modified file shows its additions");
        assert.equal(await row.getByText("-1", { exact: true }).count(), 1, "each modified file shows its deletions");
      }
      assert.equal(await newRow.getByText("+1", { exact: true }).count(), 1, "an untracked text file shows its added lines");
      assert.equal(await newRow.getByText("-1", { exact: true }).count(), 0, "zero deletions are omitted");
      await page.screenshot({ path: join(artifacts, `git-graph-uncommitted-${mobile ? "mobile" : "desktop"}.png`) });
      await details.getByText("working.txt", { exact: true }).click();
      await panel.getByRole("tab", { name: "working.txt", exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "updated working file" }).waitFor();
      await graphTab.click();
      await details.getByText("staged.txt", { exact: true }).click();
      await panel.getByRole("tab", { name: "staged.txt", exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "updated staged and unstaged file" }).waitFor();
      await graphTab.click();
      await details.getByText("new.txt", { exact: true }).click();
      await panel.getByRole("tab", { name: "new.txt", exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "untracked content" }).waitFor();
      await graphTab.click();
      await panel.getByRole("button", { name: "All branches", exact: true }).click();
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/git/graph" && url.searchParams.get("branch") === "older-branch";
      });
      await panel.getByText("older-branch", { exact: true }).first().click();
      assert.equal((await filtered).status(), 200);
      await panel.getByText("Current HEAD", { exact: true }).waitFor({ state: "detached" });
      assert.equal(await node.count(), 0, "the node is hidden when the selected branch excludes HEAD");
      await panel.getByRole("button", { name: "older-branch", exact: true }).click();
      await panel.getByText("All branches", { exact: true }).click();
      await node.getByText("Uncommitted Changes (3)", { exact: true }).waitFor();
      fixture.git("add", "-A"); fixture.git("commit", "-qm", "Commit working changes");
      await panel.getByRole("button", { name: "Refresh graph", exact: true }).click();
      await node.waitFor({ state: "detached" });
      await panel.getByText("Commit working changes", { exact: true }).waitFor();
      writeFileSync(join(fixture.root, "new-again.txt"), "new change\n");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await node.getByText("Uncommitted Changes (1)", { exact: true }).waitFor();
      await page.route("**/api/git/status?*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"test"}' }));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await panel.getByText("Could not load working tree changes. Refresh to retry.", { exact: true }).waitFor();
      await page.unroute("**/api/git/status?*");
      await panel.getByRole("button", { name: "Refresh graph", exact: true }).click();
      await panel.getByText("Could not load working tree changes. Refresh to retry.", { exact: true }).waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} uncommitted graph node, working diffs, branch filter and refresh`);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `git-graph-uncommitted-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
}
