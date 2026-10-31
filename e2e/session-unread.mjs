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
        locale: "en-US", colorScheme: mobile ? "dark" : "light", hasTouch: mobile, isMobile: mobile,
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
        await page.evaluate((ids) => {
          localStorage.setItem("pi-web:unread-session-ids", JSON.stringify(ids));
          localStorage.setItem("pi-web:sidebar-pins-collapsed", "true");
        }, [pinnedId, groupId]);
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
        await row(page, "unread", pinnedId).locator(".session-tree-read-status").waitFor({ state: "visible" });
        await row(second, "unread", pinnedId).waitFor({ state: "detached" });
        assert.equal(await row(page, "pinned", pinnedId).count(), 0, "the retained row is not duplicated");
        if (!mobile) {
          await page.waitForFunction((id) => document.activeElement?.closest(`[data-row-key="session:unread:${id}"]`) !== null, pinnedId);
        }
        assert.match(await header(page).innerText(), /Unread\s*·\s*1/i);

        // The selected family can be marked unread and read again without a
        // selection change. The actual marker still syncs to the other tab.
        await (await openMenu(page, "unread", pinnedId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "unread", pinnedId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await row(second, "unread", pinnedId).waitFor({ state: "visible" });
        await row(page, "unread", pinnedId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "unread", pinnedId).locator(".session-tree-read-status").waitFor({ state: "visible" });
        await row(second, "unread", pinnedId).waitFor({ state: "detached" });
        const locatePinned = row(page, "unread", pinnedId).getByRole("button", { name: / in Pinned · / });
        await locatePinned.click();
        await row(page, "pinned", pinnedId).waitFor({ state: "visible" });
        assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:sidebar-pins-collapsed")), "false");
        if (!mobile) {
          await page.waitForFunction((id) => document.activeElement?.closest(`[data-row-key="session:pinned:${id}"]`) !== null, pinnedId);
        }

        // The project stays folded while the newly read row remains under
        // unread; an explicit locate opens it and scrolls to the same row.
        const groupHeader = page.locator(`[data-row-key=${JSON.stringify(`group:${projectKey}`)}] .session-tree-group-toggle`);
        await groupHeader.waitFor({ state: "visible" });
        if (await groupHeader.getAttribute("aria-expanded") === "true") await groupHeader.click();
        const projectLink = row(page, "unread", groupId).locator(".session-tree-main");
        if (mobile) await projectLink.click();
        else { await projectLink.focus(); await projectLink.press("Enter"); }
        await page.waitForURL((url) => url.searchParams.get("session") === groupId);
        await showSessions(page);
        assert.equal(await groupHeader.getAttribute("aria-expanded"), "false");
        assert.match(await header(page).innerText(), /Unread\s*·\s*0/i);
        await row(page, "unread", groupId).locator(".session-tree-read-status").waitFor({ state: "visible" });
        await row(second, "unread", groupId).waitFor({ state: "detached" });
        if (!mobile) {
          await page.waitForFunction((id) => document.activeElement?.closest(`[data-row-key="session:unread:${id}"]`) !== null, groupId);
          const resize = page.getByRole("separator", { name: "Resize sidebar", exact: true });
          await resize.press("Home");
          await page.waitForFunction(() => Math.abs(document.querySelector("#session-sidebar").getBoundingClientRect().width - 180) < 1);
          const bounds = await row(page, "unread", groupId).evaluate((element) => {
            const title = element.querySelector(".session-tree-title").getBoundingClientRect();
            const read = element.querySelector(".session-tree-read-status").getBoundingClientRect();
            const locate = element.querySelector(".session-tree-locate-action").getBoundingClientRect();
            const more = element.querySelector(".session-tree-more-action").getBoundingClientRect();
            const box = element.getBoundingClientRect();
            return { titleWidth: title.width, titleRight: title.right, readLeft: read.left, readRight: read.right, locateLeft: locate.left, locateRight: locate.right, moreLeft: more.left, moreRight: more.right, right: box.right };
          });
          assert.ok(bounds.titleWidth >= 50, "the retained title keeps room in a 180px sidebar");
          assert.ok(bounds.titleRight <= bounds.readLeft && bounds.readRight <= bounds.locateLeft && bounds.locateRight <= bounds.moreLeft && bounds.moreRight <= bounds.right, "read and locate controls do not overlap");
          await resize.press("Enter");
        }
        const locateProject = row(page, "unread", groupId).getByRole("button", { name: / in project / });
        if (mobile) await locateProject.click();
        else { await locateProject.focus(); await locateProject.press("Enter"); }
        await row(page, "group", groupId).waitFor({ state: "visible" });
        assert.equal(await groupHeader.getAttribute("aria-expanded"), "true");
        if (!mobile) {
          await page.waitForFunction((id) => document.activeElement?.closest(`[data-row-key="session:group:${id}"]`) !== null, groupId);
        }
        await header(page).waitFor({ state: "detached" });

        // Retention is page-local: reopening after a refresh puts the family
        // in its expanded home, without resurrecting the unread marker.
        await (await openMenu(page, "group", groupId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "unread", groupId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "unread", groupId).locator(".session-tree-read-status").waitFor({ state: "visible" });
        await page.reload({ waitUntil: "domcontentloaded" });
        await showSessions(page);
        await row(page, "group", groupId).waitFor({ state: "visible" });
        await header(page).waitFor({ state: "detached" });

        // Switching to a different session also ends retention.
        await (await openMenu(page, "group", groupId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "unread", groupId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "unread", groupId).locator(".session-tree-read-status").waitFor({ state: "visible" });
        await row(page, "pinned", pinnedId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "group", groupId).waitFor({ state: "visible" });
        await header(page).waitFor({ state: "detached" });

        // Archiving a retained row ends its retention; Undo restores it to
        // its normal project, not as a read row in unread.
        await (await openMenu(page, "group", groupId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "unread", groupId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "unread", groupId).locator(".session-tree-read-status").waitFor({ state: "visible" });
        await (await openMenu(page, "unread", groupId)).getByRole("menuitem", { name: /^Archive/ }).click();
        await row(page, "unread", groupId).waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await row(page, "group", groupId).waitFor({ state: "visible" });
        await header(page).waitFor({ state: "detached" });
        await row(page, "pinned", pinnedId).locator(".session-tree-main").click();
        await page.waitForURL((url) => url.searchParams.get("session") === pinnedId);
        await showSessions(page);

        // Fold the section with an unread session other than the selected one;
        // reload restores the fold without marking that other session read.
        await (await openMenu(page, "group", groupId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await header(page).waitFor({ state: "visible" });
        await header(page).click();
        assert.equal(await header(page).getAttribute("aria-expanded"), "false");
        assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:sidebar-unread-collapsed")), "true");
        await page.reload({ waitUntil: "domcontentloaded" });
        await showSessions(page);
        await header(page).waitFor({ state: "visible" });
        await page.waitForFunction(() => document.querySelector('[data-row-key="unread-header"] button')?.getAttribute("aria-expanded") === "false");
        assert.equal(await row(page, "unread", groupId).count(), 0);
        await header(page).click();
        await row(page, "unread", groupId).waitFor({ state: "visible" });

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
        console.log(`PASS: ${mobile ? "mobile" : "desktop"} unread retention, locate, completion, pin, focus, cross-tab read and fold persistence`);
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
