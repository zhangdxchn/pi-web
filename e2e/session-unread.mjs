import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarSessions } from "./sidebar.mjs";

/** The real sidebar, with isolated session fixtures and browser-local unread state. */
export async function checkUnreadSection({ browser, base, artifacts, api, post, pinnedId, groupId, currentId }) {
  const state = (await api("/api/sessions/ui-state")).state.sessions[pinnedId];
  const groupSession = (await api("/api/sessions")).sessions.find((session) => session.id === groupId);
  assert.ok(groupSession, "the project session fixture exists");
  const projectKey = groupSession.projectKey ?? groupSession.projectRoot ?? groupSession.cwd;
  const snapshot = { id: pinnedId, pinnedAt: state?.pinnedAt ?? null, archivedAt: state?.archivedAt ?? null };
  await post("/api/sessions/ui-state", { action: "set", ids: [pinnedId], pinned: true });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        locale: "en-US", hasTouch: mobile, isMobile: mobile,
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const errors = [];
      context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      // This suite can be the first browser to compile the dev page.
      page.setDefaultNavigationTimeout(120_000);
      const row = (target, where, id) => target.locator(`[data-row-key=${JSON.stringify(`session:${where}:${id}`)}]`);
      const header = (target) => target.locator('[data-row-key="unread-header"] .session-tree-pinned-toggle');
      const showSessions = async (target) => {
        // Wait for the mobile breakpoint and drawer preference to hydrate;
        // the server's desktop first paint may otherwise close it afterwards.
        await target.locator("#session-sidebar:not(.sidebar-mobile-pending)").waitFor({ state: "attached" });
        if (mobile) await target.getByRole("tab", { name: "Sessions", exact: true }).waitFor({ state: "attached" });
        const show = target.getByRole("button", { name: "Show sidebar", exact: true });
        const hide = target.getByRole("button", { name: "Hide sidebar", exact: true });
        await show.or(hide).first().waitFor({ state: "visible" });
        if (await show.isVisible()) await show.click();
        await target.waitForFunction(() => document.querySelector("#session-sidebar")?.classList.contains("sidebar-open"));
        await showSidebarSessions(target);
      };
      const openMenu = async (target, where, id) => {
        await showSessions(target);
        const item = row(target, where, id);
        await item.waitFor({ state: "visible" });
        if (!mobile) await item.hover();
        await item.getByRole("button", { name: "More actions" }).click();
        const menu = target.getByRole("menu");
        await menu.waitFor();
        return menu;
      };
      try {
        await page.goto(`${base}/?session=${currentId}`, { waitUntil: "domcontentloaded" });
        await showSessions(page);
        await page.evaluate((ids) => localStorage.setItem("pi-web:unread-session-ids", JSON.stringify(ids)), [pinnedId, groupId]);
        await page.reload({ waitUntil: "domcontentloaded" });
        await showSessions(page);
        await row(page, "unread", pinnedId).waitFor({ state: "visible" });
        await row(page, "unread", groupId).waitFor({ state: "visible" });
        assert.match(await header(page).innerText(), /Unread\s*·\s*2/i);
        assert.equal(await row(page, "pinned", pinnedId).count(), 0, "a pinned unread row is not duplicated");
        assert.ok(await row(page, "unread", pinnedId).locator(".session-tree-project").innerText(), "the unread row names its project");
        if (!mobile) {
          const resize = page.getByRole("separator", { name: "Resize sidebar", exact: true });
          await resize.press("Home");
          await page.waitForFunction(() => Math.abs(document.querySelector("#session-sidebar").getBoundingClientRect().width - 180) < 1);
          const bounds = await row(page, "unread", pinnedId).evaluate((element) => {
            const rowBox = element.getBoundingClientRect();
            const title = element.querySelector(".session-tree-title").getBoundingClientRect();
            const project = element.querySelector(".session-tree-project").getBoundingClientRect();
            const dot = element.querySelector(".session-tree-unread").getBoundingClientRect();
            return { right: rowBox.right, titleRight: title.right, projectLeft: project.left, projectRight: project.right, dotLeft: dot.left, dotRight: dot.right };
          });
          assert.ok(bounds.titleRight <= bounds.projectLeft && bounds.projectRight <= bounds.dotLeft && bounds.dotRight <= bounds.right, "title, project and dot fit the 180px sidebar");
          await resize.press("Enter");
        }

        const second = await context.newPage();
        second.setDefaultNavigationTimeout(120_000);
        await second.goto(`${base}/?session=${currentId}`, { waitUntil: "domcontentloaded" });
        await showSessions(second);
        await row(second, "unread", pinnedId).waitFor({ state: "visible" });
        await page.bringToFront();

        const menu = await openMenu(page, "unread", pinnedId);
        assert.equal(await menu.getByRole("menuitem", { name: /^Unpin/ }).count(), 1, "unread retains its actual pin action");
        assert.equal(await menu.getByRole("menuitem", { name: /^Mark as read/ }).count(), 1);
        await page.keyboard.press("Escape");
        const link = row(page, "unread", pinnedId).locator(".session-tree-main");
        await link.focus();
        await link.press("Enter");
        await page.waitForURL((url) => url.searchParams.get("session") === pinnedId);
        if (mobile) {
          await page.waitForFunction(() => document.querySelector("#session-sidebar")?.classList.contains("sidebar-closed"));
          await page.waitForFunction(() => !document.querySelector("#session-sidebar")?.contains(document.activeElement));
        }
        await showSessions(page);
        await row(page, "pinned", pinnedId).waitFor({ state: "visible" });
        await row(second, "unread", pinnedId).waitFor({ state: "detached" });
        assert.equal(await row(page, "unread", pinnedId).count(), 0);
        if (!mobile) {
          await page.waitForFunction((id) => document.activeElement?.closest(`[data-row-key="session:pinned:${id}"]`) !== null, pinnedId);
        }
        assert.match(await header(page).innerText(), /Unread\s*·\s*1/i);

        // Mark the already selected session unread, then select the same row:
        // selectedSessionId does not change, but the marker must clear.
        await (await openMenu(page, "pinned", pinnedId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "unread", pinnedId).waitFor({ state: "visible" });
        await row(second, "unread", pinnedId).waitFor({ state: "visible" });
        await row(page, "unread", pinnedId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "pinned", pinnedId).waitFor({ state: "visible" });
        await row(second, "unread", pinnedId).waitFor({ state: "detached" });

        // A deliberately folded project stays folded; a keyboard selection
        // hands focus to its header instead of an unmounted destination row.
        const groupHeader = page.locator(`[data-row-key=${JSON.stringify(`group:${projectKey}`)}] .session-tree-group-toggle`);
        await groupHeader.waitFor({ state: "visible" });
        if (await groupHeader.getAttribute("aria-expanded") === "true") await groupHeader.click();
        const projectLink = row(page, "unread", groupId).locator(".session-tree-main");
        if (mobile) await projectLink.click();
        else { await projectLink.focus(); await projectLink.press("Enter"); }
        await page.waitForURL((url) => url.searchParams.get("session") === groupId);
        await showSessions(page);
        assert.equal(await groupHeader.getAttribute("aria-expanded"), "false");
        if (!mobile) {
          await page.waitForFunction((key) => document.activeElement?.closest(`[data-row-key="${CSS.escape(`group:${key}`)}"]`) !== null, projectKey);
        }
        await groupHeader.click();
        await row(page, "group", groupId).waitFor({ state: "visible" });
        await header(page).waitFor({ state: "detached" });

        // Fold the section with an unread session other than the selected one;
        // reload restores the fold without marking that other session read.
        await (await openMenu(page, "pinned", pinnedId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await header(page).waitFor({ state: "visible" });
        await header(page).click();
        assert.equal(await header(page).getAttribute("aria-expanded"), "false");
        assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:sidebar-unread-collapsed")), "true");
        await page.reload({ waitUntil: "domcontentloaded" });
        await showSessions(page);
        await header(page).waitFor({ state: "visible" });
        await page.waitForFunction(() => document.querySelector('[data-row-key="unread-header"] button')?.getAttribute("aria-expanded") === "false");
        assert.equal(await row(page, "unread", pinnedId).count(), 0);
        await header(page).click();
        await row(page, "unread", pinnedId).waitFor({ state: "visible" });

        // Exercise the existing polling transition without a model call: a
        // background run ends, and the same unread marker feeds the new group.
        await second.close();
        await page.bringToFront();
        let running = true;
        await page.route("**/api/agent/running", async (route) => {
          const response = await route.fetch();
          const data = await response.json();
          await route.fulfill({ response, json: {
            ...data,
            runningSessionIds: running ? [currentId] : [],
            awaitingInputSessionIds: [],
            subagentsActiveSessionIds: [],
            completionNotificationSuppressedSessionIds: [],
          } });
        });
        await row(page, "group", currentId).locator(".sidebar-spin").waitFor({ state: "visible" });
        running = false;
        await row(page, "unread", currentId).waitFor({ state: "visible" });
        await page.unroute("**/api/agent/running");
        assert.deepEqual(errors, []);
        console.log(`PASS: ${mobile ? "mobile" : "desktop"} unread grouping, completion, pin, focus, cross-tab read and fold persistence`);
        await context.tracing.stop();
      } catch (error) {
        await page.screenshot({ path: join(artifacts, `session-unread-${mobile ? "mobile" : "desktop"}-failure.png`) }).catch(() => {});
        await context.tracing.stop({ path: join(artifacts, `session-unread-${mobile ? "mobile" : "desktop"}-trace.zip`) }).catch(() => {});
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await post("/api/sessions/ui-state", { action: "restore", entries: [snapshot] });
  }
}
