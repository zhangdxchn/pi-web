"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { ActivityGroup, ActivityRow } from "@/lib/session-activity";
import type { SessionFamily } from "@/lib/session-family";
import { getVisibleRowIndices, type SidebarLayout } from "@/lib/session-tree";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import { formatShortRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { useScrollbarVisibility } from "@/hooks/useScrollbarVisibility";
import type { SidebarMenuAnchor } from "./SidebarMenu";
import { DeleteConfirm, DELETE_TITLE_MAX, isImeKey, RenameInput, sessionRowTitle } from "./SessionTree";
import { MoreIcon, SpinnerIcon } from "./SidebarIcons";

type ActivitySessionRow = Extract<ActivityRow, { kind: "session" }>;

function anchorOf(button: HTMLElement): SidebarMenuAnchor {
  const rect = button.getBoundingClientRect();
  return { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align: "end" };
}

const GROUP_LABELS: Record<ActivityGroup, string> = {
  priority: "sidebar.activityPriority",
  today: "sidebar.activityToday",
  yesterday: "sidebar.activityYesterday",
  week: "sidebar.activityWeek",
  earlier: "sidebar.activityEarlier",
};
const OVERSCAN_PX = 240;

export function activityRowOffsets(rows: readonly ActivityRow[], layout: SidebarLayout): number[] {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1] + (row.kind === "header"
    ? (layout === "mobile" ? 36 : 28)
    : (layout === "mobile" ? 82 : 68)));
  return offsets;
}

export interface SessionActivityProps {
  rows: ActivityRow[];
  layout: SidebarLayout;
  loading: boolean;
  error: string | null;
  onSelect(row: ActivitySessionRow): void;
  activeMenuRowKey?: string | null;
  renamingRootId?: string | null;
  confirmDeleteRootId?: string | null;
  onOpenRowMenu?(row: ActivitySessionRow, anchor: SidebarMenuAnchor, opener: HTMLElement): void;
  onRowContextMenu?(row: ActivitySessionRow, event: ReactMouseEvent): void;
  onRenameCommit?(family: SessionFamily, value: string): void;
  onRenameCancel?(): void;
  onDeleteConfirm?(family: SessionFamily, event?: { shiftKey?: boolean }): void;
  onDeleteCancel?(): void;
}

/** A chronological, virtualized view of the same session families as the project tree. */
export function SessionActivity({
  rows,
  layout,
  loading,
  error,
  onSelect,
  activeMenuRowKey = null,
  renamingRootId = null,
  confirmDeleteRootId = null,
  onOpenRowMenu,
  onRowContextMenu,
  onRenameCommit,
  onRenameCancel,
  onDeleteConfirm,
  onDeleteCancel,
}: SessionActivityProps) {
  const { locale, t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibility(scrollRef);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      const width = `${Math.max(0, element.offsetWidth - element.clientWidth)}px`;
      element.style.setProperty("--session-tree-scrollbar", width);
      if (element.offsetWidth > 0) element.closest<HTMLElement>(".session-sidebar")?.style.setProperty("--session-tree-scrollbar", width);
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const offsets = useMemo(() => activityRowOffsets(rows, layout), [rows, layout]);
  const focusedIndex = focusedKey ? rows.findIndex((row) => row.key === focusedKey) : -1;
  const pinnedIndices = useMemo(() => {
    const indices: number[] = [];
    if (focusedIndex >= 0) indices.push(focusedIndex);
    rows.forEach((row, index) => {
      if (row.key === activeMenuRowKey) indices.push(index);
      if (row.kind === "session" && (row.family.root.id === renamingRootId || row.family.root.id === confirmDeleteRootId)) {
        indices.push(index);
      }
    });
    return indices;
  }, [rows, focusedIndex, activeMenuRowKey, renamingRootId, confirmDeleteRootId]);
  const visible = useMemo(() => loading ? [] : getVisibleRowIndices(
    offsets, scrollTop, viewportHeight, OVERSCAN_PX, pinnedIndices,
  ), [loading, offsets, scrollTop, viewportHeight, pinnedIndices]);
  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);
  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest("[data-activity-row-key]") : null;
    setFocusedKey(row?.getAttribute("data-activity-row-key") ?? null);
  }, []);
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null);
  }, []);

  return (
    <div className={`session-tree session-activity${layout === "mobile" ? " is-mobile" : ""}`}>
      {loading && <div className="session-tree-message">{t("sidebar.loading")}</div>}
      {error && <div className="session-tree-message is-error">{error}</div>}
      {!loading && !error && rows.length === 0 && <div className="session-tree-message">{t("sidebar.noSessions")}</div>}
      <div ref={scrollRef} className="session-tree-scroll scrollbar-subtle" onScroll={onScroll} onFocus={onFocus} onBlur={onBlur}>
        {!loading && <div className="session-tree-inner" style={{ height: offsets[rows.length] }}>
          {visible.map((index) => {
            const row = rows[index];
            const style = { top: offsets[index], height: offsets[index + 1] - offsets[index] };
            if (row.kind === "header") return <div key={row.key} className="session-tree-row session-activity-header" role="heading" aria-level={2} style={style} data-activity-row-key={row.key}>{t(GROUP_LABELS[row.group])}</div>;
            const title = sessionRowTitle(row.family.root);
            const isConfirming = row.family.root.id === confirmDeleteRootId;
            const isRenaming = row.family.root.id === renamingRootId;
            const menuOpen = row.key === activeMenuRowKey;
            const rowClass = [
              "session-tree-row",
              "session-activity-row",
              row.selected ? "is-selected" : "",
              menuOpen ? "is-menu-open" : "",
              isConfirming ? "is-confirming" : "",
              isRenaming ? "is-renaming" : "",
            ].filter(Boolean).join(" ");

            if (isConfirming && onDeleteConfirm && onDeleteCancel) {
              const shortTitle = title.slice(0, DELETE_TITLE_MAX) + (title.length > DELETE_TITLE_MAX ? "…" : "");
              return (
                <div
                  key={row.key}
                  className={rowClass}
                  style={style}
                  data-activity-row-key={row.key}
                  data-row-key={row.key}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || isImeKey(event)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onDeleteCancel();
                  }}
                >
                  <DeleteConfirm
                    label={t("sidebar.deleteSession", { title: shortTitle })}
                    deleteLabel={t("sidebar.delete")}
                    cancelLabel={t("sidebar.cancel")}
                    onConfirm={(event) => {
                      event.stopPropagation();
                      onDeleteConfirm(row.family, event);
                    }}
                    onCancel={(event) => {
                      event.stopPropagation();
                      onDeleteCancel();
                    }}
                  />
                </div>
              );
            }

            if (isRenaming && onRenameCommit && onRenameCancel) {
              return (
                <div
                  key={row.key}
                  className={rowClass}
                  style={style}
                  data-activity-row-key={row.key}
                  data-row-key={row.key}
                >
                  <RenameInput
                    initialValue={title}
                    label={t("sidebar.rename")}
                    onCommit={(value) => onRenameCommit(row.family, value)}
                    onCancel={() => onRenameCancel()}
                  />
                </div>
              );
            }

            const status = row.awaiting
              ? <span className="session-tree-awaiting" role="img" aria-label={t("sidebar.agentAwaitingInput")} />
              : row.running ? <SpinnerIcon size={12} label={t("sidebar.agentRunning")} />
                : row.unread ? <span className="session-tree-unread" role="img" aria-label={t("sidebar.newSessionActivity")} /> : null;
            const content = <>
              <span className="session-activity-line">
                <span className="session-activity-title">{title}</span>
                <span className="session-activity-project" title={row.family.root.projectRoot ?? row.family.root.cwd}>{row.projectName}</span>
                <span className="session-activity-time">{formatShortRelativeTime(row.family.latestModified, locale, new Date(now))}</span>
                {row.retained && !row.running && !row.awaiting && <span className="session-activity-read">{t("sidebar.read")}</span>}
                {status}
              </span>
              {row.family.root.lastMessagePreview && <span className="session-activity-preview">{row.family.root.lastMessagePreview}</span>}
            </>;
            const select = (event: ReactMouseEvent<HTMLAnchorElement>) => {
              if (!isPlainActivation(event)) return;
              event.preventDefault();
              onSelect(row);
            };
            return <div
              key={row.key}
              className={rowClass}
              style={style}
              data-activity-row-key={row.key}
              data-row-key={row.key}
              onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(row, event) : undefined}
            >
              {row.family.root.transient
                ? <button type="button" className="session-activity-main" aria-current={row.selected ? "true" : undefined} onClick={() => onSelect(row)}>{content}</button>
                : <a className="session-activity-main" href={sessionDeepLink(row.family.root.id)} aria-current={row.selected ? "true" : undefined} onClick={select}>{content}</a>}
              {!row.family.root.transient && onOpenRowMenu && (
                <span className="session-tree-actions">
                  <button
                    type="button"
                    className={`session-tree-action session-tree-more-action${menuOpen ? " is-active" : ""}`}
                    aria-label={t("sidebar.moreActions")}
                    title={t("sidebar.moreActions")}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      const button = event.currentTarget;
                      onOpenRowMenu(row, anchorOf(button), button);
                    }}
                  >
                    <MoreIcon size={14} />
                  </button>
                </span>
              )}
            </div>;
          })}
        </div>}
      </div>
    </div>
  );
}
