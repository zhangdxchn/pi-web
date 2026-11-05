import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SessionLinkPill } = await jiti.import("./SessionLinkPill.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderPill(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SessionLinkPill, props),
    ),
  );
}

test("SessionLinkPill renders link pill with resolved session title", () => {
  const html = renderPill({
    sessionId: "01a1aa7f-30e4-7240-80b2-02bcb03b624b",
    resolveTitle: (id) => (id.startsWith("01a1") ? "修复登录问题" : undefined),
  });

  assert.match(html, /class="session-link-pill"/);
  assert.match(html, /href="\?session=01a1aa7f-30e4-7240-80b2-02bcb03b624b"/);
  assert.match(html, /修复登录问题/);
  assert.match(html, /💬/);
});

test("SessionLinkPill falls back to label or truncated id when title not resolved", () => {
  // Label provided
  const withLabel = renderPill({
    sessionId: "3f9a12bc",
    label: "终端快捷键",
  });
  assert.match(withLabel, /终端快捷键/);

  // No title and raw url as label falls back to session id
  const withoutTitle = renderPill({
    sessionId: "8a7c91e2-b102-4d9f-a2e1",
    label: "http://localhost:30141/?session=8a7c91e2-b102-4d9f-a2e1",
  });
  assert.match(withoutTitle, /Session 8a7c91e2/);
});
