"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import type { WorkspaceEntryOption } from "@/lib/auth/workspace-entry-server";
import { submitWorkspaceRequest, type WorkspaceRequestResult } from "@/lib/workspace-entry/contracts";
import { Badge } from "@/components/notify/Badge";
import type { BadgeState } from "@/lib/notify/types";
import styles from "./workspace-entry.module.css";
import { useTrack } from "@/lib/analytics/useTrack";

/** 회사 선택 결과를 화면에 어떻게 보일지. 성공/진행과 실패는 절대 같은 표현을 쓰지 않는다 (BBE-183). */
export type WorkspaceChooserNotice = { tone: "success" | "error"; text: string };

/** 서버 응답 → 화면 상태. `ok` 가 유일한 판정 근거이며 문구로 성패를 추측하지 않는다. */
export function workspaceSelectionNotice(result: WorkspaceRequestResult): WorkspaceChooserNotice {
  return { tone: result.ok ? "success" : "error", text: result.message };
}

/** 성공은 status(polite), 실패는 alert(assertive). 뒤바뀌면 오류가 조용히 지나간다. */
export function workspaceNoticeRole(tone: WorkspaceChooserNotice["tone"]): "status" | "alert" {
  return tone === "error" ? "alert" : "status";
}

/**
 * 결과 배너. 색·아이콘·live region 을 tone 하나로 함께 결정한다.
 *
 * 왜 별도 컴포넌트인가: 이 매핑이 BBE-183 의 버그 지점이다. 배너는 요청이 끝난 뒤에만
 * 나타나서 `WorkspaceChooser` 를 그대로 렌더해서는 검사할 수 없었고, 그래서 회귀가
 * 테스트를 그냥 통과했다. 여기로 떼어 두면 성공 배너에 오류 스타일이 붙는 순간
 * 테스트가 실패한다.
 */
export function WorkspaceSelectionNotice({ notice }: { notice: WorkspaceChooserNotice | null }) {
  if (!notice) return null;
  const isError = notice.tone === "error";
  return (
    <p
      role={workspaceNoticeRole(notice.tone)}
      aria-live={isError ? "assertive" : "polite"}
      className={isError ? styles.error : styles.status}
      data-tone={notice.tone}
    >
      <span aria-hidden="true">{isError ? "!" : "✓"}</span> {notice.text}
    </p>
  );
}

export function WorkspaceChooser({
  workspaces,
  /** 회사별 내 할 일 건수(mod.notify). 건수만 받고 내용은 받지 않는다. */
  badges,
}: {
  workspaces: WorkspaceEntryOption[];
  badges?: Record<string, BadgeState>;
}) {
  /** 성공/진행과 실패는 색·아이콘·live region 이 서로 달라야 한다 (BBE-183). */
  const [notice, setNotice] = useState<WorkspaceChooserNotice | null>(null);
  const [busy, setBusy] = useState(false);
  /** 이동이 시작되면 화면이 바뀔 때까지 버튼을 다시 열지 않는다. */
  const [redirecting, setRedirecting] = useState(false);
  const track = useTrack();
  useEffect(() => {
    track("workspace_entry_state", { state: "chooser" });
  }, [track]);
  async function selectWorkspace(workspaceId: string) {
    if (busy || redirecting) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({ kind: "select_workspace", workspaceId });
      setNotice(workspaceSelectionNotice(result));
      if (result.ok && result.redirectTo) {
        setRedirecting(true);
        window.location.assign(result.redirectTo);
      }
    } catch {
      setNotice({ tone: "error", text: "회사 접근을 확인할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }
  return <main className={styles.page}><section className={`${styles.shell} ${styles.compactShell}`} aria-labelledby="workspace-chooser-title"><header className={styles.protoTop}><Logo height={28} href="/" /><span>회사 선택</span></header><div className={styles.compactHub}><div className={styles.guideHead}><span className={styles.guideAvatar} aria-hidden="true">M</span><div><strong>모아 가이드</strong><small>들어갈 수 있는 회사만 보여드려요.</small></div></div><div className={styles.bubble}><h1 id="workspace-chooser-title">들어갈 회사를 골라 주세요.</h1><small>회사를 선택할 때 접근 권한을 한 번 더 확인해요.</small></div><WorkspaceSelectionNotice notice={notice} /><ul className={styles.chooserList}>{workspaces.map((workspace) => <li key={workspace.orgId}><button type="button" onClick={() => selectWorkspace(workspace.orgId)} disabled={busy || redirecting}><span className={styles.workspaceMark} aria-hidden="true">{workspace.name.slice(0, 1)}</span><span><strong>{workspace.name}</strong><small>/w/{workspace.slug}</small></span>{badges?.[workspace.orgId] ? <Badge state={badges[workspace.orgId]!} label={workspace.name} /> : null}<b aria-hidden="true">→</b></button></li>)}</ul><div className={styles.quick}><Link href="/workspace-entry?mode=new">새 회사를 시작하거나 다른 회사에 합류하기</Link></div><p className={styles.safety}>최근에 이용한 회사라는 이유만으로 자동으로 들어가지는 않아요.</p></div></section></main>;
}
