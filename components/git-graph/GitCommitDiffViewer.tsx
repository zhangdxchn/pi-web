"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitCommitDiff } from "@/lib/git-types";
import { DiffView } from "../FileViewer";

export function GitCommitDiffViewer({ cwd, sha, filePath }: GitCommitDiff) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ patch: string } | { error: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    const params = new URLSearchParams({ cwd, sha, path: filePath });
    fetch(`/api/git/graph?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { patch?: string; error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (typeof data.patch !== "string") throw new Error("Invalid commit diff response");
        setResult({ patch: data.patch });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: String(error instanceof Error ? error.message : error) });
      });
    return () => controller.abort();
  }, [cwd, sha, filePath]);

  if (!result || "error" in result) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: result ? "#f87171" : "var(--text-muted)", fontSize: 13 }}>
        {result ? result.error : t("i18n.loading")}
      </div>
    );
  }

  const hasTextDiff = parseUnifiedPatch(result.patch) !== null;
  return (
    <div className="file-viewer-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="file-viewer-toolbar" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)", background: "var(--bg)", flexShrink: 0 }}>
        <span className="file-viewer-path" style={{ fontFamily: "var(--font-mono)" }} title={filePath}>{filePath}</span>
        <span className="file-viewer-meta" title={sha}>{sha.slice(0, 7)}</span>
      </div>
      <div className="file-viewer-content" style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
        {hasTextDiff ? <DiffView patch={result.patch} wrapLines={false} /> : result.patch ? (
          <pre style={{ padding: "12px 16px", margin: 0, whiteSpace: "pre-wrap", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{result.patch}</pre>
        ) : (
          <div style={{ padding: "12px 16px", color: "var(--text-dim)", fontSize: 12 }}>{t("i18n.noChanges")}</div>
        )}
      </div>
    </div>
  );
}
