import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarSessions } from "./sidebar.mjs";

/** Unread markers stay in their pinned or project home, with cross-tab sync. */
export async function checkUnreadMarkers({ browser, base, artifacts, api, post, pinnedId, groupId, currentId }) {
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
      page.setDefaultNavigationTimeout(120_000);
      const row = (target, where, id) => target.locator(`[data-row-key=${JSON.stringify(`session:${where}:${id}`)}]`);
      const groupHeader = (target) => target.locator(`[data-row-key=${JSON.stringify(`group:${projectKey}`)}] .session-tree-group-toggle`);
      const pinnedHeader = (target) => target.locator('[data-row-key="pinned-header"] .session-tree-pinned-toggle');
      const showSessions = async (target) => {
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
        await page.evaluate(({ ids, key }) => {
          localStorage.setItem("pi-web:unread-session-ids", JSON.stringify(ids));
          localStorage.setItem("pi-web:sidebar-pins-collapsed", "false");
          localStorage.setItem("pi-web:sidebar-groups-v2", JSON.stringify({ [key]: true }));
        }, { ids: [pinnedId, groupId], key: projectKey });
        await page.reload({ waitUntil: "domcontentloaded" });
        await showSessions(page);
        await row(page, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await row(page, "group", groupId).locator(".session-tree-unread").waitFor({ state: "visible" });
        assert.equal(await page.locator('[data-row-key="unread-header"]').count(), 0);
        assert.equal(await page.locator(`[data-row-key$=${JSON.stringify(`:${pinnedId}`)}]`).count(), 1);
        assert.equal(await page.locator(`[data-row-key$=${JSON.stringify(`:${groupId}`)}]`).count(), 1);

        // Folded homes retain a visible unread summary.
        await pinnedHeader(page).click();
        await pinnedHeader(page).locator(".session-tree-pinned-dot.is-unread").waitFor({ state: "visible" });
        await pinnedHeader(page).click();
        await groupHeader(page).click();
        if (!mobile) await page.mouse.move(0, 0); // Hover shows actions instead of the summary.
        await groupHeader(page).locator(".session-tree-summary-unread").waitFor({ state: "visible" });
        await groupHeader(page).click();

        const second = await context.newPage();
        second.setDefaultTimeout(30_000);
        second.setDefaultNavigationTimeout(120_000);
        await second.goto(`${base}/?session=${currentId}`, { waitUntil: "domcontentloaded" });
        await showSessions(second);
        await row(second, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await page.bringToFront();

        const menu = await openMenu(page, "pinned", pinnedId);
        assert.equal(await menu.getByRole("menuitem", { name: /^Unpin/ }).count(), 1);
        assert.equal(await menu.getByRole("menuitem", { name: /^Mark as read/ }).count(), 1);
        await page.keyboard.press("Escape");
        const link = row(page, "pinned", pinnedId).locator(".session-tree-main");
        await link.focus();
        await link.press("Enter");
        await page.waitForURL((url) => url.searchParams.get("session") === pinnedId);
        if (mobile) {
          await page.waitForFunction(() => document.querySelector("#session-sidebar")?.classList.contains("sidebar-closed"));
          await page.waitForFunction(() => !document.querySelector("#session-sidebar")?.contains(document.activeElement));
        }
        await showSessions(page);
        await row(page, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "detached" });
        await row(second, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "detached" });
        await row(page, "pinned", pinnedId).waitFor({ state: "visible" });
        if (!mobile) await page.waitForFunction((id) => document.activeElement?.closest(`[data-row-key="session:pinned:${id}"]`) !== null, pinnedId);

        // Marking the selected row unread and clicking it clears it again.
        await (await openMenu(page, "pinned", pinnedId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await row(second, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await row(page, "pinned", pinnedId).locator(".session-tree-main").click();
        await showSessions(page);
        await row(page, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "detached" });
        await row(second, "pinned", pinnedId).locator(".session-tree-unread").waitFor({ state: "detached" });

        const projectLink = row(page, "group", groupId).locator(".session-tree-main");
        if (mobile) await projectLink.click();
        else { await projectLink.focus(); await projectLink.press("Enter"); }
        await page.waitForURL((url) => url.searchParams.get("session") === groupId);
        await showSessions(page);
        await row(page, "group", groupId).locator(".session-tree-unread").waitFor({ state: "detached" });
        await row(second, "group", groupId).locator(".session-tree-unread").waitFor({ state: "detached" });
        await row(page, "group", groupId).waitFor({ state: "visible" });

        // Archive/Undo restores an unread marker on a nonselected session.
        await row(page, "pinned", pinnedId).locator(".session-tree-main").click();
        await showSessions(page);
        await (await openMenu(page, "group", groupId)).getByRole("menuitem", { name: /^Mark as unread/ }).click();
        await row(page, "group", groupId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await (await openMenu(page, "group", groupId)).getByRole("menuitem", { name: /^Archive/ }).click();
        await row(page, "group", groupId).waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await row(page, "group", groupId).locator(".session-tree-unread").waitFor({ state: "visible" });

        // Simulate a background completion without making a model call.
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
        await row(page, "group", currentId).locator(".session-tree-unread").waitFor({ state: "visible" });
        await page.unroute("**/api/agent/running");
        assert.deepEqual(errors, []);
        console.log(`PASS: ${mobile ? "mobile" : "desktop"} unread markers in their homes, folded summaries, cross-tab read and completion`);
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
