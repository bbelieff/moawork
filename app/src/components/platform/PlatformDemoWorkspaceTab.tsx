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
  | { kind: "access-required" };

/** A later server-authorized CRUD surface is mounted here, never via /w/{slug}. */
export function PlatformDemoWorkspaceTab({
  state,
  workspaceSurface,
}: {
  state: PlatformDemoTabState;
  workspaceSurface?: PlatformDemoWorkspaceSurface;
}) {
  const selected = state.kind === "ready" ? state.selectedIndex : null;
  return (
    <PlatformShell pathname="/platform/demo" title="데모 워크스페이스" description="검토된 내부 데모 환경만 관리자 모드 안에서 확인해요." userModeAction={{ mode: "user" }}>
      {state.kind === "unavailable" ? <section className={styles.panel} aria-live="polite"><h2>데모 환경을 지금 연결할 수 없어요</h2><p>권한과 릴리스 상태를 다시 확인한 뒤 표시해요. 다른 워크스페이스 정보는 보여주지 않아요.</p></section>
        : state.workspaces.length === 0 ? <section className={styles.panel} aria-live="polite"><h2>열 수 있는 데모 환경이 없어요</h2><p>검토를 마친 Canary 환경이 생기면 여기에 표시해요.</p></section>
          : <section className={styles.panel} aria-labelledby="demo-tab-title">
            <div className={styles.intro}><h2 id="demo-tab-title">내부 데모 환경</h2><p>Canary는 검토 중인 내부 환경이에요. Stable은 활성 멤버십이 확인된 경우에만 이 탭 안에서 볼 수 있어요.</p></div>
            <ul className={styles.tabs} aria-label="데모 워크스페이스 목록">
              {state.workspaces.map((workspace, index) => {
                const active = selected === index;
                return <li key={index} aria-current={active ? "true" : undefined} className={active ? styles.tabActive : styles.tab}>데모 환경 {index + 1}<small>{workspace.releaseRing === "canary" ? "Canary" : "Stable"}</small></li>;
              })}
            </ul>
            {selected === null ? <p className={styles.hint}>선택된 데모 환경이 없어요. 서버에서 검토한 선택이 생기면 이 탭에 표시해요.</p>
              : state.tenantAccess === "active-membership" && workspaceSurface?.kind === "available" ? workspaceSurface.content
                : <div className={styles.surface} aria-live="polite"><h3>데모 환경 {selected + 1}</h3><p>데모 워크스페이스 접근 권한이 필요해요</p><p>활성 멤버십과 일반 RLS가 다시 확인되면 실제 업무 화면이 이 탭 안에서 열려요. 워크스페이스 주소로 이동하거나 권한을 새로 만들지 않아요.</p></div>}
          </section>}
    </PlatformShell>
  );
}
