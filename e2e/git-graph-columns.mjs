import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

// A long linear history keeps the column layout deterministic while exercising
// the same sticky header and virtual scroll used by the real graph.
export async function checkGitGraphColumns({ browser, base, artifacts, fixture }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const commits = Array.from({ length: 180 }, (_, index) => {
    const sha = (index + 1).toString(16).padStart(40, "0");
    return {
      sha, shortSha: sha.slice(-7),
      parents: index < 179 ? [(index + 2).toString(16).padStart(40, "0")] : [],
      subject: `Fixture commit ${String(index).padStart(3, "0")}`,
      author: "Fixture Author", authorEmail: "author@example.invalid",
      committedAt: "2026-08-23T00:00:00Z", refs: [],
    };
  });
  await page.route("**/api/git/graph?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const commit = commits.find((item) => item.sha === params.get("sha"));
    await route.fulfill({ json: commit
      ? { ...commit, body: "", files: [] }
      : { isGitRepository: true, branches: [], currentBranch: "main", commits, hasMore: false } });
  });

  const panel = page.locator("#file-panel");
  const body = panel.getByTestId("git-graph-body");
  const header = panel.getByTestId("git-graph-header");
  const graph = panel.getByTitle("Drag to resize the graph; double-click to fit", { exact: true });
  const description = panel.locator('[title^="Drag to resize the description"]');
  const author = panel.getByTitle("Drag to resize the author and date; double-click to reset both", { exact: true });
  const date = panel.getByTitle("Drag to resize the date and SHA; double-click to reset both", { exact: true });
  const width = (locator) => locator.locator("..").evaluate((element) => element.getBoundingClientRect().width);
  const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1, `${message}: expected ${expected}, got ${actual}`);
  const drag = async (locator, distance) => {
    const box = await locator.boundingBox();
    assert.ok(box, "A visible divider is required");
    const x = box.x + box.width / 2 - 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 5 });
    await page.mouse.up();
  };
  const sizes = async () => header.evaluate((element) => Array.from(element.children, (cell) => cell.getBoundingClientRect().width));
  const waitForPanelMotion = () => panel.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  const assertAligned = async () => {
    // Measure both in one browser task: the surrounding panel may be moving
    // during its width transition between two separate evaluate() calls.
    const { columns, cells } = await panel.evaluate((element) => {
      const rects = (parent) => Array.from(parent.children, (cell) => {
        const rect = cell.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      });
      return {
        columns: rects(element.querySelector('[data-testid="git-graph-header"]')),
        cells: rects(element.querySelector('[data-testid="git-graph-row"]')),
      };
    });
    assert.equal(cells.length, columns.length, "The header and a row have the same columns");
    for (let i = 0; i < columns.length; i++) {
      closeTo(cells[i].left, columns[i].left, `Column ${i} left edge`);
      closeTo(cells[i].width, columns[i].width, `Column ${i} width`);
    }
  };
  const openGraph = async () => {
    await showSidebarFiles(page);
    if (!(await body.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
    }
    await body.waitFor();
  };

  try {
    const query = fixture.id ? `session=${encodeURIComponent(fixture.id)}` : `cwd=${encodeURIComponent(fixture.cwd)}`;
    await page.goto(`${base}/?${query}`, { waitUntil: "domcontentloaded" });
    await openGraph();
    const expand = panel.getByRole("button", { name: "Expand file panel", exact: true });
    if (await expand.isVisible()) await expand.click();
    await waitForPanelMotion();

    // The old implementation starts at 350px instead of the rendered width.
    const descBefore = await width(description);
    await drag(description, -10);
    closeTo(await width(description), descBefore - 10, "First description drag follows the pointer");
    await author.waitFor();
    await date.waitFor();
    assert.equal(await panel.getByRole("separator").count(), 4, "Every column boundary has a keyboard-accessible divider");
    await assertAligned();

    let before = await sizes();
    await drag(graph, 10);
    let after = await sizes();
    closeTo(after[0], before[0] + 10, "Graph grows by the drag distance");
    closeTo(after[1], before[1] - 10, "Description gives the graph room");

    before = await sizes();
    await drag(author, 12);
    after = await sizes();
    closeTo(after[2], before[2] + 12, "Author grows by the drag distance");
    closeTo(after[3], before[3] - 12, "Date gives the author room");

    before = await sizes();
    await drag(date, -10);
    after = await sizes();
    closeTo(after[3], before[3] - 10, "Date follows the drag distance");
    closeTo(after[4], before[4] + 10, "SHA gives the date room");
    await assertAligned();

    // Both halves of every 12px handle must remain hittable.
    for (const divider of [graph, description, author, date]) {
      const hits = await divider.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left + 2, rect.right - 2].map((x) => {
          const target = document.elementFromPoint(x, rect.top + rect.height / 2);
          return target === element || element.contains(target);
        });
      });
      assert.deepEqual(hits, [true, true], "The divider hit area is not clipped");
    }

    before = await sizes();
    await author.focus();
    await page.keyboard.press("ArrowLeft");
    after = await sizes();
    assert.ok(after[2] < before[2] && after[3] > before[3], "Arrow keys resize adjacent columns");
    const savedSizes = await sizes();

    await page.reload({ waitUntil: "domcontentloaded" });
    await openGraph();
    if (await expand.isVisible()) await expand.click();
    await waitForPanelMotion();
    const restored = await sizes();
    for (const index of [0, 2, 3, 4]) closeTo(restored[index], savedSizes[index], `Column ${index} survives reload`);

    await author.focus();
    await page.keyboard.press("Home");
    assert.equal(await author.getAttribute("aria-valuenow"), await author.getAttribute("aria-valuemin"), "Home reaches the author minimum");
    const limitBox = await author.boundingBox();
    await page.mouse.move(limitBox.x + limitBox.width / 2, limitBox.y + limitBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(limitBox.x - 20, limitBox.y + limitBox.height / 2);
    assert.equal(await author.getAttribute("data-limited"), "true", "A drag against the minimum has visible feedback");
    await page.mouse.up();
    await author.dblclick();
    after = await sizes();
    closeTo(after[2], 120, "Double-click resets Author");
    closeTo(after[3], 125, "Double-click resets Date");

    // A narrow desktop panel must still resize the visible boundary from its
    // actual width, without losing the choice on a panel-width change.
    await panel.getByRole("button", { name: "Restore file panel width", exact: true }).click();
    await waitForPanelMotion();
    before = await sizes();
    await drag(description, 10);
    after = await sizes();
    closeTo(after[1], before[1] + 10, "Description follows the pointer in a narrow panel");
    closeTo(after[2], before[2] - 10, "Author gives the narrow description room");
    await expand.click();
    await waitForPanelMotion();
    await panel.getByRole("button", { name: "Restore file panel width", exact: true }).click();
    await waitForPanelMotion();
    const narrowedAgain = await sizes();
    closeTo(narrowedAgain[1], after[1], "Description preference survives expanding and restoring the panel");
    closeTo(narrowedAgain[2], after[2], "Author preference survives expanding and restoring the panel");

    // Metadata stays reachable and rows follow the header horizontally.
    await page.setViewportSize({ width: 1000, height: 900 });
    await waitForPanelMotion();
    const scroll = await body.evaluate((element) => ({ client: element.clientWidth, total: element.scrollWidth }));
    assert.ok(scroll.total > scroll.client, "A narrow graph offers horizontal scrolling");
    await page.waitForFunction(() => !CSS.supports("animation-timeline", "scroll()") ||
      parseFloat(getComputedStyle(document.querySelector('[data-testid="git-graph-body"]')).getPropertyValue("--scroll-fade-end")) > 0);
    await body.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-testid="git-graph-body"]').scrollLeft > 0);
    assert.ok(await body.evaluate((element) => element.scrollLeft > 0), "A keyboard can scroll the graph horizontally");
    await body.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await page.waitForFunction(() => {
      const body = document.querySelector('[data-testid="git-graph-body"]');
      const headerScroll = document.querySelector('[data-testid="git-graph-header"]').parentElement;
      return body.scrollLeft > 0 && headerScroll.scrollLeft === body.scrollLeft;
    });
    assert.ok(await body.evaluate((element) => element.scrollLeft > 0), "The rightmost columns are reachable");
    await page.waitForFunction(() => !CSS.supports("animation-timeline", "scroll()") ||
      parseFloat(getComputedStyle(document.querySelector('[data-testid="git-graph-body"]')).getPropertyValue("--scroll-fade-start")) > 0);
    await assertAligned();
    const sha = header.getByText("SHA", { exact: true });
    const shaBox = await sha.boundingBox();
    const bodyBox = await body.boundingBox();
    assert.ok(shaBox && bodyBox && shaBox.x >= bodyBox.x && shaBox.x + shaBox.width <= bodyBox.x + bodyBox.width, "SHA is visible after scrolling");
    await body.evaluate((element) => { element.scrollTop = 28 * 90; });
    await body.getByText("Fixture commit 090", { exact: true }).waitFor();
    const headerBox = await header.boundingBox();
    closeTo(headerBox.y + headerBox.height + 1, bodyBox.y, "The header remains above the vertically scrolling rows");
    await assertAligned();

    // Actual touch events exercise PointerCapture, not just mouse events on a
    // touch-capable viewport.
    await page.setViewportSize({ width: 1440, height: 900 });
    await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
    await body.evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
    // Expansion and horizontal-scroll clamping settle asynchronously. Measure
    // the touch target only once the full-width panel and header agree.
    await page.waitForFunction(() => {
      const panel = document.querySelector("#file-panel");
      const body = document.querySelector('[data-testid="git-graph-body"]');
      const headerScroll = document.querySelector('[data-testid="git-graph-header"]').parentElement;
      return Math.abs(panel.getBoundingClientRect().width - innerWidth) < 1 &&
        Math.abs(headerScroll.clientWidth - body.clientWidth) <= 1 &&
        headerScroll.scrollLeft === 0 && body.scrollLeft === 0;
    });
    const touchBox = await author.boundingBox();
    const touchX = touchBox.x + touchBox.width / 2;
    const touchY = touchBox.y + touchBox.height / 2;
    before = await sizes();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX + 8, y: touchY }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    after = await sizes();
    closeTo(after[2], before[2] + 8, "Touch dragging resizes the author");
    await cdp.detach();
    assert.deepEqual(errors, []);
    console.log("PASS: Git Graph column dragging, persistence, keyboard, touch, horizontal scrolling and virtual-row alignment");
  } catch (error) {
    if (artifacts) await page.screenshot({ path: join(artifacts, "git-graph-columns-failure.png") }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
