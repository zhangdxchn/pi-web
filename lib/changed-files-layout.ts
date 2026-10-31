export type ChangedFilesLayout = "list" | "tree";
export type ChangedFilesSurface = "sidebar" | "working" | "commit";

const KEYS: Record<ChangedFilesSurface, string> = {
  sidebar: "pi-web:changes-layout-sidebar",
  working: "pi-web:changes-layout-working",
  commit: "pi-web:changes-layout-commit",
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function loadChangedFilesLayout(surface: ChangedFilesSurface, storage: StorageLike | null = browserStorage()): ChangedFilesLayout {
  try { return storage?.getItem(KEYS[surface]) === "tree" ? "tree" : "list"; } catch { return "list"; }
}

export function saveChangedFilesLayout(surface: ChangedFilesSurface, layout: ChangedFilesLayout, storage: StorageLike | null = browserStorage()): void {
  try { storage?.setItem(KEYS[surface], layout); } catch { /* The in-page choice still works. */ }
}
