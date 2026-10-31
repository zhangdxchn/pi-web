import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

// The status and commit APIs are scripted: the real drawer must keep its DOM
// bounded even when the repository reports as many files as the original bug.
export async function checkGitGraphLargeFiles({ browser, base, artifacts, fixtures }) {
  const count = 43_817;
  const suffix = (index) => String(index).padStart(5, "0");
  const commitFiles = Array.from({ length: count }, (_, index) => ({
    filePath: index === count - 1 ? "head.txt" : `commit-file-${suffix(index)}.txt`,
    status: "modified", additions: 1, deletions: 1,
  }));

  for (const [index, mobile] of [false, true].entries()) {
    const fixture = fixtures[index];
    const files = Array.from({ length: count }, (_, i) => ({
      filePath: join(fixture.root, i === count - 1 ? "working.txt" : `working-file-${suffix(i)}.txt`),
      status: "modified", code: "M", indexStatus: " ", worktreeStatus: "M", additions: 1, deletions: 1,
    }));
    let statusFiles = files;
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale: "en-US", hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/git/status?*", (route) => route.fulfill({ json: {
      isGitRepository: true, repositoryRoot: fixture.root, files: statusFiles, additions: statusFiles.length, deletions: statusFiles.length,
    } }));
    await page.route("**/api/git/graph?*", (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.has("sha") && !params.has("path")) return route.fulfill({ json: { files: commitFiles } });
      return route.continue();
    });
    const panel = page.locator("#file-panel");
    const graphTab = panel.getByRole("tab", { name: "Git Graph", exact: true });
    try {
      await page.goto(`${base}/?cwd=${encodeURIComponent(fixture.root)}`, { waitUntil: "domcontentloaded" });
      await page.locator(".new-session-hero").waitFor();
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await showSidebarFiles(page);
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
      if (!mobile) await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
      const node = panel.getByTestId("git-graph-uncommitted");
      await node.getByText(`Uncommitted Changes (${count})`, { exact: true }).waitFor();
      await node.click();
      const details = panel.getByTestId("git-graph-working-details");
      await details.getByText(`Changed files: ${count}`, { exact: true }).waitFor();
      const first = details.getByRole("button").filter({ hasText: "working-file-00000.txt" });
      const second = details.getByRole("button").filter({ hasText: "working-file-00001.txt" });
      await first.waitFor();
      assert.ok(await details.getByRole("button").count() < 150, "working changes mount a bounded number of rows");
      assert.equal(await first.getByText("+1", { exact: true }).count(), 1);
      assert.equal(await first.getByText("-1", { exact: true }).count(), 1);
      const scroll = details.locator("..");
      await first.focus();
      await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const last = details.getByRole("button").filter({ hasText: "working.txt" });
      await last.waitFor();
      assert.ok(await details.getByRole("button").count() < 150, "working changes remain bounded at the end");
      if (!mobile) {
        assert.equal(await first.evaluate((element) => document.activeElement === element), true, "scrolling keeps the focused row mounted");
        await page.keyboard.press("Tab");
        await second.waitFor();
        assert.equal(await second.evaluate((element) => document.activeElement === element), true, "Tab reaches the next file even after scrolling away");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await first.evaluate((element) => document.activeElement === element), true);
        await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await last.waitFor();
        await last.focus();
        await scroll.evaluate((element) => { element.scrollTop = 0; });
        await first.waitFor();
        assert.equal(await last.evaluate((element) => document.activeElement === element), true);
        await page.keyboard.press("Shift+Tab");
        const previous = details.getByRole("button").filter({ hasText: `working-file-${suffix(count - 2)}.txt` });
        await previous.waitFor();
        assert.equal(await previous.evaluate((element) => document.activeElement === element), true, "Shift+Tab reaches the previous file after scrolling away");
        await page.keyboard.press("Tab");
        assert.equal(await last.evaluate((element) => document.activeElement === element), true);

        const drawer = scroll.locator("..");
        const before = await drawer.boundingBox();
        const handle = await drawer.locator(":scope > div").first().boundingBox();
        assert.ok(before && handle);
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2, handle.y - 80);
        await page.mouse.up();
        const after = await drawer.boundingBox();
        assert.ok(after && after.height > before.height + 50, "resizing expands the details viewport");
        await last.waitFor();
      }
      await page.screenshot({ path: join(artifacts, `git-graph-large-working-${mobile ? "mobile" : "desktop"}.png`) });
      await last.click();
      await panel.getByRole("tab", { name: "working.txt", exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "updated working file" }).waitFor();
      await graphTab.click();
      statusFiles = [files[0], files[1], files[count - 1]];
      await panel.getByRole("button", { name: "Refresh graph", exact: true }).click();
      await node.getByText("Uncommitted Changes (3)", { exact: true }).waitFor();
      await details.getByText("Changed files: 3", { exact: true }).waitFor();
      await first.waitFor();
      await last.waitFor();
      assert.equal(await details.getByRole("button").count(), 3, "a shortened list does not retain the old scroll slice");

      await panel.getByTestId("git-graph-row").filter({ hasText: "Current HEAD" }).click();
      const commitHeader = panel.getByText(`Changed files: ${count}`, { exact: true });
      await commitHeader.waitFor();
      const commitDetails = commitHeader.locator("..");
      await commitDetails.getByText("commit-file-00000.txt", { exact: true }).waitFor();
      assert.ok(await commitDetails.locator('[title^="commit-file-"]').count() < 150, "commit changes mount a bounded number of rows");
      const commitScroll = commitDetails.locator("..");
      await commitScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const lastCommit = commitDetails.getByText("head.txt", { exact: true });
      await lastCommit.waitFor();
      assert.ok(await commitDetails.locator('[title^="commit-file-"]').count() < 150, "commit changes remain bounded at the end");
      await page.screenshot({ path: join(artifacts, `git-graph-large-commit-${mobile ? "mobile" : "desktop"}.png`) });
      await lastCommit.click();
      await panel.getByRole("tab", { name: `head.txt · ${fixture.git("rev-parse", "HEAD").slice(0, 7)}`, exact: true }).waitFor();
      await panel.locator(".file-diff-line-content").filter({ hasText: "head" }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} Git Graph large working and commit file lists`);
    } finally {
      await context.close();
    }
  }
}
