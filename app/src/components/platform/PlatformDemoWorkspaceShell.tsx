import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { CsvImportDialog, type CsvRow } from "@/components/workspace-builder/CsvImportDialog";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import type { StageBoardData } from "@/lib/crm/boardData";
import type { WorkspaceOpsAction } from "@/lib/dynamic-workspace/workspace-ops-actions";
import { PlatformDemoCrm } from "./PlatformDemoCrm";
import styles from "./platform-demo.module.css";

export type DemoWorkspaceScreen = "dashboard" | "newcust" | "contract" | "work";

export type DemoWorkspaceSelection = Readonly<{
  screen: DemoWorkspaceScreen;
  boardSlug: "newcust" | "contract" | "work";
}>;

export function resolveDemoWorkspaceSelection(workspace?: string): DemoWorkspaceSelection {
  if (workspace === "newcust" || workspace === "contract" || workspace === "work") {
    return { screen: workspace, boardSlug: workspace };
  }
  return { screen: "dashboard", boardSlug: "newcust" };
}

const DEMO_ROUTES: Readonly<Record<string, { href: string; screen: DemoWorkspaceScreen } | undefined>> = {
  dash: { href: "/platform/demo", screen: "dashboard" },
  new: { href: "/platform/demo?workspace=newcust", screen: "newcust" },
  contact: { href: "/platform/demo?workspace=contract", screen: "contract" },
  work: { href: "/platform/demo?workspace=work", screen: "work" },
};

export function PlatformDemoWorkspaceShell({ activeScreen, data, importCsv }: Readonly<{
  activeScreen: DemoWorkspaceScreen;
  data: StageBoardData;
  importCsv: (boardSlug: string, rows: readonly CsvRow[], requestId: string) => Promise<WorkspaceOpsAction>;
}>) {
  return <section className={styles.workspacePreview} aria-label="데모 사용자 워크스페이스">
    <aside className={styles.workspaceSidebar}>
      <div className={styles.workspaceBrand}>
        <Logo height={28} href="/platform/demo" />
        <small>MoaWork 데모 조직 · 워크스페이스</small>
      </div>
      <div className={styles.workspaceSelector}>
        <span aria-hidden="true">M</span>
        <div><strong>MoaWork 데모 조직</strong><small>대표 · 내 회사</small></div>
        <b aria-hidden="true">⌄</b>
      </div>
      <nav className={styles.workspaceNav} aria-label="데모 워크스페이스 메뉴">
        {NAV_ITEMS.map((item) => {
          const route = DEMO_ROUTES[item.key];
          const active = route?.screen === activeScreen;
          const content = <><span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong>{!route ? <small>{item.key === "addons" ? "🔒" : "준비 중"}</small> : null}</>;
          return route
            ? <Link key={item.key} href={route.href} aria-current={active ? "page" : undefined}>{content}</Link>
            : <span key={item.key} aria-disabled="true">{content}</span>;
        })}
      </nav>
      <div className={styles.workspaceUser}><span>관</span><div><strong>관리자</strong><small>데모 전체 보기</small></div></div>
    </aside>

    <div className={styles.workspaceBody}>
      <header className={styles.workspaceToolbar}>
        <div className={styles.workspaceSearch}>🔍 업체·담당자 검색…</div>
        <button type="button" aria-label="알림" disabled>🔔</button>
        <button type="button" aria-label="화면 모드" disabled>◐</button>
        <div className={styles.workspaceAccount}><span>관</span><div><strong>관리자</strong><small>계정 및 설정</small></div><b>⌄</b></div>
      </header>
      <div className={styles.workspaceActionbar}>
        <div><strong>{activeScreen === "dashboard" ? "대시보드" : data.board.title}</strong><small>데모 워크스페이스 · 변경 내용은 실제로 저장돼요</small></div>
        <CsvImportDialog activeBoard={data.board.slug} importCsv={importCsv} />
      </div>
      <main className={styles.workspaceContent}>
        {activeScreen === "dashboard"
          ? <div className={styles.dashboardNotice}>🔒 대시보드(core.dash) — 현재 플랜에서 잠긴 기능입니다 (Phase 2)</div>
          : <PlatformDemoCrm data={data} />}
      </main>
    </div>
  </section>;
}
