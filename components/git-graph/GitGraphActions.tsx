"use client";

import { useState } from "react";
import type { GitGraphCommit, GitGraphRef } from "@/lib/git-types";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "../SidebarMenu";
import styles from "./GitGraphView.module.css";

export interface GitGraphActionTarget {
  commit: GitGraphCommit;
  ref?: GitGraphRef;
  anchor: SidebarMenuAnchor;
  opener: HTMLElement | null;
}

type Action = "branch-create" | "tag-create" | "branch-checkout" | "branch-rename" | "branch-delete" | "tag-delete" | "commit-checkout" | "cherry-pick" | "revert" | "merge" | "rebase" | "reset" | "remote-checkout" | "branch-push" | "tag-push" | "remote-fetch" | "remote-pull" | "remote-delete" | "tag-details" | "archive" | "filter" | "copy-ref" | "copy-sha" | "copy-subject";

const labelKeys: Record<Action, string> = {
  "branch-create": "createBranch", "tag-create": "createTag", "branch-checkout": "checkoutBranch", "branch-rename": "renameBranch", "branch-delete": "deleteBranch", "tag-delete": "deleteTag", "commit-checkout": "checkoutCommit", "cherry-pick": "cherryPick", revert: "revert", merge: "merge", rebase: "rebase", reset: "reset", "remote-checkout": "remoteCheckout", "branch-push": "pushBranch", "tag-push": "pushTag", "remote-fetch": "remoteFetch", "remote-pull": "remotePull", "remote-delete": "remoteDelete", "tag-details": "tagDetails", archive: "archive", filter: "filterBranch", "copy-ref": "copyName", "copy-sha": "copySha", "copy-subject": "copySubject",
};

export function GitGraphActions({ cwd, target, currentBranch, headSha, remotes, mobile, onClose, onChanged, onFilter, onNotice, onOpenTerminal }: {
  cwd: string;
  target: GitGraphActionTarget;
  currentBranch: string;
  headSha: string;
  remotes: string[];
  mobile: boolean;
  onClose: () => void;
  onChanged: (action: string) => void;
  onFilter: (branch: string) => void;
  onNotice: (message: string) => void;
  onOpenTerminal?: (cwd: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Action | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [tagType, setTagType] = useState("lightweight");
  const [mode, setMode] = useState("soft");
  const [parentNumber, setParentNumber] = useState("1");
  const [remote, setRemote] = useState(target.ref?.remote ?? remotes[0] ?? "");
  const [setUpstream, setSetUpstream] = useState(false);
  const [hardConfirm, setHardConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [tagDetails, setTagDetails] = useState<{ tagger: string; date: string; message: string } | null>(null);
  const ref = target.ref;
  const kind = ref?.type ?? "commit";
  const display = ref?.name ?? target.commit.shortSha;
  const label = (action: Action) => t(`gitGraph.action.${labelKeys[action]}`);
  const fullName = ref?.fullName ?? "";

  const start = async (action: Action) => {
    if (action === "copy-ref" || action === "copy-sha" || action === "copy-subject") {
      const value = action === "copy-ref" ? ref?.name ?? "" : action === "copy-sha" ? target.commit.sha : target.commit.subject;
      try { await copyText(value); onNotice(t("gitGraph.action.copied")); }
      catch { onNotice(t("gitGraph.action.copyFailed")); }
      return;
    }
    if (action === "filter") { if (ref) onFilter(ref.name); return; }
    if (action === "archive") {
      try {
        const params = new URLSearchParams({ cwd, ref: fullName });
        const response = await fetch(`/api/git/graph/archive?${params}`);
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error || t("gitGraph.action.failed"));
        }
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a"); a.href = url; a.download = "git-archive.zip"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) { onNotice(e instanceof Error ? e.message : t("gitGraph.action.failed")); }
      return;
    }
    setError(null); setConflicts([]); setHardConfirm(false); setForm(action);
    if (action === "branch-rename") setName(ref?.name ?? "");
    else if (action === "remote-checkout" || action === "remote-fetch") setName(ref?.remote ? ref.name.slice(ref.remote.length + 1) : "");
    else setName("");
    if (action === "tag-details") {
      setBusy(true);
      try {
        const params = new URLSearchParams({ cwd, ref: fullName });
        const res = await fetch(`/api/git/graph/tag?${params}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || t("gitGraph.action.failed"));
        setTagDetails(body);
      } catch (e) { setError(e instanceof Error ? e.message : t("gitGraph.action.failed")); }
      finally { setBusy(false); }
    }
  };

  const groups: (Action | "separator")[] = kind === "commit"
    ? ["branch-create", "tag-create", "separator", "commit-checkout", "cherry-pick", "revert", "separator", "merge", "rebase", "reset", "separator", "copy-sha", "copy-subject"]
    : kind === "branch"
      ? ["branch-checkout", "branch-rename", "branch-delete", "separator", "merge", "rebase", "branch-push", "separator", "archive", "filter", "separator", "copy-ref"]
      : kind === "remote"
        ? ["remote-checkout", "merge", "remote-pull", "remote-fetch", "remote-delete", "separator", "archive", "copy-ref"]
        : ["tag-details", "tag-delete", "tag-push", "separator", "archive", "copy-ref"];

  const items = groups.flatMap<SidebarMenuItem>((action, index) => {
    if (action === "separator") return [{ type: "separator" as const, id: `separator-${index}` }];
    if (action === "tag-details" && !ref?.annotated) return [];
    const current = ref?.type === "branch" && ref.current && ["branch-checkout", "branch-delete", "merge", "rebase"].includes(action);
    const needsRemote = ["branch-push", "tag-push"].includes(action) && remotes.length === 0;
    const unavailableRemote = ref?.type === "remote" && ["remote-checkout", "remote-pull", "remote-fetch", "remote-delete"].includes(action) && (!ref.remote || ref.symbolic);
    const needsRef = !!ref && !fullName && !["copy-ref", "filter"].includes(action);
    return [{ type: "item" as const, id: action, label: label(action), danger: ["branch-delete", "tag-delete", "remote-delete", "reset"].includes(action), disabled: !!(current || needsRemote || unavailableRemote || needsRef), onSelect: (event: { keepOpen: () => void }) => {
      if (!["copy-ref", "copy-sha", "copy-subject", "filter", "archive"].includes(action)) event.keepOpen();
      void start(action);
    } }];
  });

  const submit = async () => {
    if (!form || busy || form === "tag-details") return;
    if (form === "reset" && mode === "hard" && !hardConfirm) { setHardConfirm(true); return; }
    const body: Record<string, unknown> = { cwd, action: form };
    if (["branch-create", "tag-create", "commit-checkout", "cherry-pick", "revert", "reset"].includes(form)) body.sha = target.commit.sha;
    if (ref && !["merge", "rebase"].includes(form)) { body.ref = fullName; body.expectedTargetSha = target.commit.sha; }
    if (["branch-checkout", "commit-checkout", "cherry-pick", "revert", "merge", "rebase", "reset", "remote-checkout", "remote-pull"].includes(form)) body.expectedHead = headSha;
    if (["branch-create", "branch-rename", "tag-create", "remote-checkout", "remote-fetch"].includes(form)) body.name = name;
    if (form === "tag-create") { body.tagType = tagType; if (tagType === "annotated") body.message = message; }
    if (["merge", "rebase"].includes(form)) { body.target = fullName || target.commit.sha; body.expectedTargetSha = target.commit.sha; }
    if (["cherry-pick", "revert"].includes(form) && target.commit.parents.length > 1) body.parentNumber = Number(parentNumber);
    if (form === "reset") body.mode = mode;
    if (["branch-push", "tag-push", "remote-checkout", "remote-fetch", "remote-pull", "remote-delete"].includes(form)) body.remote = remote;
    if (form === "branch-push") body.setUpstream = setUpstream;
    setBusy(true); setError(null); setConflicts([]);
    try {
      const response = await fetch("/api/git/graph/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        if (Array.isArray(result.conflictFiles)) setConflicts(result.conflictFiles);
        if (result.code === "git_conflict" || result.code === "result_unknown") onChanged(form);
        throw new Error(result.error || t("gitGraph.action.failed"));
      }
      onChanged(form); onNotice(t("gitGraph.action.success")); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : t("gitGraph.action.failed")); }
    finally { setBusy(false); }
  };

  const needsName = form && ["branch-create", "branch-rename", "tag-create", "remote-checkout", "remote-fetch"].includes(form);
  const needsRemote = form && ["branch-push", "tag-push", "remote-checkout", "remote-fetch", "remote-pull", "remote-delete"].includes(form);
  const needsHead = form && ["branch-checkout", "commit-checkout", "cherry-pick", "revert", "merge", "rebase", "reset", "remote-checkout", "remote-pull"].includes(form);
  return <SidebarMenu open anchor={target.anchor} sheet={mobile} width={290} ariaLabel={t("gitGraph.action.menu", { target: display })} title={display} items={items} cancelLabel={t("sidebar.cancel")} focusCancel={!!form} returnFocusTo={target.opener} focusKey={form ?? "menu"} onClose={() => { if (!busy) onClose(); }}>
    {form && <div className={styles.actionForm}>
      <div className="sidebar-menu-header">{label(form)}</div>
      <p className={styles.actionTarget}>{ref ? t("gitGraph.action.target", { target: display, sha: target.commit.shortSha }) : t("gitGraph.action.targetCommit", { sha: target.commit.shortSha })}</p>
      {needsHead && <p className={styles.actionWarning}>{t("gitGraph.action.worktreeWarning", { branch: currentBranch || "HEAD", cwd })}</p>}
      {form === "commit-checkout" && <p className={styles.actionWarning}>{t("gitGraph.action.detachedWarning")}</p>}
      {form === "remote-delete" && <p className={styles.actionWarning}>{t("gitGraph.action.remoteWarning", { remote })}</p>}
      {needsName && <label>{t("gitGraph.action.name")}<input className="sidebar-worktree-input" data-sidebar-menu-autofocus="" value={name} onChange={(e) => setName(e.target.value)} /></label>}
      {form === "tag-create" && <><label>{t("gitGraph.action.tagType")}<select value={tagType} onChange={(e) => setTagType(e.target.value)}><option value="lightweight">{t("gitGraph.action.lightweight")}</option><option value="annotated">{t("gitGraph.action.annotated")}</option></select></label>{tagType === "annotated" && <label>{t("gitGraph.action.message")}<input className="sidebar-worktree-input" value={message} onChange={(e) => setMessage(e.target.value)} /></label>}</>}
      {needsRemote && <label>{t("gitGraph.action.remote")}<select value={remote} onChange={(e) => setRemote(e.target.value)} disabled={ref?.type === "remote"}>{remotes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>}
      {form === "branch-push" && <label className={styles.actionCheck}><input type="checkbox" checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)} />{t("gitGraph.action.setUpstream")}</label>}
      {form === "reset" && <><label>{t("gitGraph.action.resetMode")}<select value={mode} onChange={(e) => { setMode(e.target.value); setHardConfirm(false); }}><option value="soft">{t("gitGraph.action.soft")}</option><option value="mixed">{t("gitGraph.action.mixed")}</option><option value="hard">{t("gitGraph.action.hard")}</option></select></label>{mode === "hard" && <p className={styles.actionWarning}>{hardConfirm ? t("gitGraph.action.hardAgain") : t("gitGraph.action.hardWarning")}</p>}</>}
      {(form === "cherry-pick" || form === "revert") && target.commit.parents.length > 1 && <label>{t("gitGraph.action.mainline")}<select value={parentNumber} onChange={(e) => setParentNumber(e.target.value)}>{target.commit.parents.map((p, i) => <option key={p} value={String(i + 1)}>{i + 1}: {p.slice(0, 7)}</option>)}</select></label>}
      {form === "tag-details" && tagDetails && <pre className={styles.actionDetails}>{tagDetails.tagger}{"\n"}{tagDetails.date}{"\n\n"}{tagDetails.message}</pre>}
      {error && <div className="sidebar-worktree-error" role="alert">{error}{conflicts.length > 0 && <><ul>{conflicts.map((f) => <li key={f}>{f}</li>)}</ul><p>{t("gitGraph.action.conflictHelp", { action: form === "remote-pull" ? "merge" : form })}</p>{onOpenTerminal && <button type="button" className="sidebar-worktree-cancel" onClick={() => onOpenTerminal(cwd)}>{t("gitGraph.action.openTerminal")}</button>}</>}</div>}
      <div className="sidebar-worktree-form-buttons">
        {form !== "tag-details" && <button type="button" className={mode === "hard" && form === "reset" ? "sidebar-worktree-force" : "sidebar-worktree-create"} disabled={busy || (!!needsName && !name.trim()) || (form === "tag-create" && tagType === "annotated" && !message.trim()) || (!!needsRemote && !remote)} onClick={() => void submit()}>{busy ? t("gitGraph.action.running") : hardConfirm ? t("gitGraph.action.confirmHard") : t("gitGraph.action.confirm")}</button>}
        {!mobile && <button type="button" className="sidebar-worktree-cancel" data-sidebar-menu-autofocus={needsName ? undefined : ""} onClick={onClose}>{t("sidebar.cancel")}</button>}
      </div>
    </div>}
  </SidebarMenu>;
}
