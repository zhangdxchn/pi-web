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
  formatCommitDate,
  getRefBadgeStyle,
  GRAPH_LANE_WIDTH,
  GRAPH_PALETTE,
  GRAPH_ROW_HEIGHT,
} from "@/lib/git-graph-model";
import { GitGraphRowSvg } from "./GitGraphRowSvg";
import { GitGraphDetails } from "./GitGraphDetails";
import { GitGraphActions, type GitGraphActionTarget } from "./GitGraphActions";
import { useGitGraphColumns } from "./useGitGraphColumns";
import styles from "./GitGraphView.module.css";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

interface GitGraphViewProps {
  cwd: string;
  onOpenFileDiff?: (filePath: string, sha: string) => void;
  onGitChanged?: () => void;
  onOpenTerminal?: (cwd: string) => void;
}

const STORAGE_DETAILS_HEIGHT = "pi-web:git-graph-details-height";
const STORAGE_SHOW_REMOTES = "pi-web:git-graph-show-remotes";
const OVERSCAN = 20;

export function GitGraphView({ cwd, onOpenFileDiff, onGitChanged, onOpenTerminal }: GitGraphViewProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 200 : 500;

  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [headSha, setHeadSha] = useState("");
  const [remotes, setRemotes] = useState<string[]>([]);
  const [actionTarget, setActionTarget] = useState<GitGraphActionTarget | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [showRemotes, setShowRemotes] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SHOW_REMOTES);
      if (saved !== null) return saved === "true";
    } catch {}
    return true;
  });

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const commitsRef = useRef<GitGraphCommit[]>([]);
  commitsRef.current = commits;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

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
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(600);
  const [clientWidth, setClientWidth] = useState(0);

  // 1. Initial Load (runs when cwd, branchFilter, showRemotes or pageSize changes)
  const loadInitial = useCallback(async () => {
    const gen = ++generationRef.current;
    inFlightRef.current = true;
    setLoading(true);
    setLoadingMore(false);
    setError(null);

    try {
      const params = new URLSearchParams({
        cwd,
        maxCount: String(pageSize),
        skip: "0",
        showRemotes: String(showRemotes),
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
      setHeadSha(resData.headSha ?? "");
      setRemotes(resData.remotes ?? []);
      setHasMore(resData.hasMore);
      hasMoreRef.current = resData.hasMore;
      setCommits(resData.commits);
      commitsRef.current = resData.commits;

      setSelectedSha((cur) => {
        if (!cur) return null;
        return resData.commits.some((c) => c.sha === cur) ? cur : null;
      });
    } catch (e) {
      if (generationRef.current !== gen) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generationRef.current === gen) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [cwd, branchFilter, showRemotes, pageSize]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    setActionTarget(null);
  }, [cwd, branchFilter, showRemotes, searchQuery]);

  useEffect(() => {
    if (actionTarget) setActionNotice("");
  }, [actionTarget]);

  // 2. Append Load (runs on scroll to bottom or click "Load More")
  const handleLoadMore = useCallback(async () => {
    // Synchronous guard: if already fetching or no more commits, immediately ignore
    if (inFlightRef.current || !hasMoreRef.current) return;
    inFlightRef.current = true;
    setLoadingMore(true);

    const curGen = generationRef.current;
    const skip = commitsRef.current.length;

    try {
      const params = new URLSearchParams({
        cwd,
        maxCount: String(pageSize),
        skip: String(skip),
        showRemotes: String(showRemotes),
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
      // Only commit if the user didn't switch branches or cwd in the meantime
      if (generationRef.current === curGen) {
        setCommits((prev) => {
          const next = [...prev, ...resData.commits];
          commitsRef.current = next;
          return next;
        });
        setHasMore(resData.hasMore);
        hasMoreRef.current = resData.hasMore;
      }
    } catch (e) {
      if (generationRef.current === curGen) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      inFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [cwd, branchFilter, showRemotes, pageSize]);

  // Compute topological graph rows
  const allRows = useMemo(() => {
    if (commits.length === 0) return [];
    return computeGraphRows(commits);
  }, [commits]);

  // Compute maximum lane used across all computed rows to guarantee no overlap with description
  const maxLanes = useMemo(() => {
    let max = 1;
    for (const r of allRows) {
      if (r.maxLanes > max) max = r.maxLanes;
    }
    return max;
  }, [allRows]);

  const minGraphWidth = Math.max(80, maxLanes * GRAPH_LANE_WIDTH + 16);
  const { columns, effectiveGraphWidth, headerRef, separatorProps, tableMinWidth } = useGitGraphColumns(minGraphWidth, isMobile, clientWidth);

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

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const opener = actionTarget?.opener;
    if (actionTarget) {
      setActionTarget(null);
      requestAnimationFrame(() => {
        if (opener && !opener.isConnected && document.activeElement === document.body && !isMobile) el.focus({ preventScroll: true });
      });
    }
    setScrollTop(el.scrollTop);
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = el.scrollLeft;
    // Automatically load more when scrolling within 300px of the bottom
    if (hasMoreRef.current && !inFlightRef.current) {
      const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (distanceToBottom < 300) {
        void handleLoadMore();
      }
    }
  };

  // Header and rows use the scrollport's width, including its scrollbar inset.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const measure = () => {
      setClientHeight(el.clientHeight);
      setClientWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, commits.length]);

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
    setSelectedSha((cur) => (cur === sha ? null : sha));
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

  const renderRefBadges = (refs: GitGraphRef[], curveColor: string, commit: GitGraphCommit) => refs.map((ref) => {
    const badgeStyle = getRefBadgeStyle(ref, curveColor);
    const style: React.CSSProperties = {
      display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 6px", borderRadius: 4,
      fontSize: 10.5, lineHeight: "14px", fontWeight: badgeStyle.fontWeight ?? 500, flexShrink: 0,
      background: badgeStyle.bg, color: badgeStyle.color, border: badgeStyle.border,
    };
    if (ref.type === "head") return <span key="head" style={style}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399" }} />{ref.name}</span>;
    return <button key={`${ref.type}:${ref.name}`} type="button" className={styles.refButton} style={style}
      aria-label={t("gitGraph.action.menu", { target: ref.name })}
      onClick={(event) => {
        event.stopPropagation();
        setActionTarget({ commit, ref, anchor: { kind: "rect", rect: event.currentTarget.getBoundingClientRect(), align: "start" }, opener: event.currentTarget });
      }}
      onContextMenu={(event) => {
        event.preventDefault(); event.stopPropagation();
        setActionTarget({ commit, ref, anchor: { kind: "point", x: event.clientX, y: event.clientY }, opener: event.currentTarget });
      }}>{ref.name}</button>;
  });

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
        {t("gitGraph.loading")}
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
          {error || t("gitGraph.notGitRepo")}
        </span>
        <button
          type="button"
          onClick={() => void loadInitial()}
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
          {t("gitGraph.retry")}
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
          minHeight: 36,
          padding: "5px 8px 5px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
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
            <span>{branchFilter === "all" ? t("gitGraph.allBranches") : branchFilter === "current" ? t("gitGraph.currentBranch") : branchFilter}</span>
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
                width: 240,
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
                {t("gitGraph.allBranches")}
              </div>
              <div
                onClick={() => {
                  setBranchFilter("current");
                  setBranchMenuOpen(false);
                }}
                style={{
                  padding: "5px 8px",
                  borderRadius: 4,
                  fontSize: 11.5,
                  cursor: "pointer",
                  color: branchFilter === "current" ? "var(--accent)" : "var(--text)",
                  fontWeight: branchFilter === "current" ? 600 : 400,
                  background: branchFilter === "current" ? "var(--bg-selected)" : "transparent",
                }}
              >
                {currentBranch ? t("gitGraph.currentBranchNamed", { branch: currentBranch }) : t("gitGraph.currentBranch")}
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

        {/* Show Remote Branches Toggle (aligned with vscode-git-graph) */}
        {!isMobile && (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "var(--text-muted)",
              cursor: "pointer",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
            title={t("gitGraph.showRemotes")}
          >
            <input
              type="checkbox"
              checked={showRemotes}
              onChange={(e) => {
                const next = e.target.checked;
                setShowRemotes(next);
                try {
                  localStorage.setItem(STORAGE_SHOW_REMOTES, String(next));
                } catch {}
              }}
              style={{ cursor: "pointer" }}
            />
            <span>{t("gitGraph.showRemotes")}</span>
          </label>
        )}

        {/* Keep search and refresh together when the toolbar wraps. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 330px", minWidth: 0 }}>
          <div style={{ position: "relative", flex: "1 1 0", minWidth: 0, maxWidth: 360 }}>
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
              placeholder={t("gitGraph.search")}
              aria-label={t("gitGraph.search")}
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
                title={t("gitGraph.clearSearch")}
                aria-label={t("gitGraph.clearSearch")}
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
          <button
            type="button"
            onClick={() => void loadInitial()}
            title={t("gitGraph.refresh")}
            aria-label={t("gitGraph.refresh")}
            style={{
              width: 24,
              height: 24,
              flexShrink: 0,
              marginLeft: "auto",
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

      {/* The header follows the body's horizontal scroll, not its vertical scroll. */}
      <div style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div ref={headerScrollRef} className={styles.scrollEdge} style={{ width: clientWidth || "100%", overflow: "hidden" }}>
          <div
            ref={headerRef}
            data-testid="git-graph-header"
            style={{
              height: 25, display: "flex", alignItems: "center", width: "100%",
              minWidth: isMobile ? undefined : tableMinWidth,
              fontSize: 11, color: "var(--text-dim)", fontWeight: 500,
            }}
          >
            <div style={{ position: "relative", width: effectiveGraphWidth, padding: "0 8px", height: "100%", display: "flex", alignItems: "center", flexShrink: 0, borderRight: "1px solid var(--border)", userSelect: "none" }}>
              <span>{t("gitGraph.graph")}</span>
              {!isMobile && <div className={styles.columnResize} {...separatorProps("graph", t("gitGraph.resizeGraph"))} />}
            </div>
            <div style={{ position: "relative", flex: isMobile ? 1 : `1 0 ${columns.description}px`, minWidth: isMobile ? 120 : columns.description, padding: "0 8px", height: "100%", display: "flex", alignItems: "center", borderRight: !isMobile ? "1px solid var(--border)" : undefined, userSelect: "none" }}>
              <span style={{ overflow: "hidden", whiteSpace: "nowrap" }}>{t("gitGraph.description")}</span>
              {!isMobile && <div className={styles.columnResize} {...separatorProps("description", t("gitGraph.resizeDescription"))} />}
            </div>
            {!isMobile && <div style={{ position: "relative", width: columns.author, padding: "0 8px", height: "100%", display: "flex", alignItems: "center", flexShrink: 0, borderRight: "1px solid var(--border)", userSelect: "none" }}>
              <span style={{ overflow: "hidden", whiteSpace: "nowrap" }}>{t("gitGraph.author")}</span>
              <div className={styles.columnResize} {...separatorProps("author", t("gitGraph.resizeAuthor"))} />
            </div>}
            {!isMobile && <div style={{ position: "relative", width: columns.date, padding: "0 8px", height: "100%", display: "flex", alignItems: "center", flexShrink: 0, borderRight: "1px solid var(--border)", userSelect: "none" }}>
              <span style={{ overflow: "hidden", whiteSpace: "nowrap" }}>{t("gitGraph.date")}</span>
              <div className={styles.columnResize} {...separatorProps("date", t("gitGraph.resizeDate"))} />
            </div>}
            {!isMobile && <div style={{ width: columns.sha, padding: "0 8px", flexShrink: 0 }}>SHA</div>}
          </div>
        </div>
      </div>

      {/* 3. Virtual Scroll Body */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={styles.scrollEdge}
        role="region"
        aria-label={t("gitGraph.title")}
        tabIndex={isMobile ? undefined : 0}
        data-testid="git-graph-body"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: isMobile ? "hidden" : "auto",
          minHeight: 0,
          position: "relative",
        }}
      >
        <div style={{ height: paddingTop }} />
        {visibleRows.map((row) => {
          const c = row.commit;
          const isSelected = c.sha === selectedSha;
          const curveColor = GRAPH_PALETTE[row.colorIndex] ?? "var(--accent)";

          return (
            <div
              key={c.sha}
              data-testid="git-graph-row"
              onClick={() => handleSelectSha(c.sha)}
              className={styles.row}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectSha(c.sha); }
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  setActionTarget({ commit: c, anchor: { kind: "rect", rect: event.currentTarget.getBoundingClientRect(), align: "start" }, opener: event.currentTarget });
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setActionTarget({ commit: c, anchor: { kind: "point", x: event.clientX, y: event.clientY }, opener: event.currentTarget });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                minWidth: isMobile ? undefined : tableMinWidth,
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
                  width: effectiveGraphWidth,
                  height: GRAPH_ROW_HEIGHT,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  overflow: "hidden",
                  borderRight: "1px solid var(--border)",
                }}
              >
                <GitGraphRowSvg
                  row={row}
                  isSelected={isSelected}
                  width={effectiveGraphWidth}
                />
              </div>

              {/* Description Cell */}
              <div
                style={{
                  flex: isMobile ? 1 : `1 0 ${columns.description}px`,
                  minWidth: isMobile ? 120 : columns.description,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 8px",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  borderRight: !isMobile ? "1px solid var(--border)" : undefined,
                }}
              >
                {c.refs.length > 0 && <div className={styles.refList}>{renderRefBadges(c.refs, curveColor, c)}</div>}
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
                <button type="button" className={styles.rowActions} aria-label={t("gitGraph.action.commitMenu", { sha: c.shortSha })}
                  onClick={(event) => { event.stopPropagation(); setActionTarget({ commit: c, anchor: { kind: "rect", rect: event.currentTarget.getBoundingClientRect(), align: "end" }, opener: event.currentTarget }); }}>⋯</button>
              </div>

              {/* Author Cell (Desktop only) */}
              {!isMobile && (
                <div
                  title={`${c.author} (${c.authorEmail})`}
                  style={{
                    width: columns.author,
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
                  title={c.committedAt}
                  style={{
                    width: columns.date,
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
                  {formatCommitDate(c.committedAt)}
                </div>
              )}

              {/* SHA Cell (Desktop only) */}
              {!isMobile && (
                <div
                  style={{
                    width: columns.sha,
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
                  <span>{t("gitGraph.loadingMore")}</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span>{t("gitGraph.loadMore", { count: pageSize })}</span>
                </>
              )}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("gitGraph.loadedCount", { count: commits.length })}
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
            {t("gitGraph.allCommitsLoaded", { count: commits.length })}
          </div>
        )}
      </div>

      {actionNotice && <div role="status" style={{ padding: "4px 10px", color: "var(--text-muted)", fontSize: 11, borderTop: "1px solid var(--border)" }}>{actionNotice}</div>}
      {actionTarget && <GitGraphActions cwd={cwd} target={actionTarget} currentBranch={currentBranch} headSha={headSha} remotes={remotes} mobile={isMobile}
        onClose={() => setActionTarget(null)} onNotice={setActionNotice} onOpenTerminal={onOpenTerminal}
        onFilter={(branch) => { setBranchFilter(branch); setActionTarget(null); }}
        onChanged={(action) => {
          if ((action === "branch-rename" || action === "branch-delete") && branchFilter === actionTarget.ref?.name) setBranchFilter("all");
          else void loadInitial();
          onGitChanged?.();
        }} />}

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
