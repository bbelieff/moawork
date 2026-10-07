import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue 849 PR2 — 셸이 사이드바에 사용자 탭·지운 기본 탭·「새 탭」 권한을 넘기는 배선.
//
// ★ 되돌리면 빨개지는 것:
//   - SidebarNav 에 userTabs/dismissedSources/canCreateTab 을 안 넘기면 → 첫 검사
//   - 권한 판정을 빼고 true 를 박으면 → 두 번째 검사
//   - 보드 읽기·권한 판정을 Promise.all 밖에서 직렬로 기다리면 → 세 번째 검사
//   - 로더나 권한 판정 실패가 셸을 죽이면 → 네 번째 검사

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadWorkspaceRoutingSnapshot: vi.fn(),
  loadWorkspaceApprovals: vi.fn(),
  loadWorkspaceEntryContext: vi.fn(),
  loadPlatformActor: vi.fn(),
  loadLockedFeatures: vi.fn(),
  loadNotifySnapshot: vi.fn(),
  createClient: vi.fn(),
  ensureApprovedWorkspaceOnEntry: vi.fn(),
  loadSidebarBoards: vi.fn(),
  loadPermGuard: vi.fn(),
  createRequestBoards: vi.fn(),
  purgeExpiredTrashedTabs: vi.fn(),
  sidebarProps: [] as Record<string, unknown>[],
  routeAppearanceProps: [] as Record<string, unknown>[],
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/auth/workspace-entry-server", () => ({
  loadWorkspaceRoutingSnapshot: mocks.loadWorkspaceRoutingSnapshot,
}));
vi.mock("@/lib/workspace-entry/server", () => ({
  loadWorkspaceApprovals: mocks.loadWorkspaceApprovals,
  loadWorkspaceEntryContext: mocks.loadWorkspaceEntryContext,
}));
vi.mock("@/lib/platform/actor", () => ({ loadPlatformActor: mocks.loadPlatformActor }));
vi.mock("@/lib/entitlements/server", () => ({ loadLockedFeatures: mocks.loadLockedFeatures }));
vi.mock("@/lib/notify/server", () => ({ loadNotifySnapshot: mocks.loadNotifySnapshot }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/workspace-entry/bootstrap", () => ({
  ensureApprovedWorkspaceOnEntry: mocks.ensureApprovedWorkspaceOnEntry,
}));
vi.mock("@/lib/shell/board-nav-map", () => ({ loadSidebarBoards: mocks.loadSidebarBoards }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.loadPermGuard }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: mocks.createRequestBoards }));
vi.mock("@/lib/boards/trash-maintenance", () => ({ purgeExpiredTrashedTabs: mocks.purgeExpiredTrashedTabs }));
vi.mock("@/lib/account/presentation", () => ({
  buildAccountViewModel: () => ({
    displayName: "대표",
    loginEmail: null,
    initial: "대",
    roleLabel: "대표",
    scopeLabel: "전체",
  }),
}));
vi.mock("@/components/shell/nav-items", () => ({ NAV_ITEMS: [] }));
vi.mock("@/components/brand/Logo", () => ({ Logo: () => null }));
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/account/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("@/components/analytics/AnalyticsIdentity", () => ({ AnalyticsIdentity: () => null }));
vi.mock("@/components/notify/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/shell/GlobalSearch", () => ({ GlobalSearch: () => null }));
vi.mock("@/components/shell/icons", () => ({ Icon: () => null, IconSprite: () => null }));
vi.mock("@/components/appearance/AppearanceControl", () => ({ AppearanceControl: () => null }));
vi.mock("@/components/appearance/RouteAppearance", () => ({
  RouteAppearance: (props: Record<string, unknown>) => {
    mocks.routeAppearanceProps.push(props);
    return null;
  },
}));
vi.mock("@/components/shell/SidebarNav", () => ({
  SidebarNav: (props: Record<string, unknown>) => {
    mocks.sidebarProps.push(props);
    return createElement("nav", null, "trusted-sidebar");
  },
}));

import AppLayout from "./layout";

const REPO = { listBoards: vi.fn(), listDefaultTabDismissals: vi.fn() };
const SIDEBAR_BOARDS = {
  boardNavKeys: { "b-work": "work", "t-1": "board:t-1" },
  userTabs: [{ id: "t-1", name: "영업 파이프라인", icon: null, navSection: "before-contract" }],
  dismissedSources: ["core.default-tab/notice"],
};

async function renderShell(): Promise<string> {
  const element = await AppLayout({ children: createElement("p", null, "page-body") });
  return renderToStaticMarkup(element);
}

describe("셸 → 사이드바 사용자 탭 배선", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarProps = [];
    mocks.routeAppearanceProps = [];
    mocks.getSession.mockResolvedValue({
      user: { id: "owner-1", email: null, name: "대표", avatar_url: null, created_at: "2026-10-06T00:00:00.000Z" },
      org: { id: "org-owner", name: "테스트 회사", plan_tier: "t1_3", created_at: "2026-10-06T00:00:00.000Z" },
      role: "owner",
      scope: "all",
      isPlatformAdmin: false,
    });
    mocks.loadWorkspaceRoutingSnapshot.mockResolvedValue({
      kind: "ready",
      selfRouteState: "eligible_entry",
      memberships: [{ orgId: "org-owner", slug: "test-company", name: "테스트 회사", role: "owner" }],
    });
    mocks.loadWorkspaceApprovals.mockResolvedValue({ pendingCount: 0 });
    mocks.loadWorkspaceEntryContext.mockResolvedValue({
      kind: "ready",
      isPlatformAdmin: false,
      requests: [],
      platformCreateRequests: [],
      ownerJoinRequests: [],
      ownerPendingApprovalCount: 0,
    });
    mocks.loadPlatformActor.mockResolvedValue({ kind: "denied" });
    mocks.loadLockedFeatures.mockResolvedValue([]);
    mocks.loadNotifySnapshot.mockResolvedValue({ sidebar: {} });
    mocks.createClient.mockResolvedValue({ requestScoped: true });
    mocks.ensureApprovedWorkspaceOnEntry.mockResolvedValue(undefined);
    mocks.createRequestBoards.mockResolvedValue({ repo: REPO });
    mocks.loadSidebarBoards.mockResolvedValue(SIDEBAR_BOARDS);
    mocks.loadPermGuard.mockResolvedValue({ kind: "allowed" });
    mocks.purgeExpiredTrashedTabs.mockResolvedValue(0);
  });

  it("한 번의 보드 읽기 결과와 탭 관리 권한을 사이드바·라우트 강조에 넘긴다", async () => {
    const html = await renderShell();

    expect(html).toContain("trusted-sidebar");
    expect(mocks.loadSidebarBoards).toHaveBeenCalledTimes(1);
    expect(mocks.loadSidebarBoards).toHaveBeenCalledWith(expect.objectContaining({ org: expect.objectContaining({ id: "org-owner" }) }), REPO);
    expect(mocks.loadPermGuard).toHaveBeenCalledWith("org-owner", "structure.tab_manage");

    const props = mocks.sidebarProps.at(-1)!;
    expect(props.boardNavKeys).toEqual(SIDEBAR_BOARDS.boardNavKeys);
    expect(props.userTabs).toEqual(SIDEBAR_BOARDS.userTabs);
    expect(props.dismissedSources).toEqual(SIDEBAR_BOARDS.dismissedSources);
    expect(props.canCreateTab).toBe(true);
    // 라우트 강조도 같은 지도를 본다 — «board:*» 는 RouteAppearance 가 기본 강조로 폴백한다.
    expect(mocks.routeAppearanceProps.at(-1)?.boardNavKeys).toEqual(SIDEBAR_BOARDS.boardNavKeys);
  });

  it.each([
    [{ kind: "denied", reason: "permission" }],
    [{ kind: "denied", reason: "unavailable" }],
  ])("권한이 없거나 확인하지 못하면 「새 탭」 을 열지 않는다 — %j", async (permission) => {
    mocks.loadPermGuard.mockResolvedValue(permission);
    await renderShell();
    expect(mocks.sidebarProps.at(-1)!.canCreateTab).toBe(false);
  });

  it("보드 읽기와 권한 판정을 같이 출발시킨다 — 한쪽을 기다렸다가 다른 쪽을 시작하지 않는다", async () => {
    let releaseBoards!: () => void;
    mocks.loadSidebarBoards.mockImplementation(() => new Promise((resolve) => {
      releaseBoards = () => resolve(SIDEBAR_BOARDS);
    }));
    const pending = renderShell();
    await vi.waitFor(() => {
      expect(mocks.loadSidebarBoards).toHaveBeenCalled();
      expect(mocks.loadPermGuard).toHaveBeenCalled();
    }, { timeout: 2000, interval: 10 });
    releaseBoards();
    expect(await pending).toContain("page-body");
  });

  it("★ 보드 저장소를 못 만들거나 권한 판정이 던져도 셸은 뜬다 — 빈 탭 목록·「새 탭」 없음", async () => {
    mocks.createRequestBoards.mockRejectedValue(new Error("no client"));
    mocks.loadPermGuard.mockRejectedValue(new Error("rpc down"));

    const html = await renderShell();

    expect(html).toContain("page-body");
    const props = mocks.sidebarProps.at(-1)!;
    expect(props.boardNavKeys).toEqual({});
    expect(props.userTabs).toEqual([]);
    expect(props.dismissedSources).toEqual([]);
    expect(props.canCreateTab).toBe(false);
  });
});
