import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const handleTerminalClosed =");
const end = source.indexOf("  // One session, one chat:", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const callbacks = source.slice(start, end);

function closeTab({ kind, active = true, graph = true }) {
  const ids = { file: "file:/project/file.txt", agent: "agent:one", terminal: "terminal:one" };
  const id = ids[kind];
  const state = { selected: active ? id : "git-graph", panelOpen: true, graphOpen: graph };
  const context = vm.createContext({
    fileTabs: kind === "file" ? [{ id }] : [],
    terminalTabs: kind === "terminal" ? [{ id, cwd: "/project" }] : [],
    agentTabs: kind === "agent" ? [{ sessionId: "one" }] : [],
    gitGraphOpen: graph,
    activeCwd: "/project",
    useCallback: (callback) => callback,
    lastAgentTabId: (tabs) => tabs.length ? `agent:${tabs.at(-1).sessionId}` : null,
    newTerminalTab: () => { throw new Error("unexpected restart"); },
    setFileTabs: (update) => { context.fileTabs = typeof update === "function" ? update(context.fileTabs) : update; },
    setTerminalTabs: (update) => { context.terminalTabs = typeof update === "function" ? update(context.terminalTabs) : update; },
    setAgentTabs: (update) => { context.agentTabs = typeof update === "function" ? update(context.agentTabs) : update; },
    setGitGraphOpen: (value) => { state.graphOpen = value; },
    setActiveFileTabId: (update) => { state.selected = update(state.selected); },
    setRightPanelOpen: (value) => { state.panelOpen = value; },
  });
  const action = kind === "terminal" ? `handleTerminalClosed({ id: ${JSON.stringify(id)} })` : `handleCloseFileTab(${JSON.stringify(id)})`;
  vm.runInContext(stripTypeScriptTypes(`${callbacks}\n${action};`), context);
  return state;
}

for (const kind of ["file", "agent", "terminal"]) {
  test(`closing the last active ${kind} selects the remaining Git Graph`, () => {
    const state = closeTab({ kind });
    assert.equal(state.selected, "git-graph");
    assert.equal(state.panelOpen, true);
    assert.equal(state.graphOpen, true);
  });

  test(`closing an inactive ${kind} keeps the selected Git Graph visible`, () => {
    const state = closeTab({ kind, active: false });
    assert.equal(state.selected, "git-graph");
    assert.equal(state.panelOpen, true);
  });

  test(`closing the last ${kind} without a graph still closes the panel`, () => {
    const state = closeTab({ kind, graph: false });
    assert.equal(state.selected, null);
    assert.equal(state.panelOpen, false);
  });
}
