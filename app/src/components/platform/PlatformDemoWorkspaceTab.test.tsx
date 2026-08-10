import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformDemoWorkspaceTab } from "./PlatformDemoWorkspaceTab";

describe("PlatformDemoWorkspaceTab", () => {
  it("shows clear unavailable and empty states", () => {
    expect(renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "unavailable" }} />)).toContain("데모를 연결하지 못했어요");
    expect(renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [], selectedIndex: null, tenantAccess: "request-access", selectedWorkspaceIsCurrent: false }} />)).toContain("지금 확인할 수 있는 데모가 없어요");
  });

  it("shows the selected demo to an authorized service administrator without tenant membership copy", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }], selectedIndex: 0, tenantAccess: "request-access", selectedWorkspaceIsCurrent: false }} workspaceSurface={{ kind: "available", content: <p>CRM 내용</p> }} deploymentVersion="abcdef1" />);
    expect(html).toContain("CRM 내용");
    expect(html).toContain("abcdef1");
    expect(html).not.toContain('name="demoIndex"');
    expect(html).not.toContain("멤버십");
    expect(html).not.toContain("org_id");
  });

  it("keeps a selectable server index when the only demo has not been selected yet", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }], selectedIndex: null, tenantAccess: "request-access", selectedWorkspaceIsCurrent: false }} selectAction={() => undefined} />);
    expect(html).toContain('name="demoIndex"');
    expect(html).toContain('value="0"');
    expect(html).toContain("데모 회사 1 선택");
    expect(html).toContain("사용할 데모 회사를 선택해 주세요.");
    expect(html).not.toContain("org_id");
  });

  it("keeps server-index selection for multiple demos", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }, { releaseRing: "stable" }], selectedIndex: 1, tenantAccess: "request-access", selectedWorkspaceIsCurrent: false }} />);
    expect(html).toContain('name="demoIndex"');
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("org_id");
  });
});
