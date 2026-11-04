import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

async function assertExpandedBesideSidebar(page) {
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector("#session-sidebar");
    const panel = document.querySelector("#file-panel");
    const sidebarRect = sidebar.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return { sidebarRight: sidebarRect.right, panelLeft: panelRect.left, panelRight: panelRect.right, sidebarInert: sidebar.inert };
  });
  assert.equal(layout.sidebarInert, false, "The sidebar remains interactive when the panel is expanded");
  assert.ok(Math.abs(layout.panelLeft - layout.sidebarRight) < 1, `The expanded panel starts beside the sidebar: ${JSON.stringify(layout)}`);
  assert.ok(Math.abs(layout.panelRight - page.viewportSize().width) < 1, "The expanded panel reaches the right edge");
}

export const filePanelFixture = `<!doctype html><html><head><script>
localStorage.setItem("number", 42);
sessionStorage.setItem("flag", true);
localStorage.setItem("remove", "gone");
localStorage.removeItem("remove");
localStorage.named = "property value";
const named = localStorage.getItem("named");
delete localStorage.named;
let parentDenied = false;
try { window.parent.document.body; } catch (error) { parentDenied = error.name === "SecurityError"; }
document.documentElement.setAttribute("data-storage-result", JSON.stringify({
  local: localStorage.getItem("number"),
  session: sessionStorage.getItem("flag"),
  separate: sessionStorage.getItem("number"),
  removed: localStorage.getItem("remove"),
  length: localStorage.length,
  key: localStorage.key(0),
  named,
  parentDenied,
  origin: self.origin
}));
</script></head><body style="margin:20px;min-height:2400px">
<label>Notes <input id="notes"></label>
<label>Filter <select id="filter"><option>All</option><option>Pending</option></select></label>
<p>HTML preview state must survive layout changes.</p>
<script>window.previewInstance = Math.random();</script></body></html>`;

// Over 256 KB so the preview must use the full-file download rather than the
// source view's first chunk. The first script precedes any explicit head.
export const largeStorageFixture = `<!doctype html><!-- <head> in a comment --><html lang="en">
<script>
localStorage.setItem("large", "ready");
sessionStorage.named = "separate";
document.documentElement.dataset.largeStorage = JSON.stringify({
  value: localStorage.getItem("large"),
  session: sessionStorage.getItem("named"),
  mode: document.compatMode
});
</script><body><p>Large HTML preview ready</p><!--${"x".repeat(300 * 1024)}--></body></html>`;

export async function checkFilePanel(page, filePath) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  // The explorer lives in the sidebar's files: below the sessions, or its tab.
  await showSidebarFiles(page);
  // The DOM title normalizes Windows paths to forward slashes
  // (lib/file-paths.ts normalizeFilePathSlashes), so match in that form.
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  const panel = page.locator("#file-panel");
  const iframe = panel.locator("iframe");
  await iframe.waitFor();
  let frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator("#notes").waitFor();
  assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts");
  assert.deepEqual(JSON.parse(await frame.locator("html").getAttribute("data-storage-result")), {
    local: "42", session: "true", separate: null, removed: null, length: 1, key: "number",
    named: "property value", parentDenied: true, origin: "null",
  }, "the preview's first script can use both isolated storage objects without accessing its parent");
  await frame.evaluate(() => localStorage.setItem("ephemeral", "preview only"));
  await panel.getByRole("button", { name: "Source", exact: true }).click();
  assert.equal(await panel.getByRole("button", { name: "Refresh", exact: true }).count(), 0, "Source has no preview refresh");
  const source = await panel.locator(".file-viewer-content").innerText();
  assert.ok(source.includes('localStorage.setItem("number", 42)'));
  assert.ok(!source.includes("data-pi-web-polyfill"), "the source view must remain unchanged");
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await iframe.waitFor();
  frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator("#notes").waitFor();
  assert.equal(await frame.evaluate(() => localStorage.getItem("ephemeral")), null, "a remounted preview gets fresh in-memory storage");
  await frame.locator("#notes").fill("Keep this note");
  await frame.locator("#filter").selectOption({ label: "Pending" });
  await frame.evaluate(() => scrollTo(0, 120));
  const instance = await frame.evaluate(() => window.previewInstance);
  const width = () => panel.evaluate(async el => {
    await new Promise(requestAnimationFrame);
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
    return el.getBoundingClientRect().width;
  });
  const storedWidths = () => page.evaluate(() => [
    localStorage.getItem("pi-sidebar-width"), localStorage.getItem("pi-right-panel-width"),
  ]);
  const toggle = panel.getByRole("button", { name: "Expand file panel", exact: true });
  if (page.viewportSize().width <= 640) {
    assert.equal(await toggle.isVisible(), false, "Mobile already uses full width");
  } else {
    // Include a manually resized split in the round trip.
    const separator = page.locator('[data-resize-handle="right-panel"]');
    if (await separator.isVisible()) await separator.press("ArrowLeft");
    const originalWidth = await width();
    const originalStored = await storedWidths();
    const sessionInfo = page.getByRole("button", { name: "Session info", exact: true });
    const sessionPopover = page.locator(".session-info-popover");
    for (let i = 0; i < 2; i++) {
      await sessionInfo.click();
      await sessionPopover.waitFor();
      await toggle.click();
      assert.equal(await sessionPopover.count(), 0, "Full-width mode dismisses inert top-bar menus");
      assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true");
      await width();
      await assertExpandedBesideSidebar(page);
      assert.equal(await frame.evaluate(() => window.previewInstance), instance);
      assert.equal(await frame.evaluate(() => scrollY), 120);
      assert.equal(await frame.locator("#notes").inputValue(), "Keep this note");
      assert.equal(await frame.locator("#filter").inputValue(), "Pending");
      await panel.getByRole("button", { name: "Restore file panel width", exact: true }).press("Enter");
      assert.equal(await width(), originalWidth);
      assert.deepEqual(await storedWidths(), originalStored);
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
    }
    await toggle.click();
    // Drag from the panel side of the hit target and check the boundary before
    // releasing: live resizing must not wait for React's committed width.
    const sidebar = page.locator("#session-sidebar");
    const sidebarHandle = page.locator('[data-resize-handle="sidebar"]');
    const sidebarBox = await sidebar.boundingBox();
    const startX = sidebarBox.x + sidebarBox.width + 3;
    const startY = sidebarBox.y + sidebarBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 24, startY);
    assert.ok((await sidebar.boundingBox()).width < sidebarBox.width - 20, "The entire sidebar resize target stays usable");
    await assertExpandedBesideSidebar(page);
    await page.mouse.move(startX, startY);
    await page.mouse.up();
    await assertExpandedBesideSidebar(page);
    await sidebarHandle.press("ArrowLeft");
    await assertExpandedBesideSidebar(page);
    await sidebarHandle.press("ArrowRight");
    await assertExpandedBesideSidebar(page);
    // The round trip returned to the same widths; restore an absent preference too.
    await page.evaluate(([sidebarWidth]) => {
      if (sidebarWidth === null) localStorage.removeItem("pi-sidebar-width");
      else localStorage.setItem("pi-sidebar-width", sidebarWidth);
    }, originalStored);
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("button", { name: "Show file panel", exact: true }).click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "Reopening returns to the split layout");
    assert.equal(await width(), originalWidth);
    assert.equal(await frame.evaluate(() => window.previewInstance), instance);

    // An already closed sidebar stays closed; expansion still uses the whole viewport.
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
    await page.getByRole("button", { name: "Show file panel", exact: true }).click();
    await toggle.click();
    assert.equal(Math.round(await width()), page.viewportSize().width);
    await panel.getByRole("button", { name: "Restore file panel width", exact: true }).click();
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await page.getByRole("button", { name: "Show file panel", exact: true }).click();
  }
  // Refresh runs the same sandboxed HTML again, not the surrounding app.
  await frame.evaluate(() => localStorage.setItem("ephemeral", "before refresh"));
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await iframe.waitFor();
  frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator("#notes").waitFor();
  assert.notEqual(await frame.evaluate(() => window.previewInstance), instance);
  assert.equal(await frame.locator("#notes").inputValue(), "");
  assert.equal(await frame.evaluate(() => localStorage.getItem("ephemeral")), null);
  assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts");
  assert.equal(await panel.getByRole("button", { name: "Preview", exact: true }).getAttribute("aria-pressed"), "true");
  if (page.viewportSize().width > 959) {
    // Compact desktops normally use a modal overlay. Expansion must remove its
    // backdrop so a file can be opened from the still-visible sidebar.
    const originalViewport = page.viewportSize();
    await page.setViewportSize({ ...originalViewport, width: 800 });
    await toggle.click();
    await assertExpandedBesideSidebar(page);
    const otherFile = join(dirname(filePath), "large-storage.html").replace(/\\/g, "/");
    await page.locator("#session-sidebar").getByTitle(otherFile, { exact: true }).click();
    await panel.frameLocator("iframe").getByText("Large HTML preview ready", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true");
    await page.locator("#session-sidebar").getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
    await panel.frameLocator("iframe").locator("#notes").waitFor();
    await panel.getByRole("button", { name: "Close large-storage.html", exact: true }).click();
    await panel.getByRole("tab", { name: "large-storage.html", exact: true }).waitFor({ state: "detached" });
    await panel.getByRole("button", { name: "Restore file panel width", exact: true }).click();
    await page.setViewportSize(originalViewport);
  }
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  console.log(`PASS: file panel width, preview state and refresh at ${page.viewportSize().width}px`);
}

export async function checkLargeHtmlStorage(page, filePath) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  await showSidebarFiles(page);
  const download = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/large-storage.html") && url.searchParams.get("type") === "download";
  });
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  assert.equal((await download).status(), 200);
  const panel = page.locator("#file-panel");
  const iframe = panel.locator('iframe[sandbox="allow-scripts"]');
  await iframe.waitFor();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.getByText("Large HTML preview ready", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await frame.locator("html").getAttribute("data-large-storage")), {
    value: "ready", session: "separate", mode: "CSS1Compat",
  });
  await frame.evaluate(() => localStorage.setItem("ephemeral", "before refresh"));
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  const refreshed = await (await iframe.elementHandle()).contentFrame();
  await refreshed.getByText("Large HTML preview ready", { exact: true }).waitFor();
  assert.equal(await refreshed.evaluate(() => localStorage.getItem("ephemeral")), null);
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  console.log(`PASS: full-file sandboxed HTML storage preview at ${page.viewportSize().width}px`);
}
