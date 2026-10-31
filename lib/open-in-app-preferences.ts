/** Open-in-app choices belong to the browser on the machine using the UI. */
export const OPEN_IN_APP_STORAGE_KEY = "pi-web:open-in-app";

export type CustomOpenApp = { name: string; path: string };
export type DefaultOpenApp = { kind: "file-manager" } | { kind: "vscode" } | { kind: "custom"; path: string };
export type OpenInAppPreferences = { defaultApp: DefaultOpenApp; customApps: CustomOpenApp[] };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function defaultOpenInAppPreferences(): OpenInAppPreferences {
  return { defaultApp: { kind: "file-manager" }, customApps: [] };
}

export function loadOpenInAppPreferences(storage: StorageLike | null = browserStorage()): OpenInAppPreferences {
  if (!storage) return defaultOpenInAppPreferences();
  try {
    const raw = storage.getItem(OPEN_IN_APP_STORAGE_KEY);
    if (!raw) return defaultOpenInAppPreferences();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultOpenInAppPreferences();
    const value = parsed as Record<string, unknown>;
    const customApps: CustomOpenApp[] = [];
    if (Array.isArray(value.customApps)) {
      for (const item of value.customApps) {
        if (!item || typeof item !== "object") continue;
        const app = item as Record<string, unknown>;
        if (typeof app.name !== "string" || typeof app.path !== "string") continue;
        const name = app.name.trim();
        const path = app.path.trim();
        if (name && path && !customApps.some((existing) => existing.path === path)) customApps.push({ name, path });
      }
    }
    const selected = value.defaultApp;
    let defaultApp: DefaultOpenApp = { kind: "file-manager" };
    if (selected && typeof selected === "object" && !Array.isArray(selected)) {
      const entry = selected as Record<string, unknown>;
      if (entry.kind === "vscode") defaultApp = { kind: "vscode" };
      else if (entry.kind === "custom" && typeof entry.path === "string" && customApps.some((app) => app.path === entry.path)) {
        defaultApp = { kind: "custom", path: entry.path };
      }
    }
    return { defaultApp, customApps };
  } catch {
    return defaultOpenInAppPreferences();
  }
}

export function saveOpenInAppPreferences(value: OpenInAppPreferences, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try { storage.setItem(OPEN_IN_APP_STORAGE_KEY, JSON.stringify(value)); } catch { /* Best effort, as other sidebar preferences. */ }
}

export function addOpenApp(value: OpenInAppPreferences, app: CustomOpenApp): OpenInAppPreferences {
  const name = app.name.trim();
  const path = app.path.trim();
  if (!name || !path) return value;
  return { ...value, customApps: [...value.customApps.filter((existing) => existing.path !== path), { name, path }] };
}

export function removeOpenApp(value: OpenInAppPreferences, path: string): OpenInAppPreferences {
  return {
    customApps: value.customApps.filter((app) => app.path !== path),
    defaultApp: value.defaultApp.kind === "custom" && value.defaultApp.path === path
      ? { kind: "file-manager" }
      : value.defaultApp,
  };
}
