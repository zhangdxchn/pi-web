import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { repairMermaidSyntax } = await createJiti(import.meta.url).import("./mermaid-syntax-repair.ts");

test("quotes only the two supported flowchart syntax errors without inventing IDs", () => {
  const source = [
    "graph TD",
    "  subgraph Original Pi (CLI)",
    "    CLI[Pi CLI / TUI] --> Core[Session]",
    "  end",
    "  subgraph Other Product (Web)",
    "    WebUI[Web UI (ChatView)] --> WS[Protocol]",
    "    WS --> InPi[AgentSession (Pi Core)]",
    "    DB[(Database)] --> InPi",
    "  end",
  ].join("\n");
  const expected = [
    "graph TD",
    '  subgraph "Original Pi (CLI)"',
    "    CLI[Pi CLI / TUI] --> Core[Session]",
    "  end",
    '  subgraph "Other Product (Web)"',
    '    WebUI["Web UI (ChatView)"] --> WS[Protocol]',
    '    WS --> InPi["AgentSession (Pi Core)"]',
    "    DB[(Database)] --> InPi",
    "  end",
  ].join("\n");
  assert.equal(repairMermaidSyntax(source), expected);
});

test("leaves valid shapes and edge labels unchanged while repairing a plain rectangle", () => {
  const source = [
    "flowchart LR",
    "  DB[(Database (prod))] --> Next",
    "  Sub[[Subroutine (x)]] --> Next",
    "  Para[/Parallelogram (x)/] --> Next",
    "  Round(Outer --> X[not (a) node]) --> Next",
    "  A -->|Text B[not (a) node]| Next",
    '  Quoted["Already (quoted)"] --> Next',
    "  Broken[Web UI (ChatView)] --> Next",
  ].join("\n");
  const expected = [
    "flowchart LR",
    "  DB[(Database (prod))] --> Next",
    "  Sub[[Subroutine (x)]] --> Next",
    "  Para[/Parallelogram (x)/] --> Next",
    "  Round(Outer --> X[not (a) node]) --> Next",
    "  A -->|Text B[not (a) node]| Next",
    '  Quoted["Already (quoted)"] --> Next',
    '  Broken["Web UI (ChatView)"] --> Next',
  ].join("\n");
  assert.equal(repairMermaidSyntax(source), expected);
});

test("does not quote node-like text inside an asymmetric shape", () => {
  const source = "graph TD\n  A>Outer --> X[not (a) node]]\n  B >Outer --> Y[not (a) node]]\n  Broken[Web UI (ChatView)]";
  const expected = 'graph TD\n  A>Outer --> X[not (a) node]]\n  B >Outer --> Y[not (a) node]]\n  Broken["Web UI (ChatView)"]';
  assert.equal(repairMermaidSyntax(source), expected);
});

test("preserves frontmatter, comments, quoted text and CRLF while repairing another line", () => {
  const source = [
    "---",
    "title: Documentation",
    "---",
    "%% A[Comment (untouched)]",
    "graph TD",
    '  A["quoted',
    "  Fake[Still (quoted)]",
    '  text"] --> B',
    "  Broken[Web UI (ChatView)] --> B",
    "  C[Ignore (comment)] %% trailing comment",
  ].join("\r\n");
  const expected = [
    "---",
    "title: Documentation",
    "---",
    "%% A[Comment (untouched)]",
    "graph TD",
    '  A["quoted',
    "  Fake[Still (quoted)]",
    '  text"] --> B',
    '  Broken["Web UI (ChatView)"] --> B',
    "  C[Ignore (comment)] %% trailing comment",
  ].join("\r\n");
  assert.equal(repairMermaidSyntax(source), expected);
});

test("ignores unsupported diagram types, directives and ambiguous labels", () => {
  const inputs = [
    "sequenceDiagram\n A->>B: Node[do (x)]",
    "erDiagram\n A ||--o{ B : Node[do (x)]",
    "%%{init: {}}%%\ngraph TD\n A[do (x)]",
    "---\ntitle: unfinished\ngraph TD\n A[do (x)]",
    'graph TD\n A["Already (quoted)"] --> B[(Database)]',
    "graph TD\n A[Contains <br> (HTML)]",
    "graph TD\n A[Has [nested] (text)]",
    "graph TD\n A[Unbalanced (text]",
  ];
  for (const source of inputs) assert.equal(repairMermaidSyntax(source), null, source);
});

test("does not guess a subgraph ID when its title or a generated ID is referenced", () => {
  const namedReference = "graph TD\n  subgraph Group Name (UI)\n    A --> B\n  end\n  Group --> C";
  const generatedReference = "graph TD\n  subgraph Other Name (UI)\n    A --> B\n  end\n  subGraph0 --> C";
  assert.equal(repairMermaidSyntax(namedReference), null);
  assert.equal(repairMermaidSyntax(generatedReference), null);
});
