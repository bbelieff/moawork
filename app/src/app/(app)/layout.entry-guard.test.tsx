import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(mocks.ensureApprovedWorkspaceOnEntry).toHaveBeenCalledWith(
      { requestScoped: true },
      "test-company",
    );
    expect(html).toContain("trusted-sidebar");
    expect(html).toContain("root-dashboard");
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
