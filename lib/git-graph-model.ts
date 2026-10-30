import type { GitGraphCommit } from "./git-types";

export const GRAPH_PALETTE: readonly string[] = [
  "var(--accent)",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "var(--text-muted)",
] as const;

export const GRAPH_LANE_WIDTH = 16;
export const GRAPH_ROW_HEIGHT = 28;
export const GRAPH_NODE_RADIUS = 4;
export const GRAPH_MERGE_RADIUS = 5;

export interface GraphCurve {
  fromLane: number;
  toLane: number;
  type: "from-top" | "to-bottom";
  colorIndex: number;
}

export interface GraphRowData {
  commit: GitGraphCommit;
  rowIndex: number;
  lane: number;
  colorIndex: number;
  isMerge: boolean;
  passThroughLanes: number[];
  hasTopStraight: boolean;
  hasBottomStraight: boolean;
  curves: GraphCurve[];
  maxLanes: number;
}

/**
 * Produces an SVG cubic bezier path command string ("M ... C ...") for a GraphCurve.
 */
export function getBezierPath(
  curve: GraphCurve,
  laneWidth: number = GRAPH_LANE_WIDTH,
  rowHeight: number = GRAPH_ROW_HEIGHT,
  offsetX: number = GRAPH_LANE_WIDTH / 2,
  tension = 0.75,
): string {
  const x1 = curve.fromLane * laneWidth + offsetX;
  const x2 = curve.toLane * laneWidth + offsetX;

  if (curve.type === "from-top") {
    const y1 = 0;
    const y2 = rowHeight / 2;
    const cy1 = rowHeight * (1 - tension);
    const cy2 = rowHeight * (1 - tension);
    return `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`;
  }

  const y1 = rowHeight / 2;
  const y2 = rowHeight;
  const cy1 = rowHeight * tension;
  const cy2 = rowHeight * tension;
  return `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Computes deterministic graph lanes, vertical connections, and fork/merge curves
 * for a list of Git commits ordered topologically (newest first).
 */
export function computeGraphRows(commits: readonly GitGraphCommit[]): GraphRowData[] {
  if (commits.length === 0) return [];

  const tracks: (string | null)[] = [];
  const rows: GraphRowData[] = [];

  for (let rowIndex = 0; rowIndex < commits.length; rowIndex++) {
    const commit = commits[rowIndex];
    if (!commit) continue;

    // 1. Check which tracks are expecting this commit
    const incomingLanes: number[] = [];
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i] === commit.sha) {
        incomingLanes.push(i);
      }
    }

    let lane: number;
    const curves: GraphCurve[] = [];

    if (incomingLanes.length > 0) {
      const primaryLane = incomingLanes[0] ?? 0;
      lane = primaryLane;

      // Any other incoming tracks merge into this commit here
      for (let j = 1; j < incomingLanes.length; j++) {
        const otherLane = incomingLanes[j];
        if (otherLane !== undefined) {
          curves.push({
            fromLane: otherLane,
            toLane: lane,
            type: "from-top",
            colorIndex: otherLane % GRAPH_PALETTE.length,
          });
          tracks[otherLane] = null;
        }
      }
    } else {
      // New branch head / tip
      const emptySlot = tracks.indexOf(null);
      lane = emptySlot !== -1 ? emptySlot : tracks.length;
      tracks[lane] = commit.sha;
    }

    const colorIndex = lane % GRAPH_PALETTE.length;
    const isMerge = commit.parents.length > 1;
    const hasTopStraight = incomingLanes.length > 0;

    // 2. Determine pass-through lanes BEFORE allocating new outgoing parent tracks
    const passThroughLanes: number[] = [];
    for (let i = 0; i < tracks.length; i++) {
      if (i !== lane && tracks[i] !== null && !incomingLanes.includes(i)) {
        passThroughLanes.push(i);
      }
    }

    // 3. Set outgoing targets for parents
    let hasBottomStraight = false;
    if (commit.parents.length === 0) {
      // Root commit
      tracks[lane] = null;
    } else {
      // Primary parent continues straight down in the current lane
      const p0 = commit.parents[0];
      if (p0) {
        tracks[lane] = p0;
        hasBottomStraight = true;
      }

      // Additional parents (merge commits) fork down into other lanes
      for (let pIdx = 1; pIdx < commit.parents.length; pIdx++) {
        const pOther = commit.parents[pIdx];
        if (!pOther) continue;

        // Check if that parent is already assigned to an active track
        const existingTrackIndex = tracks.indexOf(pOther);
        let targetLane: number;
        if (existingTrackIndex !== -1) {
          targetLane = existingTrackIndex;
        } else {
          const emptyTrack = tracks.indexOf(null);
          targetLane = emptyTrack !== -1 ? emptyTrack : tracks.length;
          tracks[targetLane] = pOther;
        }

        curves.push({
          fromLane: lane,
          toLane: targetLane,
          type: "to-bottom",
          colorIndex: targetLane % GRAPH_PALETTE.length,
        });
      }
    }

    // Calculate total lanes needed for this row
    let rowMaxLanes = lane;
    for (const p of passThroughLanes) {
      if (p > rowMaxLanes) rowMaxLanes = p;
    }
    for (const c of curves) {
      if (c.fromLane > rowMaxLanes) rowMaxLanes = c.fromLane;
      if (c.toLane > rowMaxLanes) rowMaxLanes = c.toLane;
    }

    rows.push({
      commit,
      rowIndex,
      lane,
      colorIndex,
      isMerge,
      passThroughLanes,
      hasTopStraight,
      hasBottomStraight,
      curves,
      maxLanes: Math.max(rowMaxLanes + 1, 1),
    });

    // Trim trailing nulls from tracks to keep lane count compact
    while (tracks.length > 0 && tracks[tracks.length - 1] === null) {
      tracks.pop();
    }
  }

  return rows;
}
