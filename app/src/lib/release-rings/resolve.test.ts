import { describe, expect, it } from "vitest";
import {
  isFeatureReleased,
  resolveAdminModeWorkspaceSelection,
  resolveInternalDemoOptions,
  resolveReleaseSelector,
} from "./resolve";

const orgId = "20000000-0000-4000-8000-000000000001";

function source(overrides: Record<string, unknown> = {}) {
  return {
    org_id: orgId,
    route_path: "/w/demo-workspace",
    route_authorization: "active_membership",
    release_ring: "stable",
    is_internal: false,
    internal_source: null,
    feature_releases: {},
    ...overrides,
  };
}

describe("release-ring resolver", () => {
  it("accepts an active-member stable selector and defaults missing features OFF", () => {
    const selector = resolveReleaseSelector(source());
    expect(selector).toMatchObject({
      kind: "ready",
      routePath: "/w/demo-workspace",
      routeAuthorization: "active_membership",
      releaseRing: "stable",
      isInternal: false,
    });
    expect(isFeatureReleased(selector, "developer.builder")).toBe(false);
  });

  it("accepts a reviewed internal canary and only enables explicit true flags", () => {
    const selector = resolveReleaseSelector(source({
      route_authorization: "reviewed_internal_demo",
      release_ring: "canary",
      is_internal: true,
      internal_source: "platform_reviewed_demo",
      feature_releases: {
        "developer.builder": true,
        "developer.automation": false,
      },
    }));
    expect(selector).toMatchObject({
      kind: "ready",
      routeAuthorization: "reviewed_internal_demo",
      releaseRing: "canary",
      isInternal: true,
      internalSource: "platform_reviewed_demo",
    });
    expect(isFeatureReleased(selector, "developer.builder")).toBe(true);
    expect(isFeatureReleased(selector, "developer.automation")).toBe(false);
    expect(isFeatureReleased(selector, "developer.unknown")).toBe(false);
  });

  it.each([
    source({ release_ring: "beta" }),
    source({ is_internal: true, internal_source: null }),
    source({ is_internal: false, internal_source: "platform_reviewed_demo" }),
    source({ route_authorization: "reviewed_internal_demo" }),
    source({ route_path: "/w/demo-workspace?admin=1" }),
    source({ feature_releases: { "developer.builder": "yes" } }),
  ])("fails closed for malformed or contradictory source contracts", (candidate) => {
    expect(resolveReleaseSelector(candidate)).toEqual({ kind: "unavailable" });
  });

  it("parses zero and multiple demo options in deterministic org order", () => {
    expect(resolveInternalDemoOptions([])).toEqual({ kind: "ready", options: [] });

    expect(resolveInternalDemoOptions([
      {
        org_id: "20000000-0000-4000-8000-000000000020",
        route_path: "/w/demo-two",
      },
      {
        org_id: "20000000-0000-4000-8000-000000000010",
        route_path: "/w/demo-one",
      },
    ])).toEqual({
      kind: "ready",
      options: [
        {
          orgId: "20000000-0000-4000-8000-000000000010",
          routePath: "/w/demo-one",
        },
        {
          orgId: "20000000-0000-4000-8000-000000000020",
          routePath: "/w/demo-two",
        },
      ],
    });
  });

  it("invalidates a listed internal demo when its current ring drifts to stable", () => {
    const discovered = resolveInternalDemoOptions([{
      org_id: orgId,
      route_path: "/w/demo-workspace",
    }]);
    expect(discovered).toMatchObject({ kind: "ready" });

    expect(resolveReleaseSelector(source({
      route_authorization: "reviewed_internal_demo",
      release_ring: "stable",
      is_internal: true,
      internal_source: "platform_reviewed_demo",
    }))).toEqual({ kind: "unavailable" });
  });

  it.each([
    null,
    [{ org_id: orgId, route_path: "/w/demo", label: "hidden" }],
    [{ org_id: orgId, route_path: "/w/demo?tenant=other" }],
    [
      { org_id: orgId, route_path: "/w/demo" },
      { org_id: orgId, route_path: "/w/duplicate" },
    ],
  ])("fails the entire demo list closed for missing or unsafe rows", (candidate) => {
    expect(resolveInternalDemoOptions(candidate)).toEqual({ kind: "unavailable" });
  });

  it("parses revalidated demo and active-membership selections without tenant fallback", () => {
    expect(resolveAdminModeWorkspaceSelection([{
      org_id: orgId,
      route_path: "/w/demo-workspace",
      route_authorization: "reviewed_internal_demo",
      release_ring: "canary",
    }])).toEqual({
      kind: "ready",
      orgId,
      routePath: "/w/demo-workspace",
      routeAuthorization: "reviewed_internal_demo",
      releaseRing: "canary",
    });

    expect(resolveAdminModeWorkspaceSelection({
      org_id: orgId,
      route_path: "/w/member-workspace",
      route_authorization: "active_membership",
      release_ring: "stable",
    })).toMatchObject({
      kind: "ready",
      routeAuthorization: "active_membership",
    });
  });

  it("treats a missing or no-longer-authorized persisted selection as none", () => {
    expect(resolveAdminModeWorkspaceSelection([])).toEqual({ kind: "none" });
  });

  it.each([
    null,
    [{
      org_id: orgId,
      route_path: "/w/demo-workspace",
      route_authorization: "reviewed_internal_demo",
      release_ring: "stable",
    }],
    [{
      org_id: orgId,
      route_path: "/w/demo-workspace",
      route_authorization: "reviewed_internal_demo",
      release_ring: "canary",
      workspace_name: "hidden",
    }],
    [
      {
        org_id: orgId,
        route_path: "/w/demo-workspace",
        route_authorization: "reviewed_internal_demo",
        release_ring: "canary",
      },
      {
        org_id: "20000000-0000-4000-8000-000000000002",
        route_path: "/w/other-workspace",
        route_authorization: "active_membership",
        release_ring: "stable",
      },
    ],
  ])("fails persisted selection parsing closed for unsafe server results", (candidate) => {
    expect(resolveAdminModeWorkspaceSelection(candidate)).toEqual({ kind: "unavailable" });
  });
});
