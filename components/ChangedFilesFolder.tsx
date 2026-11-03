"use client";

import { FolderIcon } from "./FileIcons";

/** A disclosure row, not a filesystem listing: its children are changed files. */
export function ChangedFilesFolder({ name, path, depth, expanded, onToggle, height = "var(--file-row-height)" }: {
  name: string; path: string; depth: number; expanded: boolean; onToggle: () => void; height?: number | string;
}) {
  return (
    <button type="button" aria-expanded={expanded} title={path} onClick={onToggle}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
      style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", minWidth: 0, height, paddingLeft: 8 + depth * 14, paddingRight: 8, border: 0, borderRadius: 4, background: "transparent", color: "var(--text)", textAlign: "left", cursor: "pointer" }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none" }}>
        <polyline points="3 2 7 5 3 8" />
      </svg>
      <FolderIcon size={14} open={expanded} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{name}</span>
    </button>
  );
}
