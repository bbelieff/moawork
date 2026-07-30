import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FEATURES } from "@/lib/product";
import { SidebarNav } from "./SidebarNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("SidebarNav integration contract", () => {
  it("keeps a locked real route as an aria-disabled guidance link", () => {
    const html = renderToStaticMarkup(
      <SidebarNav lockedFeatures={[FEATURES.org]} badges={{ workspaceApprovals: 4 }} />,
    );

    const membersLink = html.match(/<a[^>]*data-nav-key="members"[^>]*>/)?.[0] ?? "";
    expect(membersLink).toContain('href="/settings/members"');
    expect(membersLink).toContain('aria-disabled="true"');
    expect(html).toContain("승인 대기 4건");
  });

  it("shows only a caller-supplied, safe approval count", () => {
    const visible = renderToStaticMarkup(
      <SidebarNav lockedFeatures={[]} badges={{ workspaceApprovals: 120 }} />,
    );
    const absent = renderToStaticMarkup(
      <SidebarNav lockedFeatures={[]} badges={{ workspaceApprovals: 0 }} />,
    );

    expect(visible).toContain('aria-label="승인 대기 120건"');
    expect(visible).toContain("99+");
    expect(absent).not.toContain("승인 대기");
  });

  it("renders the same server-provided switcher data before desktop-only navigation", () => {
    const html = renderToStaticMarkup(
      <SidebarNav
        lockedFeatures={[]}
        workspaceSwitcher={{
          currentOrgId: "org-a",
          workspaces: [{ orgId: "org-a", slug: "sample-lab", name: "샘플랩", role: "owner", status: "active" }],
          destinations: { createHref: "/workspace-entry?mode=new", joinHref: "/workspace-entry?mode=resume" },
          defaultOpen: true,
        }}
      />,
    );

    expect(html).toContain('data-destination="/workspace-entry?mode=new"');
    // 클래스 문자열을 통째로 고정하지 않는다 — 의도는 "메뉴가 데스크톱 전용으로 렌더된다"이고,
    // 스크롤/레이아웃 유틸이 추가돼도 깨지면 안 된다(이번에 overflow-y-auto 를 nav 로 내렸다).
    const nav = html.match(/<nav[^>]*aria-label="주요 메뉴"[^>]*>/)?.[0] ?? "";
    expect(nav).toContain("hidden");
    expect(nav).toContain("md:flex");
    // 스위처 드롭다운이 잘리지 않도록 스크롤은 nav 가 갖는다(사이드바·래퍼가 아니라).
    expect(nav).toContain("overflow-y-auto");
  });
});

describe("사이드바 플랫폼 진입점 (프로덕션 이슈 1)", () => {
  // 관리자가 회사에 소속되면 /platform 은 스위처 드롭다운을 통해서만 갈 수 있었다.
  // 드롭다운이 열리지 않으면 어드민 도달 자체가 불가 → 메뉴에 항상 보이는 링크를 둔다.
  it("서버가 확인한 관리자에게 플랫폼 관리 링크를 항상 보여준다", () => {
    const html = renderToStaticMarkup(
      <SidebarNav lockedFeatures={[]} platformHref="/platform" />,
    );
    expect(html).toContain('href="/platform"');
    expect(html).toContain("플랫폼 관리");
  });

  it("비관리자에게는 마크업에 존재하지 않는다(숨김이 아니라 부재)", () => {
    const html = renderToStaticMarkup(<SidebarNav lockedFeatures={[]} />);
    expect(html).not.toContain('href="/platform"');
    expect(html).not.toContain("플랫폼 관리");
  });

  it("스위처가 없어도(드롭다운 불가 상황) 플랫폼 링크는 살아 있다", () => {
    // 이슈 1·2 가 겹쳤을 때의 핵심 보장 — 드롭다운 고장이 어드민 차단으로 번지지 않는다.
    const html = renderToStaticMarkup(
      <SidebarNav lockedFeatures={[]} platformHref="/platform" />,
    );
    expect(html).not.toContain("회사 전환");
    expect(html).toContain('href="/platform"');
  });
});
