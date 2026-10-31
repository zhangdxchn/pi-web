"use client";

import { useEffect, useState } from "react";
import type { GitCommitDetail, GitFileStatus, GitGraphCommit } from "@/lib/git-types";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { formatCommitDate } from "@/lib/git-graph-model";
import { getFileIcon } from "../FileIcons";
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

export function GitGraphDetails(props: GitGraphDetailsProps) {
  const { cwd, height, onHeightChange, onClose } = props;
  const commit = props.kind === "commit" ? props.commit : null;
  const commitSha = commit?.sha;
  const { t } = useI18n();
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedSha, setCopiedSha] = useState(false);

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
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 12px" }}>
        {props.kind === "working" ? (
          <div data-testid="git-graph-working-details">
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              {t("gitGraph.changedFiles", { count: props.files.length })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {props.files.map((file) => (
                <button key={file.filePath} type="button" onClick={() => props.onOpenWorkingFile?.(file.filePath)}
                  title={file.filePath}
                  style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11.5, cursor: "pointer", textAlign: "left" }}>
                  <span title={t(`files.${file.status}`)} aria-label={t(`files.${file.status}`)} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", width: 14, flexShrink: 0 }}>{file.code}</span>
                  <span style={{ display: "flex", flexShrink: 0, opacity: 0.85 }}>{getFileIcon(getFileName(file.filePath), 13)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{getRelativeFilePath(file.filePath, cwd)}</span>
                  <LineStats additions={file.additions} deletions={file.deletions} />
                  <span style={{ fontSize: 10, color: "var(--accent)", flexShrink: 0 }}>{t("gitGraph.viewDiff")} ↗</span>
                </button>
              ))}
            </div>
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
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              {t("gitGraph.changedFiles", { count: detail.files.length })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {detail.files.map((file) => {
                const name = file.filePath.split("/").pop() || file.filePath;
                return (
                  <div
                    key={file.filePath}
                    onClick={() => { if (props.kind === "commit") props.onOpenFileDiff?.(file.filePath, props.commit.sha); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      fontSize: 11.5,
                      cursor: "pointer",
                      gap: 8,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--bg)";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ opacity: 0.85, display: "flex", alignItems: "center" }}>
                        {getFileIcon(name, 13)}
                      </span>
                      <span
                        title={file.filePath}
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--text)",
                        }}
                      >
                        {file.filePath}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <LineStats additions={file.additions} deletions={file.deletions} />
                      <span style={{ fontSize: 10, color: "var(--accent)" }}>
                        {t("gitGraph.viewDiff")} ↗
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
