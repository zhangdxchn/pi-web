import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AssistantOutline, countToolCalls, layoutNodes } = await jiti.import("./ChatMinimap.tsx");

test("centers one or many turns in the rail with equal edge padding", () => {
  const nodes = (count) => Array.from({ length: count }, (_, index) => ({ index, topRatio: 0 }));
  assert.deepEqual(layoutNodes([], 600).nodes, []);
  assert.equal(layoutNodes(nodes(1), 600).nodes[0].topRatio, 0.5);
  for (const count of [2, 6, 100]) {
    const { nodes: placed, gap } = layoutNodes(nodes(count), 600);
    const first = placed[0].topRatio * 600;
    const last = placed.at(-1).topRatio * 600;
    assert.ok(Math.abs((first + last) / 2 - 300) < 1e-9);
    assert.ok(first >= 48 && last <= 552);
    assert.ok(gap <= 20);
  }
});

test("renders math in headings without disabling heading navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {},
    }),
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("shows a paragraph excerpt alongside navigable headings", () => {
  const html = renderToStaticMarkup(React.createElement(AssistantOutline, {
    markdown: "## 结论\n\n这是回答摘要。\n\n后续段落。",
    onHeadingClick() {},
    onAnswerClick() {},
  }));
  assert.match(html, /结论/);
  assert.match(html, /这是回答摘要/);
  assert.doesNotMatch(html, /后续段落/);
});

test("counts tool calls per assistant reply, including replies that also answer", () => {
  // A reply can both answer and call tools, so counting text-less messages
  // would undercount this turn.
  assert.equal(countToolCalls({
    role: "assistant",
    content: [
      { type: "text", text: "Let me check that file." },
      { type: "toolCall", toolCallId: "1", toolName: "read", input: {} },
      { type: "toolCall", toolCallId: "2", toolName: "grep", input: {} },
    ],
  }), 2);

  assert.equal(countToolCalls({
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "3", toolName: "bash", input: {} }],
  }), 1);

  assert.equal(countToolCalls({
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
  }), 0);
});

test("counts no tool calls for non-assistant or string-content messages", () => {
  assert.equal(countToolCalls({ role: "user", content: "run the tests" }), 0);
  assert.equal(countToolCalls({ role: "assistant", content: "plain string" }), 0);
  assert.equal(countToolCalls({ role: "assistant" }), 0);
});
