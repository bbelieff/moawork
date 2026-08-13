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
    expect(html).toContain('class="hidden min-h-0 flex-1 flex-col gap-px overflow-y-auto md:flex"');
    expect(html).not.toContain("관리자 모드로");
    expect(html).not.toContain('action="/mode/preference"');
  });

  it("renders the current mode-preference action only with a server-confirmed platform capability", () => {
    const html = renderToStaticMarkup(
      <SidebarNav
        lockedFeatures={[]}
        workspaceSwitcher={{
          currentOrgId: "org-a",
          workspaces: [{ orgId: "org-a", slug: "sample-lab", name: "샘플랩", role: "owner", status: "active" }],
          destinations: {
            createHref: "/workspace-entry?mode=new",
            joinHref: "/workspace-entry?mode=resume",
            platformHref: "/platform",
          },
          serverConfirmedCanAccessPlatform: true,
          defaultOpen: true,
        }}
      />,
    );

    expect(html).toContain("관리자 모드로");
    expect(html).toContain('action="/mode/preference"');
    expect(html).toContain('name="mode" value="platform"');
    expect(html).toContain('name="next" value="/platform"');
    expect(html).not.toContain('href="/platform"');
  });

  it("renders the D05 hierarchy and keeps coming-soon items collapsed by default", () => {
    const html = renderToStaticMarkup(<SidebarNav lockedFeatures={[]} />);

    for (const label of ["종합", "업무", "계약 전", "계약 후", "설정"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('<details data-nav-section="coming-soon">');
    expect(html).not.toContain('<details data-nav-section="coming-soon" open="">');
    expect(html).toContain("신규리드 관리");
    expect(html).toContain("리드컨택 관리");
    expect(html).toContain("계약업체 실무");
    expect(html).toContain("업체관리 현황");
  });
});
