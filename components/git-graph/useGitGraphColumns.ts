"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

const GRAPH_STORAGE = "pi-web:git-graph-col-graph-width";
const COLUMNS_STORAGE = "pi-web:git-graph-column-widths";

const DEFAULTS = { description: 220, author: 120, date: 125, sha: 70 };
const MINIMUMS = { description: 220, author: 64, date: 90, sha: 56 };
type ColumnWidths = typeof DEFAULTS;
type Boundary = "graph" | "description" | "author" | "date";

interface ResizeStart {
  boundary: Boundary;
  pointerId: number;
  x: number;
  widths: number[];
  preferences: ColumnWidths;
}

function readColumnWidths(): ColumnWidths {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_STORAGE) ?? "null");
    if (saved && typeof saved === "object") {
      const value = (key: keyof ColumnWidths) =>
        typeof saved[key] === "number" && Number.isFinite(saved[key])
          ? Math.max(MINIMUMS[key], saved[key])
          : DEFAULTS[key];
      return { description: value("description"), author: value("author"), date: value("date"), sha: value("sha") };
    }
  } catch {}
  return { ...DEFAULTS };
}

function readGraphWidth(): number {
  try {
    const saved = localStorage.getItem(GRAPH_STORAGE);
    if (saved !== null) {
      const value = Number(saved);
      if (Number.isFinite(value) && value >= 50 && value <= 1000) return value;
    }
  } catch {}
  return 110;
}

export function useGitGraphColumns(minGraphWidth: number, isMobile: boolean, clientWidth: number) {
  const [graphWidth, setGraphWidth] = useState(readGraphWidth);
  const [columns, setColumns] = useState(readColumnWidths);
  const [active, setActive] = useState<{ boundary: Boundary; limited: boolean } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ResizeStart | null>(null);
  const effectiveGraphWidth = isMobile ? minGraphWidth : Math.max(graphWidth, minGraphWidth);
  const tableMinWidth = effectiveGraphWidth + columns.description + columns.author + columns.date + columns.sha;
  const renderedDescription = Math.max(columns.description, clientWidth - effectiveGraphWidth - columns.author - columns.date - columns.sha);

  const saveColumns = (next: ColumnWidths) => {
    setColumns(next);
    try { localStorage.setItem(COLUMNS_STORAGE, JSON.stringify(next)); } catch {}
  };
  const saveGraph = (next: number) => {
    setGraphWidth(next);
    try { localStorage.setItem(GRAPH_STORAGE, String(next)); } catch {}
  };

  const snapshot = (boundary: Boundary, pointerId = -1, x = 0): ResizeStart | null => {
    const cells = headerRef.current?.children;
    if (!cells || cells.length !== 5) return null;
    return {
      boundary, pointerId, x,
      widths: Array.from(cells, (cell) => cell.getBoundingClientRect().width),
      preferences: columns,
    };
  };

  const resize = (start: ResizeStart, requested: number) => {
    const delta = Math.round(requested);
    const [, description, author, date, sha] = start.widths;
    const next = { ...start.preferences };
    let applied = delta;

    switch (start.boundary) {
      case "graph": {
        const width = Math.max(minGraphWidth, Math.min(Math.max(1000, minGraphWidth), Math.round(start.widths[0] + delta)));
        applied = width - start.widths[0];
        saveGraph(width);
        break;
      }
      case "description": {
        applied = Math.max(MINIMUMS.description - description, Math.min(author - MINIMUMS.author, delta));
        const nextDescription = Math.round(description + applied);
        next.author = Math.round(author - applied);
        // While the panel is too narrow, retain a deliberate description growth.
        // In a wide panel the flexible description already follows the author.
        if (description <= start.preferences.description + 1 || nextDescription < start.preferences.description) {
          next.description = Math.max(MINIMUMS.description, nextDescription);
        }
        saveColumns(next);
        break;
      }
      case "author":
        applied = Math.max(MINIMUMS.author - author, Math.min(date - MINIMUMS.date, delta));
        next.author = Math.round(author + applied);
        next.date = Math.round(date - applied);
        saveColumns(next);
        break;
      case "date":
        applied = Math.max(MINIMUMS.date - date, Math.min(sha - MINIMUMS.sha, delta));
        next.date = Math.round(date + applied);
        next.sha = Math.round(sha - applied);
        saveColumns(next);
        break;
    }
    return Math.abs(applied - delta) > 0.5;
  };

  const reset = (boundary: Boundary) => {
    if (boundary === "graph") {
      setGraphWidth(minGraphWidth);
      try { localStorage.removeItem(GRAPH_STORAGE); } catch {}
      return;
    }
    const next = { ...columns };
    if (boundary === "description") {
      next.description = DEFAULTS.description;
      next.author = DEFAULTS.author;
    } else if (boundary === "author") {
      next.author = DEFAULTS.author;
      next.date = DEFAULTS.date;
    } else {
      next.date = DEFAULTS.date;
      next.sha = DEFAULTS.sha;
    }
    saveColumns(next);
  };

  const separatorProps = (boundary: Boundary, label: string) => {
    const values = {
      graph: { current: effectiveGraphWidth, min: minGraphWidth, max: Math.max(1000, minGraphWidth) },
      description: { current: renderedDescription, min: MINIMUMS.description, max: renderedDescription + columns.author - MINIMUMS.author },
      author: { current: columns.author, min: MINIMUMS.author, max: columns.author + columns.date - MINIMUMS.date },
      date: { current: columns.date, min: MINIMUMS.date, max: columns.date + columns.sha - MINIMUMS.sha },
    }[boundary];

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const start = snapshot(boundary, event.pointerId, event.clientX);
      if (!start) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = start;
      setActive({ boundary, limited: false });
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
      const start = dragRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      event.preventDefault();
      setActive({ boundary, limited: resize(start, event.clientX - start.x) });
    };
    const finish = (event: PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setActive(null);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        reset(boundary);
        return;
      }
      const step = event.shiftKey ? 32 : 12;
      const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step
        : event.key === "Home" ? -100000 : event.key === "End" ? 100000 : null;
      if (delta === null) return;
      const start = snapshot(boundary);
      if (!start) return;
      event.preventDefault();
      resize(start, delta);
    };

    return {
      role: "separator" as const,
      tabIndex: 0,
      title: label,
      "aria-label": label,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": Math.round(values.min),
      "aria-valuemax": Math.round(values.max),
      "aria-valuenow": Math.round(values.current),
      "aria-valuetext": `${Math.round(values.current)} px`,
      "data-resizing": active?.boundary === boundary || undefined,
      "data-limited": active?.boundary === boundary && active.limited || undefined,
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onDoubleClick: () => reset(boundary),
      onKeyDown,
    };
  };

  return { columns, effectiveGraphWidth, headerRef, separatorProps, tableMinWidth };
}
