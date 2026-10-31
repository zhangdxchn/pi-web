"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  addOpenApp,
  defaultOpenInAppPreferences,
  loadOpenInAppPreferences,
  OPEN_IN_APP_STORAGE_KEY,
  removeOpenApp,
  saveOpenInAppPreferences,
  type DefaultOpenApp,
  type OpenInAppPreferences,
} from "@/lib/open-in-app-preferences";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { FolderIcon, PlusIcon, TrashIcon } from "./SidebarIcons";

type Availability = { supported: boolean; reason: string | null; platform: string; vscodeAvailable: boolean };
type MenuState = { anchor: SidebarMenuAnchor; opener: HTMLButtonElement; body: "list" | "add" | "remove" };

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2.5 14.9 8.6 21.5 9.4 16.6 13.9 17.9 20.5 12 17.2 6.1 20.5 7.4 13.9 2.5 9.4 9.1 8.6" />
    </svg>
  );
}

/** The files' existing folder key: choose on click, open the default on a desktop double click. */
export function OpenInAppButton({ cwd, mobile, iconSize, onError }: {
  cwd: string | null;
  mobile: boolean;
  iconSize: number;
  onError: (error: string | null) => void;
}) {
  const { t } = useI18n();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [preferences, setPreferences] = useState<OpenInAppPreferences>(defaultOpenInAppPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => res.ok ? res.json() as Promise<Availability> : null)
      .then((result) => { if (!cancelled && result) setAvailability(result); })
      .catch(() => {});
    setPreferences(loadOpenInAppPreferences());
    const onStorage = (event: StorageEvent) => {
      if (event.key === OPEN_IN_APP_STORAGE_KEY || event.key === null) setPreferences(loadOpenInAppPreferences());
    };
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; window.removeEventListener("storage", onStorage); };
  }, []);

  function changePreferences(next: OpenInAppPreferences) {
    preferencesRef.current = next;
    setPreferences(next);
    saveOpenInAppPreferences(next);
  }

  async function open(app: DefaultOpenApp) {
    if (!cwd) return;
    try {
      const response = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, ...(app.kind === "file-manager" ? {} : { application: app }) }),
      });
      if (response.ok) { onError(null); return; }
      const result = await response.json().catch(() => ({})) as { error?: string };
      onError(result.error ?? `HTTP ${response.status}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  function openMenu(button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    setMenu({ anchor: { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align: "start" }, opener: button, body: "list" });
  }

  function setBody(body: MenuState["body"]) {
    setMenu((current) => current ? { ...current, body } : null);
  }

  function addApplication() {
    if (!name.trim() || !path.trim()) return;
    changePreferences(addOpenApp(preferencesRef.current, { name, path }));
    setName("");
    setPath("");
    setBody("list");
  }

  function fieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      addApplication();
    }
  }

  const managerLabel = t(availability?.platform === "darwin" ? "sidebar.openInFinder" : availability?.platform === "win32" ? "sidebar.openInExplorer" : "sidebar.openInFileManager");
  const selected = preferences.defaultApp;
  const selectedName = selected.kind === "file-manager" ? managerLabel
    : selected.kind === "vscode" ? "Visual Studio Code"
      : preferences.customApps.find((app) => app.path === selected.path)?.name ?? selected.path;
  const unavailable = availability?.supported === false;
  const title = unavailable
    ? t(availability?.reason === "remote" ? "sidebar.openInExplorerRemoteOnly" : "sidebar.openInExplorerUnsupported")
    : t("sidebar.openAppHint", { app: selectedName });

  function appItem(id: string, label: string, app: DefaultOpenApp, isDefault: boolean, disabled = false): SidebarMenuItem {
    return {
      type: "item", id, label, disabled,
      ...(disabled ? { disabledReason: t("sidebar.openAppUnavailable") } : {}),
      ...(isDefault ? { note: t("sidebar.openAppDefault") } : {}),
      onSelect: () => { void open(app); },
      secondary: {
        label: isDefault ? t("sidebar.openAppIsDefault", { app: label }) : t("sidebar.openAppSetDefault", { app: label }),
        icon: <Star filled={isDefault} />,
        disabled,
        onSelect: (event) => {
          event.keepOpen();
          changePreferences({ ...preferencesRef.current, defaultApp: app });
        },
      },
    };
  }

  const items: SidebarMenuItem[] = menu?.body === "remove"
    ? [
        { type: "header", id: "remove-header", label: t("sidebar.openAppRemoveTitle") },
        ...preferences.customApps.map((app): SidebarMenuItem => ({
          type: "item", id: `remove:${app.path}`, label: app.name, title: app.path, icon: <TrashIcon size={13} />, danger: true,
          onSelect: (event) => { event.keepOpen(); changePreferences(removeOpenApp(preferencesRef.current, app.path)); setBody("list"); },
        })),
        { type: "separator", id: "remove-separator" },
        { type: "item", id: "back", label: t("sidebar.openAppBack"), onSelect: (event) => { event.keepOpen(); setBody("list"); } },
      ]
    : [
        ...(mobile ? [] : [{ type: "header" as const, id: "heading", label: t("sidebar.openProjectIn") }]),
        appItem("file-manager", managerLabel, { kind: "file-manager" }, selected.kind === "file-manager"),
        appItem("vscode", "Visual Studio Code", { kind: "vscode" }, selected.kind === "vscode", availability?.vscodeAvailable === false),
        ...preferences.customApps.map((app) => appItem(`custom:${app.path}`, app.name, { kind: "custom", path: app.path }, selected.kind === "custom" && selected.path === app.path)),
        { type: "separator", id: "apps-separator" },
        { type: "item", id: "add", label: t("sidebar.openAppAdd"), icon: <PlusIcon size={13} />, onSelect: (event) => { event.keepOpen(); setBody("add"); } },
        ...(preferences.customApps.length ? [{ type: "item" as const, id: "remove", label: t("sidebar.openAppRemove"), icon: <TrashIcon size={13} />, onSelect: (event: { keepOpen(): void }) => { event.keepOpen(); setBody("remove"); } }] : []),
        { type: "custom", id: "hint", content: <div className="open-in-app-hint">{t(mobile ? "sidebar.openAppMenuHintTouch" : "sidebar.openAppMenuHint")}</div> },
      ];

  const placeholder = availability?.platform === "win32" ? "C:\\Program Files\\Example\\App.exe"
    : availability?.platform === "linux" ? "/usr/bin/example" : "/Applications/Example.app";

  return (
    <>
      <button
        type="button"
        className={`sidebar-tool-button${menu ? " is-active" : ""}`}
        disabled={!cwd || unavailable}
        title={title}
        aria-label={unavailable ? title : t("sidebar.openProjectIn")}
        aria-haspopup={mobile ? "dialog" : "menu"}
        aria-expanded={menu !== null}
        onClick={(event) => {
          if (event.detail > 1) return;
          openMenu(event.currentTarget);
        }}
        onDoubleClick={() => {
          setMenu(null);
          void open(preferencesRef.current.defaultApp);
        }}
      >
        <FolderIcon size={iconSize} />
      </button>
      <SidebarMenu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        sheet={mobile}
        ariaLabel={t("sidebar.openProjectIn")}
        title={t("sidebar.openProjectIn")}
        items={items}
        cancelLabel={t("sidebar.cancel")}
        returnFocusTo={menu?.opener}
        onClose={() => setMenu(null)}
        focusKey={menu?.body}
        width={260}
      >
        {menu?.body === "add" ? (
          <div className="sidebar-worktree-form open-in-app-form">
            <div className="sidebar-menu-header">{t("sidebar.openAppAdd")}</div>
            <label className="open-in-app-label">{t("sidebar.openAppName")}
              <input className="sidebar-worktree-input" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={fieldKeyDown} {...(!mobile ? { "data-sidebar-menu-autofocus": "" } : {})} />
            </label>
            <label className="open-in-app-label">{t("sidebar.openAppPath")}
              <input className="sidebar-worktree-input" value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={fieldKeyDown} placeholder={placeholder} />
            </label>
            <div className="sidebar-worktree-message">{t("sidebar.openAppPathHelp")}</div>
            <div className="sidebar-worktree-form-buttons">
              <button type="button" className="sidebar-worktree-cancel" onClick={() => setBody("list")}>{t("sidebar.cancel")}</button>
              <button type="button" className="sidebar-worktree-create" disabled={!name.trim() || !path.trim()} onClick={addApplication}>{t("sidebar.openAppAddButton")}</button>
            </div>
          </div>
        ) : null}
      </SidebarMenu>
    </>
  );
}
