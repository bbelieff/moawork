import { describe, expect, it } from "vitest";
import { handleWorkspaceAlias } from "./route";

describe("top-level workspace alias", () => {
  it("redirects a verified canonical user alias to the /w namespace with query intact", async () => {
    const response = await handleWorkspaceAlias(new Request("https://www.moa-work.com/sample-team?tab=work"), "sample-team", async () => ({ kind: "ready", memberships: [{ orgId: "org-1", slug: "sample-team", name: "샘플", role: "member" }] }));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/w/sample-team?tab=work");
    expect(response.headers.get("set-cookie")).toContain("mw_org=org-1");
  });

  it.each(["login", "settings", "workspace-entry", "w", "api", "_next"])("never treats reserved %s as an alias", async (alias) => {
    const response = await handleWorkspaceAlias(new Request(`https://www.moa-work.com/${alias}`), alias, async () => ({ kind: "ready", memberships: [] }));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
  });

  it("canonicalizes an unauthenticated alias before the login round trip", async () => {
    const response = await handleWorkspaceAlias(new Request("https://www.moa-work.com/sample-team?tab=work"), "sample-team", async () => ({ kind: "unauthenticated" }));
    expect(response.headers.get("location")).toBe("https://www.moa-work.com/login?next=%2Fw%2Fsample-team%3Ftab%3Dwork");
  });

  it("makes unknown and revoked aliases indistinguishable", async () => {
    for (const memberships of [[], [{ orgId: "org-1", slug: "sample-team", name: "샘플", role: "member" as const }]]) {
      const response = await handleWorkspaceAlias(new Request("https://www.moa-work.com/other-team"), "other-team", async () => ({ kind: "ready", memberships }));
      expect(response.headers.get("location")).toBe("https://www.moa-work.com/workspace-entry?error=routing");
    }
  });
});
