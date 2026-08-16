import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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
      <SidebarNav lockedFeatures={[FEATURES.org]} badges={{ workspaceApprovals: 4 }} workspaceBasePath="/w/sample-lab" />,
    );

    const membersLink = html.match(/<a[^>]*data-nav-key="members"[^>]*>/)?.[0] ?? "";
    expect(membersLink).toContain('href="/w/sample-lab/settings/members"');
    expect(membersLink).toContain('aria-disabled="true"');
    expect(html).toContain("승인 대기 4건");
  });

  it("renders shell tabs in the verified workspace namespace", () => {
    const html = renderToStaticMarkup(
      <SidebarNav lockedFeatures={[]} workspaceBasePath="/w/sample-lab" />,
    );

    expect(html.match(/<a[^>]*data-nav-key="dash"[^>]*>/)?.[0]).toContain('href="/w/sample-lab"');
    expect(html.match(/<a[^>]*data-nav-key="notice"[^>]*>/)?.[0]).toContain('href="/w/sample-lab/notices"');
    expect(html.match(/<a[^>]*data-nav-key="company"[^>]*>/)?.[0]).toContain('href="/w/sample-lab/companies"');
    expect(html.match(/<a[^>]*data-nav-key="contact"[^>]*>/)?.[0]).toContain('href="/w/sample-lab/contract"');
  });

  it("fails closed when the server cannot verify one active workspace", () => {
    const html = renderToStaticMarkup(<SidebarNav lockedFeatures={[]} />);
    expect(html.match(/<a[^>]*data-nav-key="dash"[^>]*>/)?.[0]).toContain('href="/workspace-entry?error=routing"');
    expect(html.match(/<a[^>]*data-nav-key="notice"[^>]*>/)?.[0]).toContain('href="/workspace-entry?error=routing"');
    expect(html).not.toContain('href="/notices"');
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

  it("keeps sidebar spacing and colors on design tokens", () => {
    const source = readFileSync(new URL("./SidebarNav.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/(?:^|["' :(,])\d+(?:\.\d+)?px\b/m);
    expect(source).toContain('paddingBlock: "var(--sp-1)"');
    expect(source).toContain('paddingInline: "var(--sp-2)"');
  });
});
