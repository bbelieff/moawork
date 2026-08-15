import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, createClient, rpc } = vi.hoisted(() => ({
  getSession: vi.fn(), createClient: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
import { requestSealApprovalAction } from "./actions";

describe("requestSealApprovalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ org: { id: "org-1" } });
    createClient.mockResolvedValue({ rpc });
  });
  it("returns visible success and preserves the idempotency request id", async () => {
    rpc.mockResolvedValue({ data: "sent", error: null });
    await expect(requestSealApprovalAction("deal-1", "request-1")).resolves.toEqual({ ok: true, message: "대표 직인 승인 요청을 보냈습니다." });
    expect(rpc).toHaveBeenCalledWith("request_deal_seal_approval", { p_org_id: "org-1", p_deal_id: "deal-1", p_request_id: "request-1" });
    rpc.mockResolvedValue({ data: "already_sent", error: null });
    await expect(requestSealApprovalAction("deal-1", "request-1")).resolves.toMatchObject({ ok: true });
  });
  it("fails closed for an invalid target and reports RPC failures", async () => {
    await expect(requestSealApprovalAction("", "request-1")).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(requestSealApprovalAction("deal-1", "request-1")).resolves.toEqual({ ok: false, message: "승인 요청을 보내지 못했습니다: denied" });
  });
});
