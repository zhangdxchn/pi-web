import assert from "node:assert/strict";
import test from "node:test";
import {
  isPlainActivation,
  newSessionDeepLink,
  parseSessionDeepLink,
  replaceSessionDeepLinksWithMarkdown,
  sessionCanonicalDeepLink,
  sessionDeepLink,
  sessionProtocolDeepLink,
} from "./session-links.ts";
import { getInitialNavigation, withTabOpen } from "./initial-navigation.ts";

const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

test("a session link is the encoded id in ?session= and nothing else", () => {
  assert.equal(sessionDeepLink("abc-123"), "?session=abc-123");
  assert.equal(sessionDeepLink("a/b?c&d=1+two #%"), "?session=a%2Fb%3Fc%26d%3D1%2Btwo%20%23%25");
  assert.equal(sessionDeepLink("会话"), "?session=%E4%BC%9A%E8%AF%9D");
});

test("resolved on the page, it keeps origin and path and drops every other parameter", () => {
  const pages = [
    "http://127.0.0.1:30141/",
    "http://127.0.0.1:30141/?session=old#e1",
    // A sub-path deployment, with a stale cwd that would otherwise win over session.
    "https://example.github.io/pi-web/?cwd=%2Fwork%2Fold&session=old#entry",
  ];
  for (const page of pages) {
    const current = new URL(page);
    for (const id of ["abc-123", "a/b?c&d=1+two #%", "https://external.invalid/x", "//evil.invalid"]) {
      const target = new URL(sessionDeepLink(id), current);
      assert.equal(target.origin, current.origin, `${id} on ${page} stays on this instance`);
      assert.equal(target.pathname, current.pathname, `${id} on ${page} keeps the path`);
      assert.deepEqual([...target.searchParams.keys()], ["session"]);
      assert.equal(target.searchParams.get("session"), id);
      assert.equal(target.hash, "");
    }
  }
});

test("the link's session wins over whatever session the new tab remembers", () => {
  const target = new URL(sessionDeepLink("linked"), "http://127.0.0.1:30141/?cwd=%2Fwork");
  const navigation = getInitialNavigation(target.searchParams);
  assert.equal(navigation.requestedCwd, null);
  assert.equal(navigation.sessionId, "linked");
  assert.equal(withTabOpen(navigation, { kind: "session", sessionId: "other-tab" }).sessionId, "linked");
  assert.equal(withTabOpen(navigation, { kind: "new", cwd: "/work" }).sessionId, "linked");
});

test("a fresh-composer link encodes its directory and drops stale navigation parameters", () => {
  assert.equal(newSessionDeepLink("/work/a b&c#d%"), "?cwd=%2Fwork%2Fa%20b%26c%23d%25");
  for (const page of [
    "http://127.0.0.1:30141/?session=old#entry",
    "https://example.invalid/pi-web/?cwd=%2Fold&session=old&sidebar=collapsed#entry",
  ]) {
    const current = new URL(page);
    for (const cwd of ["/work/项目 & notes#1+%", "C:\\Projects\\a b", "\\\\server\\share\\项目", "//external.invalid/path"]) {
      const target = new URL(newSessionDeepLink(cwd), current);
      assert.equal(target.origin, current.origin);
      assert.equal(target.pathname, current.pathname);
      assert.deepEqual([...target.searchParams.keys()], ["cwd"]);
      assert.equal(target.searchParams.get("cwd"), cwd);
      assert.equal(target.hash, "");
    }
  }
});

test("a fresh-composer link never restores the tab's remembered session or directory", () => {
  const target = new URL(newSessionDeepLink("/work/project"), "http://127.0.0.1:30141/?session=old");
  const navigation = getInitialNavigation(target.searchParams);
  assert.equal(navigation.requestedCwd, "/work/project");
  assert.equal(navigation.sessionId, null);
  for (const remembered of [{ kind: "session", sessionId: "old" }, { kind: "new", cwd: "/old" }]) {
    assert.equal(withTabOpen(navigation, remembered), navigation);
  }
});

test("session deeplink helpers generate canonical and protocol formats", () => {
  assert.equal(sessionCanonicalDeepLink("abc-123", "http://localhost:30141"), "http://localhost:30141?session=abc-123");
  assert.equal(sessionProtocolDeepLink("abc-123"), "pi://sessions/abc-123");
});

test("parseSessionDeepLink extracts session IDs from various protocol and URL formats", () => {
  // pi://
  assert.equal(parseSessionDeepLink("pi://sessions/01a1aa7f-30e4-7240-80b2-02bcb03b624b"), "01a1aa7f-30e4-7240-80b2-02bcb03b624b");
  assert.equal(parseSessionDeepLink("pi://sessions/my%20session"), "my session");

  // codex://
  assert.equal(parseSessionDeepLink("codex://threads/01a1aa7f-30e4-7240-80b2-02bcb03b624b"), "01a1aa7f-30e4-7240-80b2-02bcb03b624b");

  // Web URLs
  assert.equal(parseSessionDeepLink("http://localhost:30141/?session=3f9a12bc"), "3f9a12bc");
  assert.equal(parseSessionDeepLink("https://pi.example.com/subpath/?foo=bar&session=8a7c91e2#entry"), "8a7c91e2");
  assert.equal(parseSessionDeepLink("?session=c54d1931"), "c54d1931");

  // Invalid or unrelated URLs
  assert.equal(parseSessionDeepLink("https://example.com/other/path"), null);
  assert.equal(parseSessionDeepLink(""), null);
  assert.equal(parseSessionDeepLink("just some text"), null);
});

test("replaceSessionDeepLinksWithMarkdown substitutes deeplinks with human readable names", () => {
  const titles = {
    "01a1aa7f-30e4": "修复登录问题",
    "3f9a12bc": "终端按键优化",
  };
  const resolver = (id) => titles[id];

  // Single pi:// link
  assert.equal(
    replaceSessionDeepLinksWithMarkdown("请查阅 pi://sessions/01a1aa7f-30e4", resolver),
    "请查阅 [💬 修复登录问题](?session=01a1aa7f-30e4)",
  );

  // codex:// link
  assert.equal(
    replaceSessionDeepLinksWithMarkdown("从 codex://threads/01a1aa7f-30e4 迁移", resolver),
    "从 [💬 修复登录问题](?session=01a1aa7f-30e4) 迁移",
  );

  // Web link
  assert.equal(
    replaceSessionDeepLinksWithMarkdown("参考 http://localhost:30141/?session=3f9a12bc", resolver),
    "参考 [💬 终端按键优化](?session=3f9a12bc)",
  );

  // Unknown session falls back gracefully
  assert.equal(
    replaceSessionDeepLinksWithMarkdown("查看 ?session=99999999-unknown", resolver),
    "查看 [💬 会话 99999999](?session=99999999-unknown)",
  );

  // Already inside a markdown link -> untouched
  assert.equal(
    replaceSessionDeepLinksWithMarkdown("[既有标题](?session=01a1aa7f-30e4)", resolver),
    null,
  );

  // Text without any links -> null
  assert.equal(
    replaceSessionDeepLinksWithMarkdown("普通文本没有任何链接", resolver),
    null,
  );
});

test("only an unmodified primary activation stays in the page", () => {
  assert.equal(isPlainActivation(plain), true);
  for (const change of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { button: 2 },
    { defaultPrevented: true },
  ]) {
    assert.equal(isPlainActivation({ ...plain, ...change }), false, JSON.stringify(change));
  }
});

