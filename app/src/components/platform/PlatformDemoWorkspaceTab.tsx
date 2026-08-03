import type { ReactNode } from "react";
import { PlatformShell } from "./PlatformShell";
import styles from "./platform-demo.module.css";
import type { PlatformDemoTabState } from "@/lib/platform/demo";

/**
 * T07's 022 server selection contract may supply this only after it confirms
 * an active org_members membership. This presentation component never makes
 * that decision and never changes mw_org.
 */
export type PlatformDemoWorkspaceSurface =
  | { kind: "available"; content: ReactNode }
  | { kind: "needs-setup" }
  | { kind: "access-required" };

/** A later server-authorized CRUD surface is mounted here, never via /w/{slug}. */
export function PlatformDemoWorkspaceTab({
  state,
  workspaceSurface,
  selectAction,
  prepareAction,
  deploymentVersion,
}: {
  state: PlatformDemoTabState;
  workspaceSurface?: PlatformDemoWorkspaceSurface;
  selectAction?: (formData: FormData) => void | Promise<void>;
  prepareAction?: (formData: FormData) => void | Promise<void>;
  deploymentVersion?: string | null;
}) {
  const selected = state.kind === "ready" ? state.selectedIndex : null;
  return (
    <PlatformShell pathname="/platform/demo" title="데모 회사" description="출시 전 기능을 실제 저장 환경에서 확인할 수 있어요." userModeAction={{ mode: "user" }}>
      {state.kind === "unavailable" ? <section className={styles.panel} aria-live="polite"><h2>데모 환경을 지금 연결할 수 없어요</h2><p>권한과 릴리스 상태를 다시 확인한 뒤 표시해요. 다른 워크스페이스 정보는 보여주지 않아요.</p></section>
        : state.workspaces.length === 0 ? <section className={styles.panel} aria-live="polite"><h2>지금 확인할 수 있는 데모가 없어요</h2><p>출시 전 확인을 시작할 수 있는 기능이 생기면 여기에 보여드릴게요.</p></section>
          : <section className={styles.panel} aria-labelledby="demo-tab-title">
            <div className={styles.intro}><h2 id="demo-tab-title">기능 확인용 데모</h2><p>출시를 준비 중인 기능을 확인하고, 문제가 없는지 미리 시험해 보세요.</p></div>
            <ul className={styles.tabs} aria-label="데모 워크스페이스 목록">
              {state.workspaces.map((workspace, index) => {
                const active = selected === index;
                return (
                  <li key={index}>
                    <form action={selectAction}>
                      <input type="hidden" name="demoIndex" value={index} />
                      <button
                        type="submit"
                        aria-current={active ? "true" : undefined}
                        aria-label={`데모 환경 ${index + 1} 선택`}
                        className={active ? styles.tabActive : styles.tab}
                        disabled={!selectAction}
                      >
                        데모 환경 {index + 1}
                        <small>{workspace.releaseRing === "canary" ? "출시 전 확인 중" : "현재 운영 버전"}</small>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
            {selected === null ? <p className={styles.hint}>선택된 데모 환경이 없어요. 서버에서 검토한 선택이 생기면 이 탭에 표시해요.</p>
              : <>
                <div className={styles.releaseMeta} aria-label="적용 대기 배포 버전">
                  <span>적용 대기 버전</span>
                  <strong>{deploymentVersion ?? "확인 중"}</strong>
                  <small>출시 전 확인 중</small>
                </div>
                {state.tenantAccess === "active-membership" && workspaceSurface?.kind === "available" ? workspaceSurface.content
                  : state.tenantAccess === "active-membership" && workspaceSurface?.kind === "needs-setup" && prepareAction ? <div className={styles.surface} aria-live="polite"><h3>데모 환경 {selected + 1}</h3><p>실험용 DB 공간이 비어 있어요.</p><form action={prepareAction}><input type="hidden" name="demoIndex" value={selected} /><button type="submit" className={styles.prepare}>데모 공간 준비하기</button></form></div>
                    : <div className={styles.surface} aria-live="polite"><h3>데모를 열 수 없어요</h3><p>선택한 데모의 접근 설정을 확인해 주세요.</p><p>안전을 위해 권한이 확인되기 전에는 데모 데이터를 보여주지 않아요.</p></div>}
              </>}
          </section>}
    </PlatformShell>
  );
}
