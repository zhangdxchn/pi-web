"use client";

import { useCallback, useEffect, useState } from "react";
import type { GitFileStatus, GitStatusResponse } from "@/lib/git-types";

interface WorkingChangesSnapshot {
  cwd: string;
  files: GitFileStatus[];
  /** The status was read at this time; it is not a commit timestamp. */
  timestamp: string;
}

/** The file explorer and graph use the same cwd-scoped status endpoint. */
export function useGitWorkingChanges(cwd: string, active: boolean, refreshKey: number) {
  const [snapshot, setSnapshot] = useState<WorkingChangesSnapshot | null>(null);
  const [errorCwd, setErrorCwd] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ cwd });
    void fetch(`/api/git/status?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<GitStatusResponse>;
      })
      .then((status) => {
        if (controller.signal.aborted) return;
        setSnapshot({ cwd, files: status.isGitRepository ? status.files : [], timestamp: new Date().toISOString() });
        setErrorCwd(null);
      })
      .catch(() => { if (!controller.signal.aborted) setErrorCwd(cwd); });
    return () => controller.abort();
  }, [cwd, active, refreshKey, refreshVersion]);

  useEffect(() => {
    if (!active) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active, refresh]);

  return { snapshot: snapshot?.cwd === cwd ? snapshot : null, error: errorCwd === cwd, refresh };
}
