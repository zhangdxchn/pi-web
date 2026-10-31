"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { GitCommitDetail, GitFileStatus, GitGraphCommit } from "@/lib/git-types";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { formatCommitDate } from "@/lib/git-graph-model";
import { getFileIcon } from "../FileIcons";
import { ChangedFilesFolder } from "../ChangedFilesFolder";
import { ChangedFilesViewSwitch } from "../ChangedFilesViewSwitch";
import { buildChangedFilesTree, visibleChangedFileRows } from "@/lib/changed-files-tree";
import type { ChangedFilesLayout } from "@/lib/changed-files-layout";
import { useChangedFilesLayout } from "@/hooks/useChangedFilesLayout";
import { useI18n } from "@/hooks/useI18n";

interface GitGraphDetailsCommonProps {
  cwd: string;
  height: number;
  onHeightChange: (h: number) => void;
  onClose: () => void;
}

type GitGraphDetailsProps = GitGraphDetailsCommonProps & (
  | { kind: "commit"; commit: GitGraphCommit; onSelectSha?: (sha: string) => void; onOpenFileDiff?: (filePath: string, sha: string) => void }
  | { kind: "working"; files: GitFileStatus[]; onOpenWorkingFile?: (filePath: string) => void }
);

function LineStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, display: "flex", gap: 4, flexShrink: 0 }}>
      {additions > 0 && <span style={{ color: "#22c55e" }}>+{additions}</span>}
      {deletions > 0 && <span style={{ color: "#ef4444" }}>-{deletions}</span>}
    </span>
  );
}

const FILE_ROW_HEIGHT = 28;
const FILE_ROW_GAP = 3;
const FILE_ROW_STEP = FILE_ROW_HEIGHT + FILE_ROW_GAP;
const FILE_OVERSCAN = 10;

/** Both working-tree and commit details share the drawer's scrollport. */
function VirtualFileList<T extends { filePath: string }>({ files, scrollRef, renderFile }: {
  files: T[];
  scrollRef: RefObject<HTMLDivElement | null>;
  renderFile: (file: T) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 500 });
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const focusedIndex = useMemo(() => focusedPath === null ? -1 : files.findIndex((file) => file.filePath === focusedPath), [files, focusedPath]);

  useEffect(() => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll || !list) return;
    const sync = () => {
      // The file count sits above the list in the positioned scrollport.
      const top = Math.max(0, scroll.scrollTop - list.offsetTop);
      const height = scroll.clientHeight || 500;
      setViewport((current) => current.top === top && current.height === height ? current : { top, height });
    };
    sync();
    scroll.addEventListener("scroll", sync, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(scroll);
    return () => { scroll.removeEventListener("scroll", sync); observer?.disconnect(); };
  }, [scrollRef]);

  const top = Math.min(viewport.top, Math.max(0, files.length * FILE_ROW_STEP - viewport.height));
  const start = Math.max(0, Math.floor(top / FILE_ROW_STEP) - FILE_OVERSCAN);
  const end = Math.min(files.length, Math.ceil((top + viewport.height) / FILE_ROW_STEP) + FILE_OVERSCAN);
  const indices: number[] = [];
  // Keep focus when the user scrolls a working-file button out of view.
  if (focusedIndex >= 0 && focusedIndex < start) indices.push(focusedIndex);
  for (let index = start; index < end; index++) indices.push(index);
  if (focusedIndex >= end) indices.push(focusedIndex);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-file-index="${pendingFocus.current}"] button`);
    if (button) { pendingFocus.current = null; button.focus({ preventScroll: true }); }
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-file-index]") : null;
    if (!row) return;
    const index = Number(row.dataset.fileIndex);
    const next = index + (event.shiftKey ? -1 : 1);
    // Native Tab handles mounted neighbours; reveal an unmounted neighbour first.
    if (next < 0 || next >= files.length || (next >= start && next < end)) return;
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll || !list) return;
    event.preventDefault();
    const rowTop = list.offsetTop + next * FILE_ROW_STEP;
    if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop;
    else if (rowTop + FILE_ROW_HEIGHT > scroll.scrollTop + scroll.clientHeight) {
      scroll.scrollTop = rowTop + FILE_ROW_HEIGHT - scroll.clientHeight;
    }
    pendingFocus.current = next;
    setViewport({ top: Math.max(0, scroll.scrollTop - list.offsetTop), height: scroll.clientHeight || 500 });
  };

  return (
    <div ref={listRef} role="list" data-testid="git-graph-file-list"
      onFocus={(event) => {
        const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-file-index]") : null;
        if (row) setFocusedPath(files[Number(row.dataset.fileIndex)]?.filePath ?? null);
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedPath(null); }}
      onKeyDown={handleKeyDown}
      style={{ position: "relative", height: Math.max(0, files.length * FILE_ROW_STEP - FILE_ROW_GAP) }}>
      {indices.map((index) => (
        <div key={files[index].filePath} role="listitem" aria-posinset={index + 1} aria-setsize={files.length} data-file-index={index}
          style={{ position: "absolute", top: index * FILE_ROW_STEP, left: 0, right: 0, height: FILE_ROW_HEIGHT }}>
          {renderFile(files[index])}
        </div>
      ))}
    </div>
  );
}

/** Keep the same virtual scrollport for list rows and visible tree rows. */
function GraphChangedFileList<T extends { filePath: string }>({ files, layout, cwd, scrollRef, renderFile }: {
  files: T[];
  layout: ChangedFilesLayout;
  /** Working files are absolute; commit paths are already repository-relative. */
  cwd?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  renderFile: (file: T, depth?: number) => ReactNode;
}) {
  const [folders, setFolders] = useState<Map<string, boolean>>(() => new Map());
  const tree = useMemo(() => layout === "tree"
    ? buildChangedFilesTree(files, (file) => cwd ? getRelativeFilePath(file.filePath, cwd) : file.filePath)
    : null, [cwd, files, layout]);
  const rows = useMemo(() => tree ? visibleChangedFileRows(tree, folders) : [], [tree, folders]);

  return layout === "list" ? (
    <VirtualFileList files={files} scrollRef={scrollRef} renderFile={(file) => renderFile(file)} />
  ) : (
    <VirtualFileList files={rows} scrollRef={scrollRef} renderFile={(row) => row.kind === "folder" ? (
      <ChangedFilesFolder name={row.name} path={row.path} depth={row.depth} expanded={row.expanded} height={FILE_ROW_HEIGHT}
        onToggle={() => setFolders((previous) => new Map(previous).set(row.path, !row.expanded))} />
    ) : renderFile(row.file, row.depth)} />
  );
}

export function GitGraphDetails(props: GitGraphDetailsProps) {
  const { cwd, height, onHeightChange, onClose } = props;
  const commit = props.kind === "commit" ? props.commit : null;
  const commitSha = commit?.sha;
  const { t } = useI18n();
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedSha, setCopiedSha] = useState(false);
  const [workingLayout, setWorkingLayout] = useChangedFilesLayout("working");
  const [commitLayout, setCommitLayout] = useChangedFilesLayout("commit");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!commitSha) return;
    let active = true;
    setLoading(true);
    setDetail(null);

    const params = new URLSearchParams({ cwd, sha: commitSha });
    fetch(`/api/git/graph?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load commit detail");
        return res.json() as Promise<GitCommitDetail>;
      })
      .then((data) => {
        if (active) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setDetail(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [cwd, commitSha]);

  const handleCopySha = () => {
    if (!commit) return;
    void navigator.clipboard.writeText(commit.sha);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 1500);
  };

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextH = Math.max(120, Math.min(500, Math.round(startH + delta)));
      onHeightChange(nextH);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div
      style={{
        height,
        minHeight: 120,
        maxHeight: 500,
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {/* Top Resizer Handle */}
      <div
        onPointerDown={handleResizeStart}
        style={{
          position: "absolute",
          top: -3,
          left: 0,
          right: 0,
          height: 6,
          cursor: "row-resize",
          zIndex: 10,
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              {commit ? commit.subject : t("gitGraph.uncommittedChanges", { count: props.kind === "working" ? props.files.length : 0 })}
            </span>
            {commit && <button
              type="button"
              onClick={handleCopySha}
              title={commit.sha}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "1px 6px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {copiedSha ? `${t("i18n.copied")} ✓` : commit.shortSha}
            </button>}
          </div>

          {commit && <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--text-dim)",
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            <span>
              <strong style={{ color: "var(--text)" }}>{commit.author}</strong>
              {commit.authorEmail ? ` (${commit.authorEmail})` : ""}
            </span>
            <span>•</span>
            <span title={commit.committedAt}>{formatCommitDate(commit.committedAt)}</span>
            {commit.parents.length > 0 ? (
              <>
                <span>•</span>
                <span>{t("gitGraph.parents")}</span>
                {commit.parents.map((p) => {
                  const short = p.slice(0, 7);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { if (props.kind === "commit") props.onSelectSha?.(p); }}
                      title={t("gitGraph.goToParent", { sha: p })}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        padding: "0 5px",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 3,
                        color: "var(--accent)",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {short}
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <span>•</span>
                <span>{t("gitGraph.parents")} <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{t("gitGraph.rootCommit")}</span></span>
              </>
            )}
          </div>}
        </div>

        <button
          type="button"
          onClick={onClose}
          title={t("gitGraph.closeDetails")}
          aria-label={t("gitGraph.closeDetails")}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content Area */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "6px 12px", position: "relative" }}>
        {props.kind === "working" ? (
          <div data-testid="git-graph-working-details">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              <span>{t("gitGraph.changedFiles", { count: props.files.length })}</span>
              <ChangedFilesViewSwitch layout={workingLayout} onChange={setWorkingLayout} />
            </div>
            <GraphChangedFileList key={`${cwd}:working`} files={props.files} layout={workingLayout} cwd={cwd} scrollRef={scrollRef} renderFile={(file, depth) => (
                <button key={file.filePath} type="button" onClick={() => props.onOpenWorkingFile?.(file.filePath)}
                  title={file.filePath}
                  onMouseEnter={(event) => { if (depth !== undefined) event.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(event) => { if (depth !== undefined) event.currentTarget.style.background = "transparent"; }}
                  style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", height: "100%", boxSizing: "border-box", padding: "4px 8px", paddingLeft: depth === undefined ? 8 : 22 + depth * 14, borderRadius: 4, background: depth === undefined ? "var(--bg)" : "transparent", border: depth === undefined ? "1px solid var(--border)" : "1px solid transparent", color: "var(--text)", fontSize: 11.5, cursor: "pointer", textAlign: "left" }}>
                  {depth === undefined && <span title={t(`files.${file.status}`)} aria-label={t(`files.${file.status}`)} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", width: 14, flexShrink: 0 }}>{file.code}</span>}
                  <span style={{ display: "flex", flexShrink: 0, opacity: 0.85 }}>{getFileIcon(getFileName(file.filePath), 13)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{depth === undefined ? getRelativeFilePath(file.filePath, cwd) : getFileName(file.filePath)}</span>
                  {depth !== undefined && <span title={t(`files.${file.status}`)} aria-label={t(`files.${file.status}`)} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", width: 14, flexShrink: 0 }}>{file.code}</span>}
                  <LineStats additions={file.additions} deletions={file.deletions} />
                  <span style={{ fontSize: 10, color: "var(--accent)", flexShrink: 0 }}>{t("gitGraph.viewDiff")} ↗</span>
                </button>
              )} />
          </div>
        ) : loading ? (
          <div style={{ padding: "12px 0", fontSize: 11, color: "var(--text-dim)" }}>
            {t("gitGraph.loadingChanges")}
          </div>
        ) : !detail || detail.files.length === 0 ? (
          <div style={{ padding: "12px 0", fontSize: 11, color: "var(--text-dim)" }}>
            {t("gitGraph.noFileChanges")}
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              <span>{t("gitGraph.changedFiles", { count: detail.files.length })}</span>
              <ChangedFilesViewSwitch layout={commitLayout} onChange={setCommitLayout} />
            </div>
            <GraphChangedFileList key={`${cwd}:commit:${commitSha}`} files={detail.files} layout={commitLayout} scrollRef={scrollRef} renderFile={(file, depth) => {
                const name = getFileName(file.filePath);
                return (
                  <button
                    key={file.filePath}
                    type="button"
                    onClick={() => { if (props.kind === "commit") props.onOpenFileDiff?.(file.filePath, props.commit.sha); }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", height: "100%", boxSizing: "border-box", padding: "4px 8px", paddingLeft: depth === undefined ? 8 : 22 + depth * 14, borderRadius: 4, background: depth === undefined ? "var(--bg)" : "transparent", border: depth === undefined ? "1px solid var(--border)" : "1px solid transparent", color: "var(--text)", fontSize: 11.5, cursor: "pointer", textAlign: "left", gap: 8 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = depth === undefined ? "var(--bg)" : "transparent"; }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ opacity: 0.85, display: "flex", alignItems: "center" }}>{getFileIcon(name, 13)}</span>
                      <span title={file.filePath} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{depth === undefined ? file.filePath : name}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <LineStats additions={file.additions} deletions={file.deletions} />
                      <span style={{ fontSize: 10, color: "var(--accent)" }}>{t("gitGraph.viewDiff")} ↗</span>
                    </span>
                  </button>
                );
              }} />
          </div>
        )}
      </div>
    </div>
  );
}
