import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformDemoWorkspaceTab } from "./PlatformDemoWorkspaceTab";

describe("PlatformDemoWorkspaceTab", () => {
  it("keeps unavailable and empty states honest", () => {
    const unavailable = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "unavailable" }} />);
    const empty = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [], selectedIndex: null, tenantAccess: "request-access", selectedWorkspaceIsCurrent: false }} />);
    expect(unavailable).toContain("데모 환경을 연결할 수 없어요");
    expect(empty).toContain("사용 가능한 데모 환경이 없어요");
    expect(unavailable + empty).not.toContain("/w/");
  });

  it("hides workspace selection chrome when only one demo exists", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }], selectedIndex: 0, tenantAccess: "active-membership", selectedWorkspaceIsCurrent: true }} workspaceSurface={{ kind: "available", content: <p>CRM content</p> }} deploymentVersion="abcdef1" />);
    expect(html).toContain("CRM content");
    expect(html).toContain("abcdef1");
    expect(html).not.toContain("데모 환경 1 선택");
    expect(html).not.toContain("org_id");
  });

  it("retains a server-index selection for multiple authorized demos", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }, { releaseRing: "stable" }], selectedIndex: 1, tenantAccess: "request-access", selectedWorkspaceIsCurrent: false }} />);
    expect(html).toContain('name="demoIndex"');
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("org_id");
  });
});
