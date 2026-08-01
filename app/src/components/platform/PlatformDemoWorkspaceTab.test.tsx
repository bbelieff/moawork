import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformDemoWorkspaceTab } from "./PlatformDemoWorkspaceTab";

describe("PlatformDemoWorkspaceTab", () => {
  it("keeps zero and unavailable states honest without workspace paths", () => {
    const unavailable = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "unavailable" }} />);
    const empty = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [], selectedIndex: null, tenantAccess: "request-access" }} />);
    expect(unavailable).not.toContain("/w/");
    expect(empty).toContain("열 수 있는 데모 환경이 없어요");
  });

  it("renders multiple authorized options as platform tabs, not workspace navigation", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }, { releaseRing: "canary" }], selectedIndex: 1, tenantAccess: "request-access" }} />);
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("/w/");
  });

  it("selects the sole authorized demo without exposing an identifier", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={{ kind: "ready", workspaces: [{ releaseRing: "canary" }], selectedIndex: 0, tenantAccess: "request-access" }} />);
    expect(html).toContain("데모 환경 1");
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("org_id");
    expect(html).toContain("데모 워크스페이스 접근 권한이 필요해요");
  });

  it("mounts an embedded surface only for the server-confirmed active membership", () => {
    const state = { kind: "ready" as const, workspaces: [{ releaseRing: "canary" as const }], selectedIndex: 0, tenantAccess: "active-membership" as const };
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceTab state={state} workspaceSurface={{ kind: "available", content: <p>일반 RLS 업무 화면</p> }} />);
    expect(html).toContain("일반 RLS 업무 화면");
    expect(html).not.toContain("데모 워크스페이스 접근 권한이 필요해요");
  });
});
