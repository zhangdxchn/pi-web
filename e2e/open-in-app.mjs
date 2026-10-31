import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

/** Browser interaction with a mocked opener: never starts a real desktop app. */
export async function checkOpenInApp({ browser, base, cwd, sessionId, artifacts }) {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      locale: "en-US", isMobile: mobile, hasTouch: mobile,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [];
    const requests = [];
    let supported = true;
    let failNext = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/open-in-explorer", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { supported, reason: supported ? null : "remote", platform: "darwin", vscodeAvailable: true } });
      } else {
        requests.push(route.request().postDataJSON());
        if (failNext) {
          failNext = false;
          await route.fulfill({ status: 404, json: { error: "application-not-found" } });
        } else {
          await route.fulfill({ json: { opened: true } });
        }
      }
    });
    try {
      await page.goto(`${base}/?session=${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-message-role="assistant"]').first().waitFor({ state: "visible" });
      const show = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await show.isVisible()) await show.click();
      await showSidebarFiles(page);
      const button = page.getByRole("button", { name: "Open project in…", exact: true });
      await button.waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector('[aria-label="Open project in…"]')?.title.includes("Finder"));
      const menu = () => page.getByRole("menu", { name: "Open project in…", exact: true });
      await button.click();
      await menu().waitFor();
      await menu().getByRole("menuitem", { name: "Visual Studio Code", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Open project in…"][aria-expanded="true"]'));
      assert.deepEqual(requests.at(-1), { cwd, application: { kind: "vscode" } });
      await button.click();
      await menu().getByRole("menuitem", { name: "Set Visual Studio Code as default" }).click();
      await page.keyboard.press("Escape");
      if (!mobile) {
        const before = requests.length;
        await button.dblclick({ delay: 80 });
        await page.waitForFunction(([key]) => JSON.parse(localStorage.getItem(key) || "null")?.defaultApp?.kind === "vscode", ["pi-web:open-in-app"]);
        await page.waitForTimeout(150);
        assert.equal(requests.length, before + 1, "double click sends one request");
        assert.deepEqual(requests.at(-1), { cwd, application: { kind: "vscode" } });
        assert.equal(await menu().count(), 0);
      }
      await button.click();
      await menu().getByRole("menuitem", { name: "Add application…" }).click();
      await page.getByLabel("Application name").fill("My editor");
      await page.getByLabel("Application path").fill("/Applications/My Editor.app");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await menu().getByRole("menuitem", { name: "Set My editor as default" }).click();
      await page.keyboard.press("Escape");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-message-role="assistant"]').first().waitFor({ state: "visible" });
      if (mobile) {
        const showAgain = page.getByRole("button", { name: "Show sidebar", exact: true });
        if (await showAgain.isVisible()) await showAgain.click();
        await showSidebarFiles(page);
      }
      const restored = page.getByRole("button", { name: "Open project in…", exact: true });
      await restored.waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector('[aria-label="Open project in…"]')?.title.includes("My editor"));
      if (mobile) {
        await restored.click();
        await menu().getByRole("menuitem", { name: "My editor Default", exact: true }).click();
      } else {
        const before = requests.length;
        await restored.dblclick({ delay: 80 });
        await page.waitForTimeout(150);
        assert.equal(requests.length, before + 1, "restored default opens once");
      }
      assert.deepEqual(requests.at(-1), { cwd, application: { kind: "custom", path: "/Applications/My Editor.app" } });
      await restored.click();
      await menu().getByRole("menuitem", { name: "Remove application…" }).click();
      await menu().getByRole("menuitem", { name: "My editor", exact: true }).click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("pi-web:open-in-app") || "null")?.defaultApp?.kind === "file-manager");
      await page.screenshot({ path: join(artifacts, `open-in-app-${mobile ? "mobile" : "desktop"}.png`) });
      await menu().getByRole("menuitem", { name: "Open in Finder Default", exact: true }).click();
      assert.deepEqual(requests.at(-1), { cwd }, "the original file-manager request is unchanged");
      await restored.click();
      failNext = true;
      await menu().getByRole("menuitem", { name: "Visual Studio Code", exact: true }).click();
      await page.getByRole("alert").getByText("The application was not found. Check its path.").waitFor();
      supported = false;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-message-role="assistant"]').first().waitFor({ state: "visible" });
      if (mobile) {
        const showAgain = page.getByRole("button", { name: "Show sidebar", exact: true });
        if (await showAgain.isVisible()) await showAgain.click();
        await showSidebarFiles(page);
      }
      const disabled = page.getByRole("button", { name: "Only available when Pi Web runs on this computer" });
      await disabled.waitFor({ state: "visible" });
      assert.equal(await disabled.isDisabled(), true);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} open-in-app menu, default, custom app, reload, and remote refusal`);
    } finally {
      await context.close();
    }
  }

  for (const sample of [
    { locale: "zh-CN", width: 320, show: "显示侧边栏", title: "用应用打开项目…", add: "添加应用…", input: "应用路径" },
    { locale: "zh-TW", width: 375, show: "顯示側邊欄", title: "使用應用程式開啟專案…", add: "加入應用程式…", input: "應用程式路徑" },
  ]) {
    const context = await browser.newContext({ viewport: { width: sample.width, height: 844 }, locale: sample.locale, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.route("**/api/open-in-explorer", (route) => route.fulfill({ json: { supported: true, reason: null, platform: "darwin", vscodeAvailable: true } }));
    try {
      await page.goto(`${base}/?session=${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-message-role="assistant"]').first().waitFor({ state: "visible" });
      const show = page.getByRole("button", { name: sample.show, exact: true });
      if (await show.isVisible()) await show.click();
      await page.locator("#session-sidebar-tab-files").click();
      await page.getByRole("button", { name: sample.title, exact: true }).click();
      const menu = page.getByRole("menu", { name: sample.title, exact: true });
      await menu.waitFor();
      const box = await menu.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= sample.width, `${sample.locale} menu fits the viewport`);
      // Capture the settled sheet, not the first frame of its entrance.
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(artifacts, `open-in-app-${sample.locale}.png`) });
      await menu.getByRole("menuitem", { name: sample.add }).click();
      assert.equal(await page.getByLabel(sample.input).isVisible(), true);
      console.log(`PASS: ${sample.locale} open-in-app sheet at ${sample.width}px`);
    } finally {
      await context.close();
    }
  }
}
