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
});
