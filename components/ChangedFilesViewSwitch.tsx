"use client";

import type { ChangedFilesLayout } from "@/lib/changed-files-layout";
import { useI18n } from "@/hooks/useI18n";

export function ChangedFilesViewSwitch({ layout, onChange }: { layout: ChangedFilesLayout; onChange: (layout: ChangedFilesLayout) => void }) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("files.changesView")} style={{ display: "inline-flex", flexShrink: 0, padding: 2, gap: 1, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)" }}>
      {(["list", "tree"] as const).map((value) => (
        <button key={value} type="button" aria-pressed={layout === value} onClick={() => onChange(value)}
          style={{ border: 0, borderRadius: 3, padding: "2px 6px", lineHeight: "16px", fontSize: 10.5, cursor: "pointer", background: layout === value ? "var(--bg)" : "transparent", color: layout === value ? "var(--accent)" : "var(--text-muted)", fontWeight: layout === value ? 600 : 400 }}>
          {t(value === "list" ? "files.listView" : "files.treeView")}
        </button>
      ))}
    </div>
  );
}
