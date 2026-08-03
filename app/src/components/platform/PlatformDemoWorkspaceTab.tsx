import type { ReactNode } from "react";
import type { PlatformDemoTabState } from "@/lib/platform/demo";
import { PlatformShell } from "./PlatformShell";
import styles from "./platform-demo.module.css";

export type PlatformDemoWorkspaceSurface =
  | { kind: "available"; content: ReactNode }
  | { kind: "needs-setup" }
  | { kind: "access-required" };

export function PlatformDemoWorkspaceTab({ state, workspaceSurface, selectAction, prepareAction, deploymentVersion }: {
  state: PlatformDemoTabState;
  workspaceSurface?: PlatformDemoWorkspaceSurface;
  selectAction?: (formData: FormData) => void | Promise<void>;
  prepareAction?: (formData: FormData) => void | Promise<void>;
  deploymentVersion?: string | null;
}) {
  const selected = state.kind === "ready" ? state.selectedIndex : null;
  return <PlatformShell pathname="/platform/demo" title="데모 회사" description="출시 전 기능을 실제 저장 환경에서 확인할 수 있어요." userModeAction={{ mode: "user" }}>
    {state.kind === "unavailable" ? <section className={styles.panel} aria-live="polite"><h2>데모를 연결하지 못했어요</h2><p>출시 상태를 확인한 뒤 다시 시도해 주세요.</p></section>
      : state.workspaces.length === 0 ? <section className={styles.panel} aria-live="polite"><h2>지금 확인할 수 있는 데모가 없어요</h2><p>출시 전 확인을 시작할 기능이 생기면 여기에 보여드릴게요.</p></section>
        : <section className={styles.panel} aria-labelledby="demo-tab-title">
          <div className={styles.intro}><h2 id="demo-tab-title">데모 CRM</h2><p>현재 배포된 고객·상담·업무 보드를 바로 확인하고 시험해 보세요.</p></div>
          {state.workspaces.length > 1 || selected === null ? <ul className={styles.tabs} aria-label="데모 회사 목록">{state.workspaces.map((workspace, index) => {
            const active = selected === index;
            return <li key={index}><form action={selectAction}><input type="hidden" name="demoIndex" value={index} /><button type="submit" aria-current={active ? "true" : undefined} aria-label={`데모 회사 ${index + 1} 선택`} className={active ? styles.tabActive : styles.tab} disabled={!selectAction}>데모 회사 {index + 1}<small>{workspace.releaseRing === "canary" ? "출시 전 확인 중" : "현재 운영 버전"}</small></button></form></li>;
          })}</ul> : null}
          {selected === null ? <p className={styles.hint}>사용할 데모 회사를 선택해 주세요.</p> : <>
            <div className={styles.releaseMeta} aria-label="현재 배포 버전"><span>현재 배포 버전</span><strong>{deploymentVersion ?? "확인 중"}</strong></div>
            {workspaceSurface?.kind === "available" ? workspaceSurface.content
              : workspaceSurface?.kind === "needs-setup" && prepareAction ? <div className={styles.surface} aria-live="polite"><h3>데모 CRM 준비</h3><p>첫 보드를 준비하면 바로 시작할 수 있어요.</p><form action={prepareAction}><input type="hidden" name="demoIndex" value={selected} /><button type="submit" className={styles.prepare}>데모 시작하기</button></form></div>
                : <div className={styles.surface} aria-live="polite"><h3>데모를 열지 못했어요</h3><p>승인된 데모인지 확인한 뒤 다시 시도해 주세요.</p></div>}
          </>}
        </section>}
  </PlatformShell>;
}
