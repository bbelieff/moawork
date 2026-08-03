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
  return <PlatformShell pathname="/platform/demo" title="데모 워크스페이스" description="현재 배포된 CRM을 실제 저장되는 샌드박스에서 확인하세요." userModeAction={{ mode: "user" }}>
    {state.kind === "unavailable" ? <section className={styles.panel} aria-live="polite"><h2>데모 환경을 연결할 수 없어요</h2><p>권한과 릴리스 상태를 다시 확인해 주세요.</p></section>
      : state.workspaces.length === 0 ? <section className={styles.panel} aria-live="polite"><h2>사용 가능한 데모 환경이 없어요</h2><p>검토가 완료된 데모 환경이 생기면 여기에 표시됩니다.</p></section>
        : <section className={styles.panel} aria-labelledby="demo-tab-title">
          <div className={styles.intro}><h2 id="demo-tab-title">데모 CRM</h2><p>복잡한 설정 없이 현재 배포된 고객·컨택·업무 보드를 바로 사용합니다.</p></div>
          {state.workspaces.length > 1 ? <ul className={styles.tabs} aria-label="데모 워크스페이스 목록">{state.workspaces.map((workspace, index) => {
            const active = selected === index;
            return <li key={index}><form action={selectAction}><input type="hidden" name="demoIndex" value={index} /><button type="submit" aria-current={active ? "true" : undefined} aria-label={`데모 환경 ${index + 1} 선택`} className={active ? styles.tabActive : styles.tab} disabled={!selectAction}>데모 환경 {index + 1}<small>{workspace.releaseRing === "canary" ? "Canary" : "Stable"}</small></button></form></li>;
          })}</ul> : null}
          {selected === null ? <p className={styles.hint}>사용할 데모 환경을 선택해 주세요.</p> : <>
            <div className={styles.releaseMeta} aria-label="현재 배포 버전"><span>현재 배포 버전</span><strong>{deploymentVersion ?? "확인 중"}</strong></div>
            {state.tenantAccess === "active-membership" && workspaceSurface?.kind === "available" ? workspaceSurface.content
              : state.tenantAccess === "active-membership" && workspaceSurface?.kind === "needs-setup" && prepareAction ? <div className={styles.surface} aria-live="polite"><h3>데모 CRM 준비</h3><p>샌드박스의 첫 보드를 준비하면 CRM을 바로 사용할 수 있어요.</p><form action={prepareAction}><input type="hidden" name="demoIndex" value={selected} /><button type="submit" className={styles.prepare}>데모 공간 준비하기</button></form></div>
                : <div className={styles.surface} aria-live="polite"><h3>접근 권한이 필요해요</h3><p>선택한 데모 환경의 활성 멤버십을 확인해 주세요. 다른 워크스페이스 주소로 이동하거나 권한을 새로 만들지는 않습니다.</p></div>}
          </>}
        </section>}
  </PlatformShell>;
}
