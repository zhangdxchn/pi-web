import assert from "node:assert/strict";
import test from "node:test";
import { loadChangedFilesLayout, saveChangedFilesLayout } from "./changed-files-layout.ts";

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("three changed-file surfaces have independent browser preferences", () => {
  const store = storage();
  for (const surface of ["sidebar", "working", "commit"]) assert.equal(loadChangedFilesLayout(surface, store), "list");
  saveChangedFilesLayout("sidebar", "tree", store);
  assert.equal(loadChangedFilesLayout("sidebar", store), "tree");
  assert.equal(loadChangedFilesLayout("working", store), "list");
  assert.equal(loadChangedFilesLayout("commit", store), "list");
  saveChangedFilesLayout("working", "tree", store);
  saveChangedFilesLayout("commit", "list", store);
  assert.deepEqual(Object.fromEntries(store.values), {
    "pi-web:changes-layout-sidebar": "tree",
    "pi-web:changes-layout-working": "tree",
    "pi-web:changes-layout-commit": "list",
  });
  saveChangedFilesLayout("working", "list", store);
  assert.equal(loadChangedFilesLayout("sidebar", store), "tree");
  assert.equal(loadChangedFilesLayout("commit", store), "list");
});

test("missing, invalid and inaccessible storage use List without preventing writes", () => {
  const store = storage();
  store.setItem("pi-web:changes-layout-sidebar", "invalid");
  assert.equal(loadChangedFilesLayout("sidebar", store), "list");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(loadChangedFilesLayout("working", blocked), "list");
  assert.doesNotThrow(() => saveChangedFilesLayout("working", "tree", blocked));
  assert.equal(loadChangedFilesLayout("commit", null), "list");
});
