"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GitGraphCommit, GitGraphData, GitGraphRef } from "@/lib/git-types";
import {
  computeGraphRows,
  GRAPH_LANE_WIDTH,
  GRAPH_ROW_HEIGHT,
} from "@/lib/git-graph-model";
import { GitGraphRowSvg } from "./GitGraphRowSvg";
import { GitGraphDetails } from "./GitGraphDetails";
import { useIsMobile } from "@/hooks/useIsMobile";

interface GitGraphViewProps {
  cwd: string;
  onOpenFileDiff?: (filePath: string, sha: string) => void;
}

const STORAGE_GRAPH_WIDTH = "pi-web:git-graph-col-graph-width";
const STORAGE_DESC_WIDTH = "pi-web:git-graph-col-desc-width";
const STORAGE_DETAILS_HEIGHT = "pi-web:git-graph-details-height";
const OVERSCAN = 20;

export function GitGraphView({ cwd, onOpenFileDiff }: GitGraphViewProps) {
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 150 : 500;

  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [, setCurrentBranch] = useState<string>("");
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const generationRef = useRef(0);

  const [graphWidth, setGraphWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_GRAPH_WIDTH);
      if (saved) {
        const val = Number(saved);
        if (Number.isFinite(val) && val >= 50 && val <= 600) return val;
      }
    } catch {}
    return 100;
  });

  const [descWidth, setDescWidth] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DESC_WIDTH);
      if (saved) {
        const val = Number(saved);
        if (Number.isFinite(val) && val >= 160 && val <= 2000) return val;
      }
    } catch {}
    return null;
  });

  const [detailsHeight, setDetailsHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DETAILS_HEIGHT);
      if (saved) {
        const val = Number(saved);
        if (Number.isFinite(val) && val >= 120 && val <= 500) return val;
      }
    } catch {}
    return 190;
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(600);

  // Fetch commits (supports initial load and pagination append)
  const loadData = useCallback(async (skip = 0, isAppend = false) => {
    const gen = ++generationRef.current;
    if (!isAppend) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams({
        cwd,
        maxCount: String(pageSize),
        skip: String(skip),
      });
      if (branchFilter && branchFilter !== "all") {
        params.set("branch", branchFilter);
      }
      const res = await fetch(`/api/git/graph?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const resData = (await res.json()) as GitGraphData;
      if (generationRef.current !== gen) return;

      setIsGitRepo(resData.isGitRepository);
      setBranches(resData.branches);
      setCurrentBranch(resData.currentBranch);
      setHasMore(resData.hasMore);

      if (isAppend) {
        setCommits((prev) => [...prev, ...resData.commits]);
      } else {
        setCommits(resData.commits);
        if (resData.commits.length > 0) {
          setSelectedSha((cur) => cur ?? resData.commits[0].sha);
        }
      }
    } catch (e) {
      if (generationRef.current !== gen) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generationRef.current === gen) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [cwd, branchFilter, pageSize]);

  useEffect(() => {
    void loadData(0, false);
  }, [loadData]);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) {
      void loadData(commits.length, true);
    }
  }, [hasMore, loadingMore, loading, commits.length, loadData]);

  // Compute topological graph rows
  const allRows = useMemo(() => {
    if (commits.length === 0) return [];
    return computeGraphRows(commits);
  }, [commits]);

  // Filter rows based on search
  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return allRows;
    return allRows.filter((r) => {
      const c = r.commit;
      return (
        c.subject.toLowerCase().includes(q) ||
        c.shortSha.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q)
      );
    });
  }, [allRows, searchQuery]);

  // Scroll listener for virtual rendering and infinite auto-loading
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      setScrollTop(el.scrollTop);
      // Automatically load more when scrolling within 250px of the bottom
      if (hasMore && !loadingMore && !loading) {
        const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
        if (distanceToBottom < 250) {
          handleLoadMore();
        }
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setClientHeight(entry.contentRect.height);
      }
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [hasMore, loadingMore, loading, handleLoadMore]);

  // Compute virtual slice
  const startIndex = Math.max(0, Math.floor(scrollTop / GRAPH_ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(clientHeight / GRAPH_ROW_HEIGHT);
  const endIndex = Math.min(filteredRows.length, startIndex + visibleCount + OVERSCAN * 2);
  const visibleRows = filteredRows.slice(startIndex, endIndex);

  const paddingTop = startIndex * GRAPH_ROW_HEIGHT;
  const paddingBottom = Math.max(0, (filteredRows.length - endIndex) * GRAPH_ROW_HEIGHT);

  const selectedCommit = useMemo(() => {
    if (!selectedSha) return null;
    return commits.find((c) => c.sha === selectedSha) ?? null;
  }, [commits, selectedSha]);

  const handleSelectSha = (sha: string) => {
    setSelectedSha(sha);
    const targetIdx = filteredRows.findIndex((r) => r.commit.sha === sha);
    if (targetIdx !== -1 && scrollContainerRef.current) {
      const targetTop = targetIdx * GRAPH_ROW_HEIGHT;
      const curTop = scrollContainerRef.current.scrollTop;
      const curBottom = curTop + clientHeight;
      if (targetTop < curTop || targetTop > curBottom - GRAPH_ROW_HEIGHT) {
        scrollContainerRef.current.scrollTo({
          top: Math.max(0, targetTop - Math.floor(clientHeight / 3)),
          behavior: "smooth",
        });
      }
    }
  };

  // Column resizing handlers
  const handleGraphResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = graphWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextW = Math.max(50, Math.min(600, Math.round(startW + delta)));
      setGraphWidth(nextW);
      try {
        localStorage.setItem(STORAGE_GRAPH_WIDTH, String(nextW));
      } catch {}
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleDescResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = descWidth ?? 350;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextW = Math.max(160, Math.min(2000, Math.round(startW + delta)));
      setDescWidth(nextW);
      try {
        localStorage.setItem(STORAGE_DESC_WIDTH, String(nextW));
      } catch {}
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const renderRefBadges = (refs: GitGraphRef[]) => {
    if (!refs || refs.length === 0) return null;
    return refs.map((ref) => {
      let bg = "var(--bg-panel)";
      let color = "var(--text)";
      let border = "1px solid var(--border)";

      if (ref.type === "head") {
        bg = "#064e3b";
        color = "#6ee7b7";
        border = "1px solid #047857";
      } else if (ref.type === "tag") {
        bg = "#451a03";
        color = "#fcd34d";
        border = "1px solid #78350f";
      } else if (ref.type === "remote") {
        bg = "transparent";
        color = "var(--text-dim)";
        border = "1px dashed var(--border)";
      } else if (ref.current) {
        border = "1px solid var(--accent)";
        color = "var(--accent)";
        bg = "var(--bg-selected)";
      }

      return (
        <span
          key={`${ref.type}:${ref.name}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "1px 6px",
            borderRadius: 4,
            fontSize: 10.5,
            lineHeight: "14px",
            fontWeight: 500,
            flexShrink: 0,
            background: bg,
            color,
            border,
          }}
        >
          {ref.type === "head" && (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#34d399",
                display: "inline-block",
              }}
            />
          )}
          {ref.name}
        </span>
      );
    });
  };

  if (loading && commits.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
          fontSize: 12,
        }}
      >
        正在加载 Git 提交图谱…
      </div>
    );
  }

  if (error || !isGitRepo) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
          fontSize: 12,
          gap: 8,
          padding: 24,
          textAlign: "center",
        }}
      >
        <span style={{ color: "#ef4444" }}>
          {error || "当前工作区不是一个有效的 Git 仓库"}
        </span>
        <button
          type="button"
          onClick={() => void loadData(0, false)}
          style={{
            padding: "4px 10px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text)",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg)",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* 1. Toolbar */}
      <div
        style={{
          height: 36,
          padding: "0 8px 0 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        {/* Branch Filter Dropdown */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setBranchMenuOpen((prev) => !prev)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height: 24,
              padding: "0 8px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 11,
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="9" r="3" />
              <path d="M6 9v6M18 12a9 9 0 0 1-9 9" />
            </svg>
            <span>{branchFilter === "all" ? "全部分支" : branchFilter}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {branchMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: 28,
                left: 0,
                width: 220,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                zIndex: 200,
                padding: 4,
              }}
            >
              <div
                onClick={() => {
                  setBranchFilter("all");
                  setBranchMenuOpen(false);
                }}
                style={{
                  padding: "5px 8px",
                  borderRadius: 4,
                  fontSize: 11.5,
                  cursor: "pointer",
                  color: branchFilter === "all" ? "var(--accent)" : "var(--text)",
                  fontWeight: branchFilter === "all" ? 600 : 400,
                  background: branchFilter === "all" ? "var(--bg-selected)" : "transparent",
                }}
              >
                全部分支 (All Branches)
              </div>
              {branches.map((b) => (
                <div
                  key={b}
                  onClick={() => {
                    setBranchFilter(b);
                    setBranchMenuOpen(false);
                  }}
                  style={{
                    padding: "5px 8px",
                    borderRadius: 4,
                    fontSize: 11.5,
                    cursor: "pointer",
                    color: branchFilter === b ? "var(--accent)" : "var(--text)",
                    fontWeight: branchFilter === b ? 600 : 400,
                    background: branchFilter === b ? "var(--bg-selected)" : "transparent",
                  }}
                >
                  {b}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search Input */}
        <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              position: "absolute",
              left: 7,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-dim)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索提交 (信息, SHA, 作者)…"
            style={{
              width: "100%",
              height: 24,
              padding: "0 22px 0 24px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text)",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 16,
                height: 16,
                background: "none",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Counter & Refresh */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {filteredRows.length} 个提交{hasMore ? " (未完)" : ""}
          </span>
          <button
            type="button"
            onClick={() => void loadData(0, false)}
            title="刷新图谱"
            style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>
      </div>

      {/* 2. Column Headers */}
      <div
        style={{
          height: 26,
          display: "flex",
          alignItems: "center",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "relative",
            width: isMobile ? Math.min(graphWidth, 80) : graphWidth,
            padding: "0 8px",
            display: "flex",
            alignItems: "center",
            height: "100%",
            flexShrink: 0,
          }}
        >
          <span>图谱</span>
          {!isMobile && (
            <div
              onPointerDown={handleGraphResize}
              onDoubleClick={() => {
                setGraphWidth(100);
                try {
                  localStorage.removeItem(STORAGE_GRAPH_WIDTH);
                } catch {}
              }}
              title="拖拽调整宽度，双击重置"
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: "col-resize",
                zIndex: 10,
              }}
            />
          )}
        </div>

        <div
          style={{
            position: "relative",
            flex: isMobile || !descWidth ? 1 : undefined,
            width: isMobile ? undefined : (descWidth ?? undefined),
            minWidth: 120,
            padding: "0 8px",
            display: "flex",
            alignItems: "center",
            height: "100%",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span>描述</span>
          {!isMobile && (
            <div
              onPointerDown={handleDescResize}
              onDoubleClick={() => {
                setDescWidth(null);
                try {
                  localStorage.removeItem(STORAGE_DESC_WIDTH);
                } catch {}
              }}
              title="拖拽调整宽度，双击重置"
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: "col-resize",
                zIndex: 10,
              }}
            />
          )}
        </div>

        {!isMobile && <div style={{ width: 120, padding: "0 8px", flexShrink: 0 }}>作者</div>}
        {!isMobile && <div style={{ width: 105, padding: "0 8px", flexShrink: 0 }}>日期</div>}
        {!isMobile && <div style={{ width: 70, padding: "0 8px", flexShrink: 0 }}>SHA</div>}
      </div>

      {/* 3. Virtual Scroll Body */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
          position: "relative",
        }}
      >
        <div style={{ height: paddingTop }} />
        {visibleRows.map((row) => {
          const c = row.commit;
          const isSelected = c.sha === selectedSha;
          const svgWidth = Math.max(
            row.maxLanes * GRAPH_LANE_WIDTH + 8,
            graphWidth
          );

          return (
            <div
              key={c.sha}
              onClick={() => handleSelectSha(c.sha)}
              style={{
                display: "flex",
                alignItems: "center",
                height: GRAPH_ROW_HEIGHT,
                boxSizing: "border-box",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                fontSize: 12,
                background: isSelected ? "var(--bg-selected)" : "var(--bg)",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "var(--bg)";
              }}
            >
              {/* Graph Cell */}
              <div
                style={{
                  width: isMobile ? Math.min(graphWidth, 80) : graphWidth,
                  height: GRAPH_ROW_HEIGHT,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  overflow: "visible",
                }}
              >
                <GitGraphRowSvg
                  row={row}
                  isSelected={isSelected}
                  width={svgWidth}
                />
              </div>

              {/* Description Cell */}
              <div
                style={{
                  flex: isMobile || !descWidth ? 1 : undefined,
                  width: isMobile ? undefined : (descWidth ?? undefined),
                  minWidth: 120,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 8px",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {renderRefBadges(c.refs)}
                <span
                  title={c.subject}
                  style={{
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {c.subject}
                </span>
              </div>

              {/* Author Cell (Desktop only) */}
              {!isMobile && (
                <div
                  title={`${c.author} (${c.authorEmail})`}
                  style={{
                    width: 120,
                    flexShrink: 0,
                    padding: "0 8px",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.author}
                </div>
              )}

              {/* Date Cell (Desktop only) */}
              {!isMobile && (
                <div
                  style={{
                    width: 105,
                    flexShrink: 0,
                    padding: "0 8px",
                    color: "var(--text-dim)",
                    fontSize: 11,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {c.committedAt.split("T")[0] || c.committedAt}
                </div>
              )}

              {/* SHA Cell (Desktop only) */}
              {!isMobile && (
                <div
                  style={{
                    width: 70,
                    flexShrink: 0,
                    padding: "0 8px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--text-dim)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.shortSha}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ height: paddingBottom }} />

        {/* Load more footer button / auto-trigger indicator */}
        {hasMore && (
          <div
            style={{
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderTop: "1px solid var(--border)",
              background: "var(--bg-panel)",
            }}
          >
            <button
              type="button"
              disabled={loadingMore}
              onClick={handleLoadMore}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--text)",
                cursor: loadingMore ? "wait" : "pointer",
                fontWeight: 500,
              }}
            >
              {loadingMore ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span>正在加载更多提交…</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span>加载更早提交 (+{pageSize})</span>
                </>
              )}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              已加载 {commits.length} 个
            </span>
          </div>
        )}

        {!hasMore && commits.length > 0 && (
          <div
            style={{
              padding: "12px 16px",
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-dim)",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-panel)",
            }}
          >
            已加载全部 {commits.length} 个提交 · 达到最初提交
          </div>
        )}
      </div>

      {/* 4. Bottom Commit Details Drawer */}
      {selectedCommit && (
        <GitGraphDetails
          cwd={cwd}
          commit={selectedCommit}
          height={detailsHeight}
          onHeightChange={(h) => {
            setDetailsHeight(h);
            try {
              localStorage.setItem(STORAGE_DETAILS_HEIGHT, String(h));
            } catch {}
          }}
          onClose={() => setSelectedSha(null)}
          onSelectSha={handleSelectSha}
          onOpenFileDiff={onOpenFileDiff}
        />
      )}
    </div>
  );
}
