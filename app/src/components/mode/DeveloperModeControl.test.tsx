import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeveloperModeControl, DeveloperModeDemoOptionView, resolveDemoWorkspaceOption } from "./DeveloperModeControl";

describe("DeveloperModeControl", () => {
  it("does not render an administrator entry for ordinary users", () => {
    expect(renderToStaticMarkup(<DeveloperModeControl mode="user" action={{ mode: "platform", next: "/platform" }} />)).toBe("");
  });

  it("renders the user-side entry only from a server-confirmed capability", () => {
    const html = renderToStaticMarkup(<DeveloperModeControl mode="user" serverConfirmedPlatform action={{ mode: "platform", next: "/platform" }} />);
    expect(html).toContain("관리자 모드로");
    expect(html).toContain('action="/mode"');
    expect(html).toContain('name="mode" value="platform"');
  });

  it("keeps platform identity visible and accepts a trusted return seam", () => {
    const html = renderToStaticMarkup(<DeveloperModeControl mode="platform" action={{ mode: "user" }} />);
    expect(html).toContain("관리자 모드");
    expect(html).toContain("사용자 모드로");
  });

  it("uses a demo workspace path only when the server authorization is explicit", () => {
    expect(resolveDemoWorkspaceOption({ route_path: "/w/sample-workspace", route_authorization: "active_membership" })).toEqual({ kind: "available", href: "/w/sample-workspace" });
    expect(resolveDemoWorkspaceOption({ route_path: "/w/sample-workspace", route_authorization: "reviewed_internal_demo", release_ring: "canary", is_internal: true, feature_releases: { platform_reviewed_demo: true } })).toEqual({ kind: "available", href: "/w/sample-workspace" });
    expect(resolveDemoWorkspaceOption({ route_path: "/w/sample-workspace", route_authorization: "reviewed_internal_demo", release_ring: "stable", is_internal: true, feature_releases: { platform_reviewed_demo: true } })).toEqual({ kind: "request-access" });
    expect(resolveDemoWorkspaceOption({ route_path: "/w/sample-workspace", route_authorization: "reviewed_internal_demo", release_ring: "canary", is_internal: true, feature_releases: {} })).toEqual({ kind: "request-access" });
  });

  it("renders a safe unavailable demo state without forming a slug", () => {
    const html = renderToStaticMarkup(<DeveloperModeDemoOptionView selector={{ route_authorization: "reviewed_internal_demo", feature_releases: { platform_reviewed_demo: true } }} />);
    expect(html).toContain("데모 워크스페이스는 현재 사용할 수 없어요.");
    expect(html).not.toContain('href="/w/');
  });
});
