"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import type { WorkspaceEntryOption } from "@/lib/auth/workspace-entry-server";
import { submitWorkspaceRequest } from "@/lib/workspace-entry/contracts";
import { Badge } from "@/components/notify/Badge";
import type { BadgeState } from "@/lib/notify/types";
import styles from "./workspace-entry.module.css";
import { useTrack } from "@/lib/analytics/useTrack";

export function WorkspaceChooser({
  workspaces,
  /** 회사별 내 할 일 건수(mod.notify). 건수만 받고 내용은 받지 않는다. */
  badges,
}: {
  workspaces: WorkspaceEntryOption[];
  badges?: Record<string, BadgeState>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const track = useTrack();
  useEffect(() => {
    track("workspace_entry_state", { state: "chooser" });
  }, [track]);
  async function selectWorkspace(workspaceId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await submitWorkspaceRequest({ kind: "select_workspace", workspaceId });
      setMessage(result.message);
      if (result.ok && result.redirectTo) window.location.assign(result.redirectTo);
    } catch {
      setMessage("회사 접근을 확인할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return <main className={styles.page}><section className={`${styles.shell} ${styles.compactShell}`} aria-labelledby="workspace-chooser-title"><header className={styles.protoTop}><Logo height={28} href="/" /><span>회사 선택</span></header><div className={styles.compactHub}><div className={styles.guideHead}><span className={styles.guideAvatar} aria-hidden="true">M</span><div><strong>모아 가이드</strong><small>들어갈 수 있는 회사만 보여드려요.</small></div></div><div className={styles.bubble}><h1 id="workspace-chooser-title">들어갈 회사를 골라 주세요.</h1><small>회사를 선택할 때 접근 권한을 한 번 더 확인해요.</small></div>{message ? <p role="status" aria-live="polite" className={styles.error}>{message}</p> : null}<ul className={styles.chooserList}>{workspaces.map((workspace) => <li key={workspace.orgId}><button type="button" onClick={() => selectWorkspace(workspace.orgId)} disabled={busy}><span className={styles.workspaceMark} aria-hidden="true">{workspace.name.slice(0, 1)}</span><span><strong>{workspace.name}</strong><small>/w/{workspace.slug}</small></span>{badges?.[workspace.orgId] ? <Badge state={badges[workspace.orgId]!} label={workspace.name} /> : null}<b aria-hidden="true">→</b></button></li>)}</ul><div className={styles.quick}><Link href="/workspace-entry?mode=new">새 회사를 시작하거나 다른 회사에 합류하기</Link></div><p className={styles.safety}>최근에 이용한 회사라는 이유만으로 자동으로 들어가지는 않아요.</p></div></section></main>;
}
