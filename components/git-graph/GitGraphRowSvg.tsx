import { memo } from "react";
import {
  GRAPH_LANE_WIDTH,
  GRAPH_MERGE_RADIUS,
  GRAPH_NODE_RADIUS,
  GRAPH_PALETTE,
  GRAPH_ROW_HEIGHT,
  type GraphRowData,
  getBezierPath,
} from "@/lib/git-graph-model";

interface GitGraphRowSvgProps {
  row: GraphRowData;
  isSelected?: boolean;
  width?: number;
}

export const GitGraphRowSvg = memo(function GitGraphRowSvg({
  row,
  isSelected = false,
  width,
}: GitGraphRowSvgProps) {
  const offsetX = GRAPH_LANE_WIDTH / 2;
  const x = (lane: number) => lane * GRAPH_LANE_WIDTH + offsetX;
  const yCenter = GRAPH_ROW_HEIGHT / 2;
  const svgWidth = Math.max(row.maxLanes * GRAPH_LANE_WIDTH + 8, width ?? GRAPH_LANE_WIDTH * 2);
  const nodeColor = GRAPH_PALETTE[row.colorIndex] ?? "var(--accent)";

  return (
    <svg
      width={svgWidth}
      height={GRAPH_ROW_HEIGHT}
      style={{ flexShrink: 0, overflow: "visible" }}
      aria-hidden="true"
    >
      {/* 1. Pass-through vertical lines */}
      {row.passThroughLanes.map((l) => (
        <line
          key={`pass-${l}`}
          x1={x(l)}
          y1={0}
          x2={x(l)}
          y2={GRAPH_ROW_HEIGHT}
          stroke={GRAPH_PALETTE[l % GRAPH_PALETTE.length]}
          strokeWidth={2}
        />
      ))}

      {/* 2. Top straight connection */}
      {row.hasTopStraight && (
        <line
          x1={x(row.lane)}
          y1={0}
          x2={x(row.lane)}
          y2={yCenter}
          stroke={nodeColor}
          strokeWidth={2}
        />
      )}

      {/* 3. Bottom straight connection */}
      {row.hasBottomStraight && (
        <line
          x1={x(row.lane)}
          y1={yCenter}
          x2={x(row.lane)}
          y2={GRAPH_ROW_HEIGHT}
          stroke={nodeColor}
          strokeWidth={2}
        />
      )}

      {/* 4. Bezier curves (forks and merges) */}
      {row.curves.map((curve, idx) => (
        <path
          key={`curve-${idx}`}
          d={getBezierPath(curve, GRAPH_LANE_WIDTH, GRAPH_ROW_HEIGHT, offsetX)}
          fill="none"
          stroke={GRAPH_PALETTE[curve.colorIndex]}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}

      {/* 5. Selected indicator ring */}
      {isSelected && (
        <circle
          cx={x(row.lane)}
          cy={yCenter}
          r={row.isMerge ? 8 : 7}
          fill="none"
          stroke={nodeColor}
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      )}

      {/* 6. Commit node dot */}
      {row.isMerge ? (
        <>
          <circle
            cx={x(row.lane)}
            cy={yCenter}
            r={GRAPH_MERGE_RADIUS}
            fill="var(--bg)"
            stroke={nodeColor}
            strokeWidth={2}
          />
          <circle
            cx={x(row.lane)}
            cy={yCenter}
            r={2}
            fill={nodeColor}
          />
        </>
      ) : (
        <circle
          cx={x(row.lane)}
          cy={yCenter}
          r={GRAPH_NODE_RADIUS}
          fill={nodeColor}
          stroke="var(--bg)"
          strokeWidth={1.2}
        />
      )}
    </svg>
  );
});
