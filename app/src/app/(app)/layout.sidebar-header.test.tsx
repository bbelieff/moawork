import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BBE-194 — 사이드바 머리 회귀 방지.
//
// 총괄 피드백: 「로고랑 제품이름이 너무 작다 · 회사명이 두 번 나와 정신사납다 ·
// 검색하거나 빠르게 만들기가 왜 있는지 모르겠다」.
//
// ★ 이 파일의 각 테스트는 «무엇을 되돌리면 빨개지는가» 를 주석으로 명시한다.
//   되돌려도 초록인 테스트는 아무것도 지키지 못한다.
//
// SidebarNav 는 의도적으로 «회사명을 모르는» 대역으로 바꿔 끼운다.
// 그래야 <aside> 안에 남은 회사명이 «레이아웃 자신이 찍은 것» 임이 확정된다.
// (실제 화면에서 회사명을 그리는 주체는 SidebarNav 안의 WorkspaceSwitcher 하나뿐이어야 한다.)

const ORG_NAME = "테스트 회사";

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
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
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
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/account/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("@/components/analytics/AnalyticsIdentity", () => ({ AnalyticsIdentity: () => null }));
vi.mock("@/components/notify/NotificationBell", () => ({ NotificationBell: () => null }));
// 회사명을 모르는 사이드바 대역 — 아래 «중복» 판정의 기준점이다.
vi.mock("@/components/shell/SidebarNav", () => ({
  SidebarNav: () => createElement("nav", null, "trusted-sidebar"),
}));
// 검색 트리거는 위치를 재려는 것이므로 자리표시자로 바꾼다.
vi.mock("@/components/shell/GlobalSearch", () => ({
  GlobalSearch: () => createElement("span", null, "global-search-trigger"),
}));
// Logo 는 «모킹하지 않는다» — 렌더된 높이를 직접 재야 하기 때문이다.

import AppLayout from "./layout";

async function renderShell(): Promise<string> {
  const element = await AppLayout({ children: createElement("p", null, "page-body") });
  return renderToStaticMarkup(element);
}

/** 사이드바(<aside>…</aside>) 조각만 떼어낸다. */
function asideOf(html: string): string {
  const start = html.indexOf("<aside");
  const end = html.indexOf("</aside>");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("BBE-194 사이드바 머리", () => {
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
        name: ORG_NAME,
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
      memberships: [{ orgId: "org-owner", slug: "test-company", name: ORG_NAME, role: "owner" }],
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
  });

  // 되돌리면 빨개진다: layout.tsx 의 <small>{ctx.org.name} · 워크스페이스</small> 를 복구
  it("레이아웃이 회사명을 직접 찍지 않는다 — 회사명 주인은 WorkspaceSwitcher 하나다", async () => {
    const aside = asideOf(await renderShell());

    expect(aside).toContain("trusted-sidebar");
    // 회사명을 모르는 사이드바 대역을 끼웠으므로, 여기 회사명이 보이면 레이아웃이 찍은 것이다.
    expect(aside).not.toContain(ORG_NAME);
    // 접미사만 남기는 «반쪽 되돌리기» 도 막는다.
    expect(aside).not.toContain("워크스페이스");
  });

  // 되돌리면 빨개진다: <Logo height={40}> 을 22(또는 40 미만)로 되돌리면 실패
  it("락업 로고가 브랜드 최소 너비 120px 를 실제로 채운다", async () => {
    const aside = asideOf(await renderShell());

    const heights = [...aside.matchAll(/<img[^>]*\bheight="(\d+)"/g)].map((match) => Number(match[1]));
    expect(heights.length).toBeGreaterThan(0);

    for (const height of heights) {
      // 락업 SVG 는 viewBox 2400×800 = 3:1. 자연 너비 = height × 3.
      // design-tokens §5 「락업 최소 너비 120px」→ height 는 40 이상이어야 한다.
      // 40 미만이면 Logo 의 minWidth:120 이 가로로 잡아늘여 로고가 찌그러진다.
      expect(height * 3).toBeGreaterThanOrEqual(120);
    }
  });

  // 되돌리면 빨개진다: 상단바의 <GlobalSearch/> 를 「업체·담당자 검색…」 죽은 div 로 복구
  it("검색 트리거가 사이드바가 아니라 상단바에 있다", async () => {
    const html = await renderShell();
    const asideEnd = html.indexOf("</aside>");
    const trigger = html.indexOf("global-search-trigger");

    expect(trigger).toBeGreaterThan(-1); // 기능이 사라지지 않았다
    expect(trigger).toBeGreaterThan(asideEnd); // 그리고 사이드바 밖(상단바)에 있다
  });

  // 되돌리면 빨개진다: 누르히지 않는 「업체·담당자 검색…」 장식 div 를 상단바에 복구
  it("눌리지 않는 가짜 검색창을 상단바에 그리지 않는다", async () => {
    const html = await renderShell();
    expect(html).not.toContain("업체·담당자 검색");
  });
});
