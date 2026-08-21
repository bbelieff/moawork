import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  request: vi.fn(),
  restore: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/workspace-deletion/server", () => ({
  requestWorkspaceDeletion: mocks.request,
  restoreWorkspaceDeletion: mocks.restore,
}));
vi.mock("@/lib/account/memberAccountOps", () => ({
  requestMyPrivacyExport: vi.fn(),
  revokeAllMemberSessions: vi.fn(),
  revokeCurrentMemberSession: vi.fn(),
}));

import { requestWorkspaceDeletionAction, restoreWorkspaceDeletionAction } from "./actions";

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
