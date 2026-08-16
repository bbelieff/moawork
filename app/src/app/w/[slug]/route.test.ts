import { describe, expect, it } from "vitest";
import { handleWorkspaceTarget } from "./route";

const request = new Request("https://www.moa-work.com/w/alpha-team");

describe("GET /w/[slug]", () => {
  it("revalidates an exact active membership, selects mw_org, and keeps the canonical URL", async () => {
    const response = await handleWorkspaceTarget(request, "alpha-team", async () => ({
      kind: "ready",
      memberships: [{ orgId: "org-1", slug: "alpha-team", name: "알파팀", role: "member" }],
    }));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-1");
  });

  it("preserves an authorized deep path and query while rewriting internally", async () => {
    const deepRequest = new Request("https://www.moa-work.com/w/acme/deals/123?tab=notes");
    const response = await handleWorkspaceTarget(deepRequest, "acme", async () => ({ kind: "ready", memberships: [
      { orgId: "org-alpha", slug: "alpha-team", name: "알파", role: "member" },
      { orgId: "org-acme", slug: "acme", name: "에크미", role: "member" },
    ] }));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/deals/123?tab=notes");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-acme");
  });

  it("keeps the workspace canonical settlement URL while serving the existing settlement screen", async () => {
    const settlementRequest = new Request("https://www.moa-work.com/w/acme/settlements?dealId=deal-1");
    const response = await handleWorkspaceTarget(settlementRequest, "acme", async () => ({ kind: "ready", memberships: [
      { orgId: "org-acme", slug: "acme", name: "Acme", role: "member" },
    ] }));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.moa-work.com/policyfund/settlements?dealId=deal-1");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-acme");
  });

  it.each([
    ["stale-team", [{ orgId: "org-1", slug: "alpha-team", name: "알파팀", role: "member" as const }]],
    ["other-team", []],
    ["UPPER_CASE", [{ orgId: "org-1", slug: "UPPER_CASE", name: "잘못된 행", role: "member" as const }]],
  ])("denies stale, cross-tenant, or invalid target %s", async (slug, memberships) => {
    const response = await handleWorkspaceTarget(request, slug, async () => ({ kind: "ready", memberships }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
    expect(response.headers.get("set-cookie")).toContain("mw_org=");
  });

  it("preserves only a canonical target through login", async () => {
    const response = await handleWorkspaceTarget(request, "alpha-team", async () => ({ kind: "unauthenticated" }));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fw%2Falpha-team");
  });

  it("keeps the exact sanitized deep target through login and denies endpoint namespaces", async () => {
    const deep = await handleWorkspaceTarget(new Request("https://www.moa-work.com/w/acme/deals/123?tab=notes"), "acme", async () => ({ kind: "unauthenticated" }));
    expect(deep.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fw%2Facme%2Fdeals%2F123%3Ftab%3Dnotes");
    const endpoint = await handleWorkspaceTarget(new Request("https://www.moa-work.com/w/acme/api/workspace-requests"), "acme", async () => ({ kind: "ready", memberships: [{ orgId: "org-acme", slug: "acme", name: "에크미", role: "member" }] }));
    expect(endpoint.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
  });
});
