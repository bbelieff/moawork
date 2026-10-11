import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  request: vi.fn(),
  restore: vi.fn(),
  revalidatePath: vi.fn(),
  signOut: vi.fn(),
  cookieDelete: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  revokeAll: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
  SESSION_COOKIE: { uid: "mw_uid", org: "mw_org", as: "mw_as" },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.cookieDelete }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/env", () => ({ hasSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("@/lib/workspace-deletion/server", () => ({
  requestWorkspaceDeletion: mocks.request,
  restoreWorkspaceDeletion: mocks.restore,
}));
vi.mock("@/lib/account/memberAccountOps", () => ({
  requestMyPrivacyExport: vi.fn(),
  revokeAllMemberSessions: mocks.revokeAll,
  revokeCurrentMemberSession: vi.fn(),
}));

import { requestWorkspaceDeletionAction, restoreWorkspaceDeletionAction, revokeAllSessions } from "./actions";

const idle = { kind: "idle" as const, message: "" };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  Object.entries(entries).forEach(([key, value]) => data.set(key, value));
  return data;
};

describe("workspace deletion server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ org: { id: "current" } });
  });

  it("never calls deletion RPC when the exact name is missing or wrong", async () => {
    await expect(requestWorkspaceDeletionAction(idle, form({ orgId: "org-a", workspaceName: "정확한 회사", confirmation: "정확한 회사 " })))
      .resolves.toMatchObject({ kind: "error" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("passes the exact org and name to the hardened RPC and refreshes both surfaces", async () => {
    mocks.request.mockResolvedValue(undefined);
    await expect(requestWorkspaceDeletionAction(idle, form({ orgId: "org-a", workspaceName: "정확한 회사", confirmation: "정확한 회사" })))
      .resolves.toMatchObject({ kind: "success" });
    expect(mocks.request).toHaveBeenCalledWith("org-a", "정확한 회사");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/account");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspaces");
  });

  it("reports denied and replayed requests as errors rather than success", async () => {
    mocks.request.mockRejectedValue(new Error("workspace_deletion_unavailable"));
    const result = await requestWorkspaceDeletionAction(idle, form({ orgId: "cross-org", workspaceName: "다른 회사", confirmation: "다른 회사" }));
    expect(result).toMatchObject({ kind: "error" });
    expect(result.message).toContain("예약하지 못했어요");
  });

  it("restores only through the restore RPC and exposes failures", async () => {
    mocks.restore.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("workspace_deletion_unavailable"));
    await expect(restoreWorkspaceDeletionAction(idle, form({ orgId: "pending" }))).resolves.toMatchObject({ kind: "success" });
    await expect(restoreWorkspaceDeletionAction(idle, form({ orgId: "active-replay" }))).resolves.toMatchObject({ kind: "error" });
    expect(mocks.restore).toHaveBeenNthCalledWith(1, "pending");
    expect(mocks.restore).toHaveBeenNthCalledWith(2, "active-replay");
  });
});

describe("QA #887 — 모든 기기에서 로그아웃", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ org: { id: "current" } });
  });

  it("Supabase 전체 로그아웃을 하고, 이 기기 쿠키를 지운 뒤 로그인 화면으로 보낸다", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(revokeAllSessions()).rejects.toThrow("REDIRECT /login?reason=signed-out-everywhere");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(mocks.cookieDelete.mock.calls.map((call) => call[0]).sort()).toEqual(["mw_as", "mw_org", "mw_uid"]);
  });

  it("기기 기록 장부가 실패해도 실제 로그아웃은 한다", async () => {
    mocks.revokeAll.mockRejectedValue(new Error("ledger down"));
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(revokeAllSessions()).rejects.toThrow("REDIRECT /login?reason=signed-out-everywhere");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("전체 로그아웃이 실패하면 장부를 바꾸지 않고, 로그인 화면에서 다른 기기가 남았을 수 있다고 알린다", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "nope" } });
    await expect(revokeAllSessions()).rejects.toThrow("REDIRECT /login?error=signout-all-failed");
    expect(mocks.revokeAll).not.toHaveBeenCalled();
  });
});
