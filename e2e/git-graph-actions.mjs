import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { showSidebarFiles } from "./sidebar.mjs";

export function createGitGraphActionFixtures({ agentDir }) {
  return ["desktop", "mobile"].map((name) => {
    const repo = join(realpathSync(agentDir), `graph-actions-${name}`);
    const remote = join(realpathSync(agentDir), `graph-actions-${name}.git`);
    mkdirSync(repo); execFileSync("git", ["init", "--bare", "-q", remote]);
    const git = (...args) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", timeout: 10_000 }).trim();
    git("init", "-q", "-b", "main"); git("config", "user.name", "Pi Web E2E"); git("config", "user.email", "e2e@example.invalid");
    writeFileSync(join(repo, "file.txt"), "hello\n"); git("add", "."); git("commit", "-qm", "Graph action fixture");
    git("branch", "topic"); git("tag", "-a", "v1", "-m", "Tag message"); git("remote", "add", "origin", remote);
    return { repo, remote, git, sha: git("rev-parse", "HEAD") };
  });
}

export async function checkGitGraphActions({ browser, base, artifacts, fixtures }) {
  for (const [index, mobile] of [false, true].entries()) {
    const fixture = fixtures[index];
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale: "en-US", hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const graph = page.locator("#file-panel");
    try {
      await page.goto(`${base}/?cwd=${encodeURIComponent(fixture.repo)}`, { waitUntil: "domcontentloaded" });
      await page.locator(".new-session-hero").waitFor();
      const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true }); if (await sidebar.isVisible()) await sidebar.click();
      await showSidebarFiles(page);
      await page.getByRole("button", { name: "Git Graph", exact: true }).click();
      if (!mobile) await graph.getByRole("button", { name: "Expand file panel", exact: true }).click();
      await graph.getByText("Graph action fixture", { exact: true }).waitFor();
      const target = graph.getByRole("button", { name: "Actions for topic", exact: true });
      await target.click();
      assert.equal(await graph.getByRole("button", { name: "Close details" }).count(), 0, "ref clicks do not select the commit");
      await page.getByRole("menuitem", { name: "Rename branch…" }).waitFor();
      await page.waitForTimeout(200); // Capture after SidebarMenu's entrance motion.
      await page.screenshot({ path: join(artifacts, `git-graph-menu-${mobile ? "mobile" : "desktop"}.png`) });
      await page.getByRole("menuitem", { name: "Rename branch…" }).click();
      await page.getByLabel("Name", { exact: true }).fill("topic-renamed");
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await graph.getByRole("button", { name: "Actions for topic-renamed", exact: true }).waitFor();
      assert.equal(fixture.git("rev-parse", "refs/heads/topic-renamed"), fixture.sha);
      await graph.getByRole("button", { name: "Actions for v1", exact: true }).click();
      await page.getByRole("menuitem", { name: "View tag details" }).click();
      await page.locator("pre").filter({ hasText: "Tag message" }).waitFor();
      await page.keyboard.press("Escape");
      await graph.getByRole("button", { name: "Actions for topic-renamed", exact: true }).click();
      await page.getByRole("menuitem", { name: "Push branch…" }).click();
      const pushed = page.waitForResponse((response) => response.url().endsWith("/api/git/graph/actions") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      assert.equal((await pushed).status(), 200);
      await page.getByRole("status").filter({ hasText: "Git action completed" }).waitFor();
      assert.equal(execFileSync("git", ["-C", fixture.remote, "rev-parse", "refs/heads/topic-renamed"], { encoding: "utf8" }).trim(), fixture.sha);
      await graph.getByRole("button", { name: `Actions for commit ${fixture.sha.slice(0, 7)}` }).click();
      await page.getByRole("menuitem", { name: "Reset current branch to this commit…" }).click();
      await page.getByLabel("Reset mode").selectOption("hard");
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await page.getByText("Confirm again: discard staged and working changes?").waitFor();
      await page.screenshot({ path: join(artifacts, `git-graph-hard-reset-${mobile ? "mobile" : "desktop"}.png`) });
      await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
      assert.equal(fixture.git("rev-parse", "HEAD"), fixture.sha);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(artifacts, `git-graph-actions-${mobile ? "mobile" : "desktop"}.png`) });
      console.log(`PASS: ${mobile ? "mobile" : "desktop"} Git Graph branch, tag, push and hard reset confirmation`);
    } finally { await context.close(); }
  }
}
