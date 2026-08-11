import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  loadRouting: vi.fn(),
  loadContext: vi.fn(),
  getSupportScope: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/workspace-entry-server", () => ({
  loadWorkspaceRoutingSnapshot: mocks.loadRouting,
}));
vi.mock("@/lib/workspace-entry/server", () => ({
  loadWorkspaceEntryContext: mocks.loadContext,
}));
vi.mock("@/lib/account/memberAccountOps", () => ({
  getMySupportReadScope: mocks.getSupportScope,
}));
vi.mock("@/components/brand/Logo", () => ({ Logo: () => null }));
vi.mock("@/components/workspace-entry/ApprovalQueue", () => ({
  ApprovalQueue: () => null,
}));

import PlatformWorkspaceRequestsPage from "./page";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("platform workspace requests landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
    mocks.getSupportScope.mockResolvedValue([]);
  });

  it("requires the verified platform grant before rendering the request queue", () => {
    expect(source).toContain('loadWorkspaceRoutingSnapshot()');
    expect(source).toContain('loadWorkspaceEntryContext()');
    expect(source).toContain('context.kind === "error"');
    expect(source).toContain("!context.isPlatformAdmin");
    expect(source).toContain("decideAccessFailureDestination");
  });

  it("sends an unauthenticated actor to login with the canonical safe return path", async () => {
    mocks.loadRouting.mockResolvedValue({ kind: "unauthenticated" });
    await expect(PlatformWorkspaceRequestsPage()).rejects.toThrow(
      "redirect:/login?next=%2Fplatform%2Fworkspace-requests",
    );
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it.each([
    { context: { kind: "error" }, reason: "membership-unavailable" },
    {
      context: {
        kind: "ready",
        isPlatformAdmin: false,
        platformCreateRequests: [],
      },
      reason: "permission",
    },
  ])("sends authenticated $reason to the neutral routing screen", async ({ context }) => {
    mocks.loadRouting.mockResolvedValue({ kind: "ready", memberships: [] });
    mocks.loadContext.mockResolvedValue(context);
    await expect(PlatformWorkspaceRequestsPage()).rejects.toThrow(
      "redirect:/workspace-entry?error=routing",
    );
  });

  it("keeps a server-confirmed platform actor on the page", async () => {
    mocks.loadRouting.mockResolvedValue({ kind: "ready", memberships: [] });
    mocks.loadContext.mockResolvedValue({
      kind: "ready",
      isPlatformAdmin: true,
      platformCreateRequests: [],
    });
    await expect(PlatformWorkspaceRequestsPage()).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("links only to request review and the existing account safety routes", () => {
    expect(source).toContain('href="/platform/workspace-requests"');
    expect(source).toContain('href="/account"');
    expect(source).toContain('href="/settings/account/sessions"');
    expect(source).toContain('href="/settings/account/privacy"');
    expect(source).toContain('<Logo height={28} href="/platform" />');
    expect(source).toContain('action="/auth/signout"');
    expect(source).toContain("로그아웃");
  });

  it("keeps support read-only and does not add tenant or PII access controls", () => {
    expect(source).toContain("지원 확인은 읽기 전용으로만 제공돼요");
    expect(source).toContain("개인정보 표시·내려받기");
    expect(source).not.toMatch(/impersonation|user\.email|<input|download/i);
    expect(source).not.toContain("context.requests");
    expect(source).not.toContain("context.ownerJoinRequests");
  });
});
