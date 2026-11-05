import assert from "node:assert/strict";
import { showSidebarFiles } from "./sidebar.mjs";

// Frontmatter and a comment make Mermaid's parser line differ from the
// source line: Mermaid preprocesses them before parsing.
export const mermaidFixture = [
  "A valid diagram:",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "```",
  "",
  "An invalid diagram:",
  "```mermaid",
  "---",
  "title: Example",
  "---",
  "%% A comment in the original source",
  "graph TD",
  "  subgraph Title (CLI)",
  "    A -->",
  "  end",
  "```",
  "",
  "An unrecognized diagram:",
  "```mermaid",
  "not-a-diagram",
  "```",
  "",
  "A sequence diagram:",
  "```mermaid",
  "sequenceDiagram",
  "  Alice->>Bob: Hello",
  "```",
  "",
  "A repairable flowchart:",
  "```mermaid",
  "flowchart TD",
  "  subgraph Outer Shell (Browser)",
  "    WebUI[Web UI (ChatView)] --> WS[Protocol]",
  "  end",
  "  subgraph Runtime Engine (Core)",
  "    WS --> InPi[AgentSession (Pi Core)]",
  "    DB[(Database)] --> InPi",
  "  end",
  "```",
].join("\n");

export const mermaidLimitFixture = [
  "```mermaid",
  "graph TD",
  "  SHORT --> B",
  "%% comment\n".repeat(5000),
  "```",
  "",
  "```mermaid",
  "graph TD",
  `  LONG["${"x".repeat(50001)}"] --> B`,
  "```",
].join("\n");

/** A completed message must keep its diagram and show actionable syntax errors. */
export async function checkMermaid(page, base, sessionId) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  const blocks = page.locator(".markdown-code-block").filter({
    has: page.locator(".markdown-code-lang", { hasText: "mermaid" }),
  });
  await blocks.nth(0).locator(".mermaid-preview-button svg").waitFor();
  assert.doesNotMatch(await blocks.nth(0).innerText(), /Syntax corrected for preview/i);
  const downloadPromise = page.waitForEvent("download");
  await blocks.nth(0).getByRole("button", { name: "Download file (SVG)", exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "mermaid-diagram.svg");
  assert.equal(await download.failure(), null);
  await blocks.nth(0).getByRole("button", { name: "Open diagram viewer" }).click();
  const dialog = page.getByRole("dialog", { name: "Mermaid diagram viewer" });
  await dialog.locator("svg").first().waitFor();
  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.match(await dialog.innerText(), /125%/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const failure = blocks.nth(1).locator(".mermaid-block-error");
  await failure.waitFor();
  const message = await failure.innerText();
  assert.match(message, /Mermaid syntax error/i);
  assert.match(message, /Mermaid parser line 2/i);
  assert.match(message, /preprocess/i);
  assert.equal(await failure.getByText("Show details", { exact: true }).count(), 1);
  await failure.getByText("Show details", { exact: true }).click();
  assert.match(await failure.locator("pre").innerText(), /Parse error on line 2/i);
  assert.match(await failure.locator("pre").innerText(), /subgraph Title/);
  await blocks.nth(1).getByRole("button", { name: "Source", exact: true }).click();
  assert.match(await blocks.nth(1).locator("pre").innerText(), /subgraph Title \(CLI\)/);
  assert.match(await blocks.nth(1).locator("pre").innerText(), /A comment in the original source/);
  await blocks.nth(1).getByRole("button", { name: "Copy", exact: true }).click();
  await blocks.nth(1).getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), [
    "---", "title: Example", "---", "%% A comment in the original source", "graph TD", "  subgraph Title (CLI)", "    A -->", "  end",
  ].join("\n"));
  const unknown = blocks.nth(2).locator(".mermaid-block-error");
  await unknown.waitFor();
  assert.match(await unknown.innerText(), /Mermaid diagram type not recognized/i);
  assert.doesNotMatch(await unknown.innerText(), /syntax error/i);
  await blocks.nth(3).locator(".mermaid-preview-button svg").waitFor();
  const repaired = blocks.nth(4);
  const repairedSvg = repaired.locator(".mermaid-preview-button svg");
  await repairedSvg.or(repaired.locator(".mermaid-block-error")).first().waitFor();
  assert.equal(await repairedSvg.count(), 1, "repairable diagram should render, not show an error");
  assert.doesNotMatch(await repaired.innerText(), /Syntax corrected for preview; original source is unchanged/i);
  const ids = await repaired.locator(".mermaid-preview-button svg .cluster").evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => /-subGraph\d+$/.test(id)), "implicit subgraph IDs must stay implicit");
  const database = repaired.locator('.mermaid-preview-button svg g.node[id*="-flowchart-DB-"]');
  assert.equal(await database.locator(":scope > path").count(), 1, "the database must keep its cylinder shape");
  assert.equal(await database.locator(":scope > rect").count(), 0);
  const repairedDownloadPromise = page.waitForEvent("download");
  await repaired.getByRole("button", { name: "Download file (SVG)", exact: true }).click();
  assert.equal(await (await repairedDownloadPromise).failure(), null);
  await repaired.getByRole("button", { name: "Copy corrected Mermaid source", exact: true }).click();
  await repaired.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), [
    "flowchart TD",
    '  subgraph "Outer Shell (Browser)"',
    '    WebUI["Web UI (ChatView)"] --> WS[Protocol]',
    "  end",
    '  subgraph "Runtime Engine (Core)"',
    '    WS --> InPi["AgentSession (Pi Core)"]',
    "    DB[(Database)] --> InPi",
    "  end",
  ].join("\n"));
  await repaired.getByRole("button", { name: "Source", exact: true }).click();
  assert.match(await repaired.locator("pre").innerText(), /subgraph Outer Shell \(Browser\)/);
  await repaired.getByRole("button", { name: "Copy", exact: true }).click();
  await repaired.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), [
    "flowchart TD",
    "  subgraph Outer Shell (Browser)",
    "    WebUI[Web UI (ChatView)] --> WS[Protocol]",
    "  end",
    "  subgraph Runtime Engine (Core)",
    "    WS --> InPi[AgentSession (Pi Core)]",
    "    DB[(Database)] --> InPi",
    "  end",
  ].join("\n"));
  await repaired.getByRole("button", { name: "Preview", exact: true }).click();
  await repaired.locator(".mermaid-preview-button svg").waitFor();
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
    await blocks.nth(0).locator(".mermaid-preview-button svg").waitFor();
    await repaired.locator(".mermaid-preview-button svg").waitFor();
    assert.doesNotMatch(await repaired.innerText(), /Syntax corrected for preview/i);
  }
  for (const [locale, title, line, copyLabel, badge] of [
    ["zh-CN", "Mermaid 语法错误", "Mermaid 解析行号 2（预处理后）", "复制修正后的 Mermaid 源码", "已自动修正语法，仅用于预览；原始源码未更改。"],
    ["zh-TW", "Mermaid 語法錯誤", "Mermaid 解析行號 2（前處理後）", "複製修正後的 Mermaid 原始碼", "已自動修正語法，僅供預覽；原始碼未變更。"],
  ]) {
    await page.evaluate((value) => localStorage.setItem("pi-locale", value), locale);
    await page.reload({ waitUntil: "domcontentloaded" });
    await blocks.nth(1).getByText(title, { exact: true }).waitFor();
    assert.equal(await blocks.nth(1).getByText(line, { exact: true }).count(), 1);
    await repaired.getByRole("button", { name: copyLabel, exact: true }).waitFor();
    assert.equal(await repaired.getByText(badge, { exact: true }).count(), 0);
  }
  await page.evaluate(() => localStorage.setItem("pi-locale", "en"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await blocks.nth(1).getByText("Mermaid syntax error", { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  await repaired.locator(".mermaid-preview-button svg").waitFor();
  const layout = await repaired.evaluate((root) => {
    const frame = root.getBoundingClientRect();
    const label = root.querySelector(".markdown-code-lang").getBoundingClientRect();
    const buttons = [...root.querySelectorAll(".markdown-code-actions button")].map((button) => button.getBoundingClientRect());
    return { left: frame.left, right: frame.right, labelRight: label.right, buttons: buttons.map((box) => ({ left: box.left, right: box.right })) };
  });
  assert.ok(layout.buttons.length >= 3);
  assert.ok(layout.labelRight <= layout.buttons[0].left, "mobile buttons must not overlap the language label");
  assert.ok(layout.buttons.every((button) => button.left >= layout.left && button.right <= layout.right), "mobile buttons must stay inside the code block");

  // On a mobile screen, the zoom dialog toolbar must be visible, properly positioned,
  // and closeable back to the chat window.
  await blocks.nth(0).getByRole("button", { name: "Open diagram viewer" }).click();
  const mobileDialog = page.getByRole("dialog", { name: "Mermaid diagram viewer" });
  await mobileDialog.locator("svg").first().waitFor();
  const closeButton = mobileDialog.getByRole("button", { name: "Close", exact: true });
  await closeButton.waitFor({ state: "visible" });
  const toolbar = mobileDialog.locator(".mermaid-zoom-toolbar");
  const toolbarBox = await toolbar.boundingBox();
  const closeBox = await closeButton.boundingBox();
  assert.ok(toolbarBox && closeBox);
  assert.ok(closeBox.y >= toolbarBox.y, "close button must be within or below toolbar top");
  await closeButton.click();
  await mobileDialog.waitFor({ state: "hidden" });

  await page.setViewportSize({ width: 1280, height: 800 });
  console.log("PASS: Mermaid errors, source copy, zoom, SVG download, themes, translations, and mobile controls");
}

/** Markdown file previews use the same Mermaid rendering and diagnostics. */
export async function checkMermaidFile(page, filePath, limitFilePath) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  const hideSidebar = page.getByRole("button", { name: "Hide sidebar", exact: true });
  const openFile = async (path) => {
    // The mobile-to-desktop breakpoint can reopen the sidebar between an
    // isVisible check and a click, as in the main E2E runner.
    await hideSidebar.or(showSidebar).waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 5 && !(await hideSidebar.isVisible()); attempt++) {
      await showSidebar.click({ timeout: 1_000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await hideSidebar.waitFor({ state: "visible" });
    await showSidebarFiles(page);
    await page.getByTitle(path.replace(/\\/g, "/"), { exact: true }).click();
  };
  await openFile(filePath);
  const panel = page.locator("#file-panel");
  const blocks = panel.locator(".markdown-code-block").filter({
    has: page.locator(".markdown-code-lang", { hasText: "mermaid" }),
  });
  await blocks.nth(0).locator(".mermaid-preview-button svg").waitFor();
  const failure = blocks.nth(1).locator(".mermaid-block-error");
  await failure.waitFor();
  assert.match(await failure.innerText(), /Mermaid syntax error/i);
  assert.match(await failure.innerText(), /Mermaid parser line 2/i);
  await blocks.nth(1).getByRole("button", { name: "Source", exact: true }).click();
  assert.match(await blocks.nth(1).locator("pre").innerText(), /subgraph Title \(CLI\)/);
  await blocks.nth(4).locator(".mermaid-preview-button svg").waitFor();
  assert.doesNotMatch(await blocks.nth(4).innerText(), /Syntax corrected for preview/i);
  assert.equal(await blocks.nth(4).getByRole("button", { name: "Copy corrected Mermaid source", exact: true }).count(), 1);
  await openFile(limitFilePath);
  const short = blocks.nth(0).locator(".mermaid-preview-button svg");
  await short.waitFor();
  assert.match(await short.textContent(), /SHORT/);
  assert.doesNotMatch(await short.textContent(), /Maximum text size in diagram exceeded/);
  const long = blocks.nth(1).locator(".mermaid-preview-button svg");
  await long.waitFor();
  assert.match(await long.textContent(), /Maximum text size in diagram exceeded/);
  console.log("PASS: Markdown previews and Mermaid's preprocessed size limit");
}

/** Loading the app succeeds, then Mermaid's lazy chunks fail on session selection. */
export async function checkMermaidLoadingFailure(page, base, plainSessionId, sessionId) {
  await page.goto(`${base}/?session=${plainSessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  let blocked = 0;
  await page.route(/\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/, async (route) => {
    blocked++;
    await route.abort("failed");
  });
  await page.locator(`a[href="?session=${sessionId}"]`).click();
  const block = page.locator(".markdown-code-block").filter({
    has: page.locator(".markdown-code-lang", { hasText: "mermaid" }),
  }).first();
  const failure = block.locator(".mermaid-block-error");
  await failure.waitFor();
  assert.ok(blocked > 0, "the test must actually block a lazy chunk");
  const message = await failure.innerText();
  assert.match(message, /could not load Mermaid/i);
  assert.match(message, /refresh/i);
  assert.doesNotMatch(message, /syntax error/i);
  await block.getByRole("button", { name: "Source", exact: true }).click();
  assert.match(await block.locator("pre").innerText(), /graph TD/);
  console.log("PASS: a Mermaid loading failure is distinct from a syntax error");
}

/** A diagram type may load its own parser after Mermaid itself has loaded. */
export async function checkMermaidDiagramLoadingFailure(page, base, flowSessionId, sessionId) {
  await page.goto(`${base}/?session=${flowSessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".mermaid-preview-button svg").waitFor();
  let blocked = 0;
  await page.route(/\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/, async (route) => {
    blocked++;
    await route.abort("failed");
  });
  await page.locator(`a[href="?session=${sessionId}"]`).click();
  const blocks = page.locator(".markdown-code-block").filter({
    has: page.locator(".markdown-code-lang", { hasText: "mermaid" }),
  });
  await blocks.nth(0).locator(".mermaid-preview-button svg").waitFor();
  const failure = blocks.nth(3).locator(".mermaid-block-error");
  await failure.waitFor();
  assert.ok(blocked > 0, "the test must actually block a diagram's lazy chunk");
  const message = await failure.innerText();
  assert.match(message, /could not parse or load Mermaid/i);
  assert.doesNotMatch(message, /syntax error/i);
  console.log("PASS: a diagram parser loading failure is not called a syntax error");
}

/** A valid diagram can parse and still fail while Mermaid builds its SVG. */
export async function checkMermaidRenderFailure(page, base, sessionId) {
  await page.addInitScript(() => {
    CSSStyleSheet.prototype.insertRule = () => { throw new Error("E2E Mermaid render failure"); };
  });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  const block = page.locator(".markdown-code-block").filter({
    has: page.locator(".markdown-code-lang", { hasText: "mermaid" }),
  }).first();
  const failure = block.locator(".mermaid-block-error");
  await failure.waitFor();
  const message = await failure.innerText();
  assert.match(message, /could not render Mermaid/i);
  assert.doesNotMatch(message, /syntax error|could not load/i);
  const repaired = page.locator(".markdown-code-block").filter({
    has: page.locator(".markdown-code-lang", { hasText: "mermaid" }),
  }).nth(4);
  const repairedFailure = repaired.locator(".mermaid-block-error");
  await repairedFailure.waitFor();
  assert.match(await repairedFailure.innerText(), /Mermaid syntax error/i);
  assert.equal(await repaired.getByRole("button", { name: "Copy corrected Mermaid source", exact: true }).count(), 0);
  assert.equal(await page.locator('[id^="dmermaid-"]').count(), 0, "failed renders must not leave temporary SVGs over the page");
  await block.getByRole("button", { name: "Source", exact: true }).click();
  assert.match(await block.locator("pre").innerText(), /graph TD/);
  console.log("PASS: a Mermaid render failure is distinct from syntax and loading failures");
}
