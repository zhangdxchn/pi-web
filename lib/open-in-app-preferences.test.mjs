import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { addOpenApp, defaultOpenInAppPreferences, loadOpenInAppPreferences, OPEN_IN_APP_STORAGE_KEY, removeOpenApp, saveOpenInAppPreferences } = await jiti.import("./open-in-app-preferences.ts");

function memory(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (key, next) => { assert.equal(key, OPEN_IN_APP_STORAGE_KEY); value = next; } };
}

test("default is the existing file manager and browser storage is best effort", () => {
  assert.deepEqual(loadOpenInAppPreferences(null), { defaultApp: { kind: "file-manager" }, customApps: [] });
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.deepEqual(loadOpenInAppPreferences(denied), defaultOpenInAppPreferences());
  assert.doesNotThrow(() => saveOpenInAppPreferences(defaultOpenInAppPreferences(), denied));
});

test("saves the selected default and multiple custom applications", () => {
  const storage = memory();
  let value = addOpenApp(defaultOpenInAppPreferences(), { name: " Editor ", path: " /Applications/Editor.app " });
  value = addOpenApp(value, { name: "Other", path: "/Applications/Other.app" });
  value.defaultApp = { kind: "custom", path: "/Applications/Editor.app" };
  saveOpenInAppPreferences(value, storage);
  assert.deepEqual(loadOpenInAppPreferences(storage), value);
  assert.equal(value.customApps.length, 2);
  assert.deepEqual(addOpenApp(value, { name: "Renamed", path: "/Applications/Editor.app" }).customApps, [
    { name: "Other", path: "/Applications/Other.app" }, { name: "Renamed", path: "/Applications/Editor.app" },
  ]);
});

test("removing the default custom application selects the file manager", () => {
  const value = { defaultApp: { kind: "custom", path: "/app" }, customApps: [{ name: "App", path: "/app" }] };
  assert.deepEqual(removeOpenApp(value, "/app"), defaultOpenInAppPreferences());
});

test("invalid storage cannot create an invalid default or duplicate app paths", () => {
  const value = { defaultApp: { kind: "custom", path: "/missing" }, customApps: [{ name: "One", path: "/one" }, { name: "Again", path: "/one" }, null, { name: "", path: "/bad" }] };
  assert.deepEqual(loadOpenInAppPreferences(memory(JSON.stringify(value))), { defaultApp: { kind: "file-manager" }, customApps: [{ name: "One", path: "/one" }] });
  assert.deepEqual(loadOpenInAppPreferences(memory("{")), defaultOpenInAppPreferences());
  assert.deepEqual(loadOpenInAppPreferences(memory(JSON.stringify({ defaultApp: { kind: "vscode" } }))).defaultApp, { kind: "vscode" });
});
