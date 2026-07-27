import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("platform workspace requests landing", () => {
  it("requires the verified platform grant before rendering the request queue", () => {
    expect(source).toContain('loadWorkspaceRoutingSnapshot()');
    expect(source).toContain('loadWorkspaceEntryContext()');
    expect(source).toContain('context.kind === "error" || !context.isPlatformAdmin');
    expect(source).toContain('redirect("/workspace-entry?error=permission")');
  });

  it("links only to request review and the existing account safety routes", () => {
    expect(source).toContain('href="/platform/workspace-requests"');
    expect(source).toContain('href="/account"');
    expect(source).toContain('href="/settings/account/sessions"');
    expect(source).toContain('href="/settings/account/privacy"');
  });

  it("keeps support read-only and does not add tenant or PII access controls", () => {
    expect(source).toContain("지원 확인은 읽기 전용으로만 제공돼요");
    expect(source).toContain("개인정보 표시·내려받기");
    expect(source).not.toMatch(/impersonation|user\.email|<input|download/i);
    expect(source).not.toContain("context.requests");
    expect(source).not.toContain("context.ownerJoinRequests");
  });
});
