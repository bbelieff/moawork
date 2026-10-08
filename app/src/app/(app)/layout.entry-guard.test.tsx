import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasRecentCleanBootstrap: vi.fn(() => false),
  deferBootstrapCheck: vi.fn(() => true),
  markBootstrapChecked: vi.fn(),
  forgetBootstrapOutcome: vi.fn(),
  getSession: vi.fn(),
  loadWorkspaceRoutingSnapshot: vi.fn(),
  loadWorkspaceApprovals: vi.fn(),
  loadWorkspaceEntryContext: vi.fn(),
  loadPlatformActor: vi.fn(),
  loadLockedFeatures: vi.fn(),
  loadNotifySnapshot: vi.fn(),
  createClient: vi.fn(),
  ensureApprovedWorkspaceOnEntry: vi.fn(),
  requestHeader: { value: null as string | null },
  resolveExistingContactBoard: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => mocks.requestHeader.value }) }));
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
vi.mock("@/lib/workspace-entry/bootstrap-verdict", () => ({
  hasRecentCleanBootstrap: mocks.hasRecentCleanBootstrap,
  deferBootstrapCheck: mocks.deferBootstrapCheck,
  markBootstrapChecked: mocks.markBootstrapChecked,
  forgetBootstrapOutcome: mocks.forgetBootstrapOutcome,
}));
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
vi.mock("@/components/shell/SidebarNav", () => ({
  SidebarNav: () => createElement("nav", null, "trusted-sidebar"),
}));
vi.mock("@/components/shell/icons", () => ({ Icon: () => null, IconSprite: () => null }));
vi.mock("@/components/shell/GlobalSearch", () => ({ GlobalSearch: () => null }));
vi.mock("@/components/account/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("@/components/analytics/AnalyticsIdentity", () => ({ AnalyticsIdentity: () => null }));
vi.mock("@/components/notify/NotificationBell", () => ({ NotificationBell: () => null }));
// AppTabsLayoutData 목은 없앴다 — 2026-08-25 가로 탭 줄과 함께 그 공급자도 사라졌다.
// contact/entry 목은 «되살아나지 않았는지» 를 재기 위해 남긴다(위 테스트가 not.toHaveBeenCalled 로 본다).
vi.mock("@/lib/contact/entry", () => ({ resolveExistingContactBoard: mocks.resolveExistingContactBoard }));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({ SupabaseBoardsRepo: class { constructor(public client: unknown) {} } }));
// Issue 849 — 「새 탭」 권한 판정. 실제 판정기는 Supabase 없는 개발 모드에서 세션을 한 번 더 읽어
// 위 «getSession 한 번» 검사를 흐린다(운영에서는 RPC 만 부른다). 배선은 layout.sidebar-tabs.test 가 잰다.
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: vi.fn(async () => ({ kind: "allowed" })) }));

import AppLayout from "./layout";

describe("BBE-139 root entry guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: {
        id: "owner-1",
        email: null,
        name: "대표",
        avatar_url: null,
        created_at: "2026-08-12T00:00:00.000Z",
      },
      org: {
        id: "org-owner",
        name: "테스트 회사",
        plan_tier: "t1_3",
        created_at: "2026-08-12T00:00:00.000Z",
      },
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
    mocks.requestHeader.value = null;
    mocks.resolveExistingContactBoard.mockResolvedValue({ kind: "ready", boardId: "contact-board" });
  });

  it("renders the root app shell for an owner with an active membership", async () => {
    const element = await AppLayout({
      children: createElement("p", null, "root-dashboard"),
    });
    const html = renderToStaticMarkup(element);

    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.loadWorkspaceRoutingSnapshot).toHaveBeenCalledOnce();
    expect(mocks.createClient).toHaveBeenCalledWith({ noStore: true });
    // Issue 857 — 이 요청에서 검증된 세션을 그대로 넘겨 점검이 getUser·회사·멤버십을 다시 읽지 않는다.
    const sessionCtx = await mocks.getSession.mock.results[0].value;
    expect(mocks.ensureApprovedWorkspaceOnEntry).toHaveBeenCalledWith(
      { requestScoped: true },
      "test-company",
      { ctx: sessionCtx },
    );
    // 앞에서 통과한 점검을 기억해야 다음 화면부터 미룰 수 있다.
    expect(mocks.markBootstrapChecked).toHaveBeenCalledWith(sessionCtx.org.id, sessionCtx.user.id);
    expect(html).toContain("trusted-sidebar");
    expect(html).toContain("root-dashboard");
  });

  it("Issue 857 — 셸 읽기를 기본 탭 점검과 같이 출발시킨다", async () => {
    let releaseBootstrap!: () => void;
    mocks.ensureApprovedWorkspaceOnEntry.mockImplementation(() => new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    }));
    const pending = AppLayout({ children: createElement("p", null, "overlapped-shell") });
    // 점검이 끝나기 전에 알림 읽기가 출발해야 한다 — 직렬이면 점검이 풀릴 때까지 시작되지 않는다.
    await vi.waitFor(() => {
      expect(mocks.loadNotifySnapshot).toHaveBeenCalled();
    }, { timeout: 2000, interval: 10 });
    releaseBootstrap();
    expect(renderToStaticMarkup(await pending)).toContain("overlapped-shell");
  });

  it("Issue 857 — 최근 점검을 통과했으면 이번 화면은 점검을 기다리지 않고 응답 뒤로 미룬다", async () => {
    mocks.hasRecentCleanBootstrap.mockReturnValueOnce(true);
    mocks.ensureApprovedWorkspaceOnEntry.mockImplementation(() => new Promise<void>(() => {}));
    const html = renderToStaticMarkup(await AppLayout({ children: createElement("p", null, "deferred-check") }));
    expect(html).toContain("deferred-check");
    expect(mocks.deferBootstrapCheck).toHaveBeenCalledTimes(1);
    expect(mocks.ensureApprovedWorkspaceOnEntry).not.toHaveBeenCalled();
    // 미룬 점검은 앞 점검과 같은 요청 클라이언트·회사·검증된 세션으로 돈다.
    const sessionCtx = await mocks.getSession.mock.results[0].value;
    const deferredCheck = (mocks.deferBootstrapCheck.mock.calls[0] as unknown[])[2] as () => Promise<unknown>;
    mocks.ensureApprovedWorkspaceOnEntry.mockResolvedValueOnce("clean");
    await deferredCheck();
    expect(mocks.ensureApprovedWorkspaceOnEntry).toHaveBeenCalledWith(
      { requestScoped: true },
      "test-company",
      { ctx: sessionCtx },
    );
    mocks.hasRecentCleanBootstrap.mockReturnValue(false);
  });

  it("Issue 857 — 미룰 곳이 없으면(요청 밖) 지금처럼 앞에서 점검하고 기억한다", async () => {
    mocks.hasRecentCleanBootstrap.mockReturnValueOnce(true);
    mocks.deferBootstrapCheck.mockReturnValueOnce(false);
    const html = renderToStaticMarkup(await AppLayout({ children: createElement("p", null, "blocking-check") }));
    expect(html).toContain("blocking-check");
    expect(mocks.ensureApprovedWorkspaceOnEntry).toHaveBeenCalledTimes(1);
    expect(mocks.markBootstrapChecked).toHaveBeenCalledTimes(1);
    mocks.hasRecentCleanBootstrap.mockReturnValue(false);
  });

  it("Issue 857 — 앞에서 점검이 실패하면 기억을 지우고 «준비 못 함» 으로 닫는다", async () => {
    mocks.ensureApprovedWorkspaceOnEntry.mockRejectedValueOnce(new Error("unavailable"));
    const html = renderToStaticMarkup(await AppLayout({ children: createElement("p", null, "never") }));
    expect(html).not.toContain("never");
    expect(mocks.forgetBootstrapOutcome).toHaveBeenCalled();
    expect(mocks.markBootstrapChecked).not.toHaveBeenCalled();
  });

  it("starts the session and the routing snapshot together, not in series", async () => {
    let snapshotStarted = false;
    mocks.loadWorkspaceRoutingSnapshot.mockImplementation(async () => {
      snapshotStarted = true;
      return {
        kind: "ready",
        selfRouteState: "eligible_entry",
        memberships: [{ orgId: "org-owner", slug: "test-company", name: "테스트 회사", role: "owner" }],
      };
    });
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    mocks.getSession.mockImplementation(() =>
      sessionGate.then(() => ({
        user: {
          id: "owner-1",
          email: null,
          name: "대표",
          avatar_url: null,
          created_at: "2026-08-12T00:00:00.000Z",
        },
        org: {
          id: "org-owner",
          name: "테스트 회사",
          plan_tier: "t1_3",
          created_at: "2026-08-12T00:00:00.000Z",
        },
        role: "owner",
        scope: "all",
        isPlatformAdmin: false,
      })),
    );

    const pending = AppLayout({ children: createElement("p", null, "parallel-shell") });
    // 세션이 끝나기 전에 라우팅 스냅샷이 출발해야 한다 — 직렬 코드라면
    // getSession 이 풀리기 전까지 스냅샷은 절대 시작되지 않는다.
    await vi.waitFor(() => {
      expect(snapshotStarted).toBe(true);
    }, { timeout: 2000, interval: 10 });
    releaseSession();
    const html = renderToStaticMarkup(await pending);
    expect(html).toContain("trusted-sidebar");
    expect(html).toContain("parallel-shell");
  });

  it("does not bootstrap for a non-owner membership", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member-1", email: null, name: "Member", avatar_url: null, created_at: "2026-08-12T00:00:00.000Z" },
      org: { id: "org-owner", name: "Test", plan_tier: "t1_3", created_at: "2026-08-12T00:00:00.000Z" },
      role: "member",
      scope: "assigned",
      isPlatformAdmin: false,
    });
    mocks.loadWorkspaceRoutingSnapshot.mockResolvedValue({
      kind: "ready",
      memberships: [{ orgId: "org-owner", slug: "test-company", name: "Test", role: "member" }],
    });

    await AppLayout({ children: createElement("p", null, "member-dashboard") });

    expect(mocks.ensureApprovedWorkspaceOnEntry).not.toHaveBeenCalled();
  });

  // 2026-08-25 — 계약이 «뒤집혔다». 전에는 앱탭 요청에서 리드컨택 보드 주소를 조회해
  //   가로 탭 줄에 넘겼다. 총괄 지시로 그 줄을 없앴고, 그 값을 쓰는 곳이 사라졌다.
  //   그래서 이제는 «조회하지 않는 것» 이 맞다 — 탭 화면을 열 때마다 돌던 읽기 한 번이 준다.
  //   지킬 값은 남는다: 앱탭 요청에서 요청 클라이언트를 «한 번만» 만들어 재사용한다.
  it("앱탭 요청에서 요청 클라이언트를 한 번만 만들고, 없어진 리드컨택 조회를 다시 하지 않는다", async () => {
    mocks.requestHeader.value = "1";
    const element = await AppLayout({ children: createElement("p", null, "tab") });
    const html = renderToStaticMarkup(element);
    expect(mocks.createClient.mock.calls.filter(([options]) => options?.noStore === true)).toHaveLength(1);
    expect(mocks.resolveExistingContactBoard, "쓰는 곳이 없는 조회가 되살아났다").not.toHaveBeenCalled();
    expect(html).toContain("tab");
  });

  it("fails explicitly without rendering children when bootstrap is unavailable", async () => {
    mocks.ensureApprovedWorkspaceOnEntry.mockRejectedValue(new Error("unavailable"));

    const element = await AppLayout({ children: createElement("p", null, "false-empty-dashboard") });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("회사 기본 구조를 불러오지 못했습니다");
    expect(html).toContain("/w/test-company");
    expect(html).not.toContain("false-empty-dashboard");
  });
});
