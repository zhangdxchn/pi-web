import assert from "node:assert/strict";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";
import { checkGitGraphToolbarLayout } from "./git-graph-layout.mjs";

// The graph API is scripted to exercise loading, pagination, root commits and
// errors without depending on the fixture repository's actual history.
export async function checkGitGraphI18n({ browser, base, artifacts, fixture }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text) => { window.copiedGraphSha = text; },
    } });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const rootSha = "a".repeat(40);
  const childSha = "b".repeat(40);
  const commit = (sha, parents, subject) => ({
    sha, shortSha: sha.slice(0, 7), parents, subject,
    author: "Test Author", authorEmail: "author@example.invalid",
    committedAt: "2026-08-23T00:00:00Z", refs: [],
  });
  const child = commit(childSha, [rootSha], "Fixture child commit");
  const root = commit(rootSha, [], "Fixture root commit");
  // Enough rows to keep the automatic near-bottom loader idle until asked.
  const firstPage = [child, ...Array.from({ length: 39 }, (_, index) =>
    commit((index + 1).toString(16).padStart(40, "0"), [], `Fixture commit ${index + 1}`))];
  const graph = (commits, hasMore) => ({
    isGitRepository: true, branches: ["feature/demo"], currentBranch: "feature/demo", commits, hasMore,
  });
  let releaseInitial;
  let releaseDetail;
  let releaseMore;
  const initialGate = new Promise((resolve) => { releaseInitial = resolve; });
  const detailGate = new Promise((resolve) => { releaseDetail = resolve; });
  const moreGate = new Promise((resolve) => { releaseMore = resolve; });
  let mode = "normal";
  const requests = [];
  await page.route("**/api/git/graph?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params.toString());
    if (params.has("sha")) {
      const selected = params.get("sha") === rootSha ? root : child;
      if (selected === child) await detailGate;
      await route.fulfill({ json: {
        ...selected, body: "", files: selected === root ? [] : [
          { filePath: "src/unchanged-name.ts", status: "modified", additions: 2, deletions: 1 },
        ],
      } }).catch(() => {});
    } else if (mode === "not-repo") {
      await route.fulfill({ json: { ...graph([], false), isGitRepository: false } });
    } else if (mode === "error") {
      await route.fulfill({ status: 400, json: { error: "Backend failure: unchanged" } });
    } else if (params.get("skip") !== "0") {
      await moreGate;
      await route.fulfill({ json: graph([root], false) }).catch(() => {});
    } else {
      await initialGate;
      await route.fulfill({ json: graph(firstPage, true) }).catch(() => {});
    }
  });

  try {
    await page.goto(`${base}/?session=${fixture.id}`, { waitUntil: "domcontentloaded" });
    await page.getByText("E2E linked-worktree answer", { exact: true }).waitFor();
    await showSidebarFiles(page);
    await page.getByRole("button", { name: "Git Graph", exact: true }).click();
    const panel = page.locator("#file-panel");
    await panel.getByText("Loading Git graph…", { exact: true }).waitFor();
    releaseInitial();
    await panel.getByText("Fixture child commit", { exact: true }).waitFor();
    const panelStyle = await panel.evaluate((element) => ({
      width: element.style.getPropertyValue("--right-panel-width"),
      transition: element.style.transition,
    }));
    for (const [width, minSearchWidth] of [[300, 245], [360, 295], [520, 340], [700, 340]]) {
      await panel.evaluate((element, nextWidth) => {
        element.style.transition = "none";
        element.style.setProperty("--right-panel-width", `${nextWidth}px`);
      }, width);
      await checkGitGraphToolbarLayout({
        panel, search: "Search commits (message, SHA, author)…", allBranches: "All branches",
        refresh: "Refresh graph", minSearchWidth, placeholderFits: width >= 520,
      });
    }
    await panel.evaluate((element, saved) => {
      element.style.setProperty("--right-panel-width", saved.width);
      element.style.transition = saved.transition;
    }, panelStyle);
    await panel.getByText("Fixture child commit", { exact: true }).click();
    await panel.getByText("Loading file changes…", { exact: true }).waitFor();
    releaseDetail();
    await panel.getByText("src/unchanged-name.ts", { exact: true }).waitFor();
    await panel.getByLabel("Search commits (message, SHA, author)…").fill("Fixture");

    const variants = [
      {
        radio: null, locale: "en", title: "Git Graph", search: "Search commits (message, SHA, author)…",
        all: "All branches", current: "Current branch: feature/demo", count: "Loaded: 40",
        remote: "Show remote branches", refresh: "Refresh graph", close: "Close details",
        parent: `Go to parent commit ${rootSha}`, files: "Changed files: 1", diff: "View Diff ↗",
        changesView: "Changed files view", listView: "List", treeView: "Tree",
        load: "Load older commits (+500)", clear: "Clear commit search", copied: "Copied ✓", settings: "Settings", general: "General",
        findCase: "Match case", findRegex: "Use regular expression", findNext: "Next match (Enter)",
        findScope: "Searching loaded commits only. Load older commits to find more.",
      },
      {
        radio: "简体中文", locale: "zh-CN", title: "Git Graph 图谱", search: "搜索提交（信息、SHA、作者）…",
        all: "全部分支", current: "当前分支：feature/demo", count: "已加载：40",
        remote: "显示远端分支", refresh: "刷新图谱", close: "关闭详情",
        parent: `跳转至父提交 ${rootSha}`, files: "变更文件：1", diff: "查看 Diff ↗",
        changesView: "变更文件视图", listView: "列表", treeView: "树形",
        load: "加载更早提交 (+500)", clear: "清除提交搜索", copied: "已复制 ✓", settings: "设置", general: "常规",
        findCase: "区分大小写", findRegex: "使用正则表达式", findNext: "下一个匹配项（Enter）",
        findScope: "仅搜索已加载的提交；加载更早提交后可查找更多结果。",

      },
      {
        radio: "繁體中文", locale: "zh-TW", title: "Git Graph 圖譜", search: "搜尋提交（訊息、SHA、作者）…",
        all: "所有分支", current: "目前分支：feature/demo", count: "已載入：40",
        remote: "顯示遠端分支", refresh: "重新整理圖譜", close: "關閉詳情",
        parent: `前往父提交 ${rootSha}`, files: "變更檔案：1", diff: "檢視 Diff ↗",
        changesView: "變更檔案檢視", listView: "清單", treeView: "樹狀",
        load: "載入更早的提交 (+500)", clear: "清除提交搜尋", copied: "已複製 ✓", settings: "設定", general: "一般",
        findCase: "區分大小寫", findRegex: "使用正規表示式", findNext: "下一個符合項目（Enter）",
        findScope: "只搜尋已載入的提交；載入更早的提交後可查找更多結果。",

      },
    ];
    for (const [index, variant] of variants.entries()) {
      if (variant.radio) {
        const previous = variants[index - 1];
        const requestCount = requests.length;
        await page.getByRole("button", { name: previous.settings, exact: true }).click();
        await page.locator(".settings-section-tabs").getByRole("button", { name: previous.general, exact: true }).click();
        await page.getByRole("radio", { name: new RegExp(`^${variant.radio}`) }).click();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(requests.length, requestCount, "Changing the language must not reload the graph or its details");
      }
      assert.equal(await page.evaluate(() => document.documentElement.lang), variant.locale);
      assert.equal(await page.getByRole("tab", { name: variant.title, exact: true }).count(), 1);
      assert.equal(await panel.getByLabel(variant.search).inputValue(), "Fixture");
      await panel.getByRole("button", { name: variant.clear, exact: true }).waitFor();
      await panel.getByRole("button", { name: variant.findCase, exact: true }).waitFor();
      await panel.getByRole("button", { name: variant.findRegex, exact: true }).waitFor();
      await panel.getByRole("button", { name: variant.findNext, exact: true }).waitFor();
      await panel.getByText(variant.findScope, { exact: true }).waitFor();
      await panel.getByRole("button", { name: variant.refresh, exact: true }).waitFor();
      await panel.getByRole("button", { name: variant.close, exact: true }).waitFor();
      await panel.getByText(variant.remote, { exact: true }).waitFor();
      await panel.getByTestId("git-graph-body").getByText(variant.count, { exact: true }).waitFor({ state: "attached" });
      await panel.getByText(variant.files, { exact: true }).waitFor();
      await panel.getByText(variant.diff, { exact: true }).waitFor();
      const changesView = panel.getByRole("group", { name: variant.changesView });
      const listView = changesView.getByRole("button", { name: variant.listView, exact: true });
      const treeView = changesView.getByRole("button", { name: variant.treeView, exact: true });
      assert.equal(await listView.getAttribute("aria-pressed"), "true");
      const requestCount = requests.length;
      await treeView.click();
      await panel.getByText("unchanged-name.ts", { exact: true }).waitFor();
      await listView.click();
      assert.equal(requests.length, requestCount, "Changing the file view must not reload details");
      await panel.getByRole("button", { name: variant.load, exact: true }).waitFor({ state: "attached" });
      assert.equal(await panel.getByTitle(variant.parent, { exact: true }).count(), 1);
      await panel.getByTitle(childSha, { exact: true }).click();
      await panel.getByRole("button", { name: variant.copied, exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.copiedGraphSha), childSha);
      await panel.getByRole("button", { name: variant.all, exact: true }).click();
      await panel.getByText(variant.current, { exact: true }).waitFor();
      await panel.getByRole("button", { name: variant.all, exact: true }).click();
      assert.equal(await panel.getByText("src/unchanged-name.ts", { exact: true }).count(), 1);
    }

    // Pagination's in-flight label, then the root and empty-detail states.
    await panel.getByRole("button", { name: "載入更早的提交 (+500)", exact: true }).evaluate((button) => button.click());
    await panel.getByText("正在載入更多提交…", { exact: true }).waitFor();
    releaseMore();
    await panel.getByText("已載入全部 41 個提交 · 到達最初提交", { exact: true }).waitFor({ state: "attached" });
    await panel.getByTitle(`前往父提交 ${rootSha}`).click();
    await panel.getByText("（根提交 · 無父提交）", { exact: true }).waitFor();
    await panel.getByText("此提交沒有檔案變更", { exact: true }).waitFor();
    // The error screen unmounts the virtual scrollport. Its replacement starts at
    // zero, so its rendered slice must not retain the previous scroll position.
    const scrollTop = await panel.getByTestId("git-graph-body").evaluate((element) => new Promise((resolve) => {
      element.scrollTop = element.scrollHeight;
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.scrollTop)));
    }));
    assert.ok(scrollTop > 560, "the virtualizer has scrolled beyond its overscan");

    mode = "not-repo";
    await panel.getByRole("button", { name: "重新整理圖譜", exact: true }).click();
    await panel.getByText("目前工作區不是有效的 Git 儲存庫", { exact: true }).waitFor();
    mode = "error";
    await panel.getByRole("button", { name: "重試", exact: true }).click();
    await panel.getByText("Backend failure: unchanged", { exact: true }).waitFor();
    mode = "normal";
    await panel.getByRole("button", { name: "重試", exact: true }).click();
    await panel.getByText("Fixture child commit", { exact: true }).click();
    await panel.getByText("src/unchanged-name.ts", { exact: true }).waitFor();

    // A reload uses the chosen setting, not the browser's English locale.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("E2E linked-worktree answer", { exact: true }).waitFor();
    await showSidebarFiles(page);
    await page.getByRole("button", { name: "Git Graph 圖譜", exact: true }).click();
    await panel.getByLabel("搜尋提交（訊息、SHA、作者）…").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-locale")), "zh-TW");

    // The same saved language applies when the graph fills a phone's screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByLabel("搜尋提交（訊息、SHA、作者）…").waitFor({ state: "visible" });
    await panel.getByRole("button", { name: "所有分支", exact: true }).waitFor();
    await panel.getByRole("button", { name: "重新整理圖譜", exact: true }).waitFor();
    for (const [width, minSearchWidth] of [[390, 300], [320, 245]]) {
      await page.setViewportSize({ width, height: 844 });
      await checkGitGraphToolbarLayout({
        panel, search: "搜尋提交（訊息、SHA、作者）…", allBranches: "所有分支",
        refresh: "重新整理圖譜", minSearchWidth, placeholderFits: width >= 390,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByText("Fixture child commit", { exact: true }).click();
    await panel.getByText("變更檔案：1", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "關閉詳情", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS: Git Graph localizes its states and keeps the search toolbar usable on desktop and mobile");
    await context.tracing.stop();
  } catch (error) {
    releaseInitial();
    releaseDetail();
    releaseMore();
    await page.screenshot({ path: join(artifacts, "git-graph-i18n-failure.png") }).catch(() => {});
    await context.tracing.stop({ path: join(artifacts, "git-graph-i18n-trace.zip") }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
