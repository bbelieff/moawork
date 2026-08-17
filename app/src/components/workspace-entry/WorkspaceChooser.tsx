"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import type { WorkspaceEntryOption } from "@/lib/auth/workspace-entry-server";
import { submitWorkspaceRequest, type WorkspaceRequestResult } from "@/lib/workspace-entry/contracts";
import { Badge } from "@/components/notify/Badge";
import type { BadgeState } from "@/lib/notify/types";
import styles from "./workspace-entry.module.css";
import { useTrack } from "@/lib/analytics/useTrack";

/** 회사 선택 결과를 화면에 어떻게 보일지. 성공/진행과 실패는 절대 같은 표현을 쓰지 않는다 (BBE-183). */
export type WorkspaceChooserNotice = { tone: "success" | "error"; text: string };

export const WORKSPACE_REQUEST_FAILED = "회사 접근을 확인할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요.";
export const WORKSPACE_REDIRECT_FAILED = "회사로 이동하지 못했어요. 다시 시도해 주세요.";

/**
 * 서버 응답 → 화면 상태. `ok` 가 유일한 판정 근거이며 문구로 성패를 추측하지 않는다.
 *
 * `ok:true` 를 전부 «성공» 으로 칠해도 되는 이유: 이 화면은 `select_workspace` 만 보내고,
 * `app/src/app/api/workspace-requests/route.ts:32-49` 의 그 분기는 조기 return 이라 RPC 경로에
 * 닿지 않는다. 따라서 여기로 오는 `ok:true` 는 `selection_revalidation` 뿐이다.
 * ★ 이 화면이 다른 kind 를 보내게 되면 `rejected`·`expired`·`cancelled` 까지 초록이 된다.
 *   그때는 state 별 tone 매핑으로 바꿔야 한다.
 */
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

/**
 * 화면이 그리는 상태 전부. 순수 뷰(`WorkspaceChooserView`)와 흐름(`runWorkspaceSelection`)으로
 * 갈라 두 쪽 다 테스트가 닿게 한다.
 */
export type WorkspaceChooserView = {
  notice: WorkspaceChooserNotice | null;
  /** 요청 중이거나 이동이 시작된 상태. 이동은 화면이 바뀔 때까지 풀지 않는다. */
  locked: boolean;
};

export const WORKSPACE_CHOOSER_IDLE: WorkspaceChooserView = { notice: null, locked: false };

/** `runWorkspaceSelection` 이 바깥세상과 닿는 지점 전부. 테스트는 여기에 가짜를 꽂는다. */
export type WorkspaceSelectionEffects = {
  getView: () => WorkspaceChooserView;
  setView: (view: WorkspaceChooserView) => void;
  submit: (workspaceId: string) => Promise<WorkspaceRequestResult>;
  assign: (url: string) => void;
};

/**
 * 회사 선택 1회의 전체 흐름. 컴포넌트는 이걸 배선만 한다.
 *
 * 흐름을 컴포넌트 밖으로 뺀 이유: 「성공 시 이동이 정확히 1회인가」·「이동 중 다시 눌러도
 * 요청이 한 번인가」는 클릭이 있어야 재는 것이라 서버 렌더만으로는 한 줄도 검사되지 않았다.
 * 이 저장소에는 DOM 테스트 환경(@testing-library/react·jsdom)이 없어, 의존성을 늘리는 대신
 * 흐름을 주입 가능한 순수 함수로 떼어냈다.
 */
export async function runWorkspaceSelection(
  workspaceId: string,
  fx: WorkspaceSelectionEffects,
): Promise<void> {
  // 이미 요청 중이거나 이동이 시작됐으면 아무것도 하지 않는다 (연타·중복 이동 차단).
  if (fx.getView().locked) return;
  fx.setView({ notice: null, locked: true });

  let result: WorkspaceRequestResult;
  try {
    result = await fx.submit(workspaceId);
  } catch {
    fx.setView({ notice: { tone: "error", text: WORKSPACE_REQUEST_FAILED }, locked: false });
    return;
  }

  const notice = workspaceSelectionNotice(result);
  if (!result.ok || !result.redirectTo) {
    // 실패는 다시 시도할 수 있어야 하므로 잠금을 푼다. 이동은 하지 않는다.
    fx.setView({ notice, locked: false });
    return;
  }

  // 이동 시작 — 화면이 바뀔 때까지 잠가 둔다.
  fx.setView({ notice, locked: true });
  try {
    fx.assign(result.redirectTo);
  } catch {
    // 이동 호출이 던지면 성공 배너를 띄운 채 영구히 잠긴 막다른 길이 된다.
    // 이 카드가 없애려던 «성공인데 오류로 보이는» 증상이 반대 모습으로 되살아나므로 되돌린다.
    fx.setView({ notice: { tone: "error", text: WORKSPACE_REDIRECT_FAILED }, locked: false });
  }
}

/** 상태를 갖지 않는 회사 선택 화면. 렌더 결과 전체가 `view` 하나로 결정된다. */
export function WorkspaceChooserView({
  workspaces,
  badges,
  view,
  onSelect,
}: {
  workspaces: WorkspaceEntryOption[];
  badges?: Record<string, BadgeState>;
  view: WorkspaceChooserView;
  onSelect: (workspaceId: string) => void;
}) {
  return <main className={styles.page}><section className={`${styles.shell} ${styles.compactShell}`} aria-labelledby="workspace-chooser-title"><header className={styles.protoTop}><Logo height={28} href="/" /><span>회사 선택</span></header><div className={styles.compactHub}><div className={styles.guideHead}><span className={styles.guideAvatar} aria-hidden="true">M</span><div><strong>모아 가이드</strong><small>들어갈 수 있는 회사만 보여드려요.</small></div></div><div className={styles.bubble}><h1 id="workspace-chooser-title">들어갈 회사를 골라 주세요.</h1><small>회사를 선택할 때 접근 권한을 한 번 더 확인해요.</small></div><WorkspaceSelectionNotice notice={view.notice} /><ul className={styles.chooserList}>{workspaces.map((workspace) => <li key={workspace.orgId}><button type="button" onClick={() => onSelect(workspace.orgId)} disabled={view.locked}><span className={styles.workspaceMark} aria-hidden="true">{workspace.name.slice(0, 1)}</span><span><strong>{workspace.name}</strong><small>/w/{workspace.slug}</small></span>{badges?.[workspace.orgId] ? <Badge state={badges[workspace.orgId]!} label={workspace.name} /> : null}<b aria-hidden="true">→</b></button></li>)}</ul><div className={styles.quick}><Link href="/workspace-entry?mode=new">새 회사를 시작하거나 다른 회사에 합류하기</Link></div><p className={styles.safety}>최근에 이용한 회사라는 이유만으로 자동으로 들어가지는 않아요.</p></div></section></main>;
}

export function WorkspaceChooser({
  workspaces,
  /** 회사별 내 할 일 건수(mod.notify). 건수만 받고 내용은 받지 않는다. */
  badges,
}: {
  workspaces: WorkspaceEntryOption[];
  badges?: Record<string, BadgeState>;
}) {
  const [view, setViewState] = useState<WorkspaceChooserView>(WORKSPACE_CHOOSER_IDLE);
  // 연타 차단은 «지금» 값을 봐야 한다. state 는 같은 tick 안에서 갱신되지 않아 ref 로 함께 들고 있다.
  const viewRef = useRef(view);
  const track = useTrack();
  useEffect(() => {
    track("workspace_entry_state", { state: "chooser" });
  }, [track]);

  function setView(next: WorkspaceChooserView) {
    viewRef.current = next;
    setViewState(next);
  }

  function onSelect(workspaceId: string) {
    void runWorkspaceSelection(workspaceId, {
      getView: () => viewRef.current,
      setView,
      submit: (id) => submitWorkspaceRequest({ kind: "select_workspace", workspaceId: id }),
      assign: (url) => window.location.assign(url),
    });
  }

  return <WorkspaceChooserView workspaces={workspaces} badges={badges} view={view} onSelect={onSelect} />;
}
