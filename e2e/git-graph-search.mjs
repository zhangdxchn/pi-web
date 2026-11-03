import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

// Search is tested against a paged, virtualized graph so that hidden rows and
// off-screen matches cannot accidentally be treated as a filtered table.
export async function checkGitGraphSearch({ browser, base, artifacts, fixture }) {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      locale: "en-US", hasTouch: mobile, isMobile: mobile,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const commits = Array.from({ length: 91 }, (_, index) => {
      const sha = (index + 1).toString(16).padStart(40, "0");
      return {
        sha, shortSha: sha.slice(-7), parents: index < 90 ? [(index + 2).toString(16).padStart(40, "0")] : [],
        subject: index === 0 ? "Sections and sections" : index === 50 ? "Ref match" : index === 90 ? "Older sections" : `Plain commit ${index}`,
        author: "Fixture Author", authorEmail: "author@example.invalid", committedAt: "2026-08-23T00:00:00Z",
        refs: index === 0 ? [{ type: "branch", name: "feat/sections" }] : index === 50 ? [{ type: "tag", name: "sections-only" }] : [],
      };
    });
    const pageRequests = [];
    await page.route("**/api/git/graph?*", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const detail = commits.find((commit) => commit.sha === params.get("sha"));
      if (detail) {
        await route.fulfill({ json: { ...detail, body: "", files: [] } });
      } else {
        const older = params.get("skip") !== "0";
        pageRequests.push(older);
        await route.fulfill({ json: {
          isGitRepository: true, branches: ["feat/sections"], currentBranch: "main",
          commits: older ? commits.slice(90) : commits.slice(0, 90), hasMore: !older,
        } });
      }
    });
    const panel = page.locator("#file-panel");
    const body = panel.getByTestId("git-graph-body");
    const search = panel.getByLabel("Search commits (message, SHA, author)…");
    const count = panel.getByTestId("git-graph-find-count");
    const current = () => body.locator('[data-search-current="true"]');
    try {
      await page.goto(`${base}/?session=${fixture.id}`, { waitUntil: "domcontentloaded" });
      await page.getByText("E2E linked-worktree answer", { exact: true }).waitFor();
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await showSidebarFiles(page);
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
      await body.getByText("Sections and sections", { exact: true }).waitFor();
      const heightBefore = await body.evaluate((element) => element.scrollHeight);
      await search.fill("sections");
      await count.getByText("1 / 2+", { exact: true }).waitFor();
      assert.equal(await body.evaluate((element) => element.scrollHeight), heightBefore, "finding does not remove graph rows");
      await body.getByText("Plain commit 1", { exact: true }).waitFor();
      assert.equal(await current().count(), 1);
      assert.equal(await current().locator("mark").count(), 3, "subject and branch highlights share one result");
      await panel.getByText("Searching loaded commits only. Load older commits to find more.").waitFor();
      if (mobile) {
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          const layout = await panel.evaluate((element) => {
            const input = element.querySelector('input[aria-label="Search commits (message, SHA, author)…"]');
            const count = element.querySelector('[data-testid="git-graph-find-count"]');
            const refresh = element.querySelector('button[aria-label="Refresh graph"]');
            const toolbar = input.parentElement.parentElement.parentElement;
            const rect = (item) => { const r = item.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width }; };
            return { input: rect(input), count: rect(count), refresh: rect(refresh), toolbar: rect(toolbar), overflow: toolbar.scrollWidth - toolbar.clientWidth };
          });
          assert.ok(layout.input.width >= width - 65, `search input is cramped: ${JSON.stringify(layout)}`);
          assert.ok(Math.abs(layout.count.top - layout.refresh.top) < 6, `refresh must share the navigation row: ${JSON.stringify(layout)}`);
          assert.ok(layout.overflow <= 1 && layout.refresh.right <= layout.toolbar.right, `toolbar overflows: ${JSON.stringify(layout)}`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await panel.screenshot({ path: join(artifacts, `git-graph-search-${mobile ? "mobile" : "desktop"}.png`) });
      if (!mobile) {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await panel.screenshot({ path: join(artifacts, "git-graph-search-desktop-dark.png") });
        await page.emulateMedia({ colorScheme: "light" });
        await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
        const scrollBefore = await body.evaluate((element) => new Promise((resolve) => {
          element.scrollTop = 600;
          requestAnimationFrame(() => resolve(element.scrollTop));
        }));
        await showSidebarFiles(page);
        await page.getByTitle(fixture.note.replace(/\\/g, "/"), { exact: true }).click();
        await panel.getByRole("tab", { name: "project-note.html", exact: true }).waitFor();
        await panel.getByRole("tab", { name: "Git Graph", exact: true }).click();
        assert.equal(await body.evaluate((element) => element.scrollTop), scrollBefore, "returning to the graph keeps the user's scroll position");
      }

      await search.press("Enter");
      await count.getByText("2 / 2+", { exact: true }).waitFor();
      await current().getByText("Ref match", { exact: true }).waitFor();
      assert.ok(await body.evaluate((element) => element.scrollTop) > 500, "find reveals a virtualized off-screen row");
      await search.press("Enter");
      await count.getByText("1 / 2+", { exact: true }).waitFor();
      await search.press("Shift+Enter");
      await count.getByText("2 / 2+", { exact: true }).waitFor();
      assert.equal(pageRequests.filter(Boolean).length, 0, "finding does not automatically fetch the whole history");

      await panel.getByRole("button", { name: "Open details for the current match" }).click();
      await panel.getByText("This commit has no file changes", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Next match (Enter)" }).click();
      await count.getByText("1 / 2+", { exact: true }).waitFor();
      await panel.getByTitle(commits[0].sha, { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Open details for the current match" }).click();
      await panel.getByRole("button", { name: "Close details" }).click();

      await panel.getByRole("button", { name: "Match case" }).click();
      await search.fill("Sections");
      await count.getByText("1 / 1+", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Open details for the current match" }).click();
      await panel.getByRole("button", { name: "Close details" }).click();
      await search.press("Enter");
      await panel.getByRole("button", { name: "Close details" }).waitFor();
      await panel.getByRole("button", { name: "Open details for the current match" }).click();
      await panel.getByRole("button", { name: "Close details" }).click();
      await panel.getByRole("button", { name: "Match case" }).click();
      await panel.getByRole("button", { name: "Use regular expression" }).click();
      await search.fill("[");
      await panel.getByRole("alert").getByText("Invalid regular expression.").waitFor();
      assert.equal(await search.getAttribute("aria-invalid"), "true");
      await search.fill("^");
      await panel.getByRole("alert").getByText("The regular expression must not match an empty string.").waitFor();
      await search.fill("sec.ions");
      await count.getByText("1 / 2+", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Use regular expression" }).click();
      await search.fill("sections");

      await panel.getByRole("button", { name: mobile ? "Load older commits (+200)" : "Load older commits (+500)" }).evaluate((button) => button.click());
      await count.getByText("1 / 3", { exact: true }).waitFor();
      assert.equal(pageRequests.filter(Boolean).length, 1);
      assert.equal(await panel.getByText("Searching loaded commits only. Load older commits to find more.").count(), 0);
      await search.press("Escape");
      assert.equal(await search.inputValue(), "");
      assert.equal(await current().count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} Git Graph find, highlight, navigation, regex, details and pagination`);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `git-graph-search-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
}
