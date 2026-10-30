"use client";

import { useEffect, useState } from "react";
import type { GitCommitDetail, GitGraphCommit } from "@/lib/git-types";
import { formatCommitDate } from "@/lib/git-graph-model";
import { getFileIcon } from "../FileIcons";

interface GitGraphDetailsProps {
  cwd: string;
  commit: GitGraphCommit;
  height: number;
  onHeightChange: (h: number) => void;
  onClose: () => void;
  onSelectSha?: (sha: string) => void;
  onOpenFileDiff?: (filePath: string, sha: string) => void;
}

export function GitGraphDetails({
  cwd,
  commit,
  height,
  onHeightChange,
  onClose,
  onSelectSha,
  onOpenFileDiff,
}: GitGraphDetailsProps) {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedSha, setCopiedSha] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetail(null);

    const params = new URLSearchParams({ cwd, sha: commit.sha });
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
  }, [cwd, commit.sha]);

  const handleCopySha = () => {
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
              {commit.subject}
            </span>
            <button
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
              {copiedSha ? "已复制 ✓" : commit.shortSha}
            </button>
          </div>

          <div
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
                <span>父提交:</span>
                {commit.parents.map((p) => {
                  const short = p.slice(0, 7);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onSelectSha?.(p)}
                      title={`跳转至父提交 ${p}`}
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
                <span>父提交: <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>(根提交 · 无父提交)</span></span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="关闭详情"
          aria-label="关闭详情"
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
        {loading ? (
          <div style={{ padding: "12px 0", fontSize: 11, color: "var(--text-dim)" }}>
            正在加载文件变更…
          </div>
        ) : !detail || detail.files.length === 0 ? (
          <div style={{ padding: "12px 0", fontSize: 11, color: "var(--text-dim)" }}>
            该提交无文件变更
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              {detail.files.length} 个变更文件:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {detail.files.map((file) => {
                const name = file.filePath.split("/").pop() || file.filePath;
                return (
                  <div
                    key={file.filePath}
                    onClick={() => onOpenFileDiff?.(file.filePath, commit.sha)}
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
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          display: "flex",
                          gap: 4,
                        }}
                      >
                        {file.additions > 0 && (
                          <span style={{ color: "#22c55e" }}>+{file.additions}</span>
                        )}
                        {file.deletions > 0 && (
                          <span style={{ color: "#ef4444" }}>-{file.deletions}</span>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--accent)" }}>
                        查看 Diff ↗
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
