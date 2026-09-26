import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { mutateConsultationHandoff, mutateConsultationSeal, readConsultationHandoff } from "./actions";

const initial = { ok: false, message: "" };
function form() {
  const value = new FormData();
  Object.entries({ itemId: "item-1", requestId: "request-1", expectedVersion: "4", companyName: "합성 QA" }).forEach(([k, v]) => value.set(k, v));
  return value;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ org: { id: "org-1" } });
});

describe("protected seal and handoff actions", () => {
  it("uses the scoped RPC and exact stable intent without a readiness preflight write", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ version: 4, replayed: false, deal_id: "deal-1", company_id: "company-1" }], error: null });
    expect(await mutateConsultationHandoff(initial, form())).toMatchObject({ ok: true, dealId: "deal-1", companyId: "company-1" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("execute_consultation_seal_handoff", {
      p_org_id: "org-1", p_item_id: "item-1", p_request_id: "request-1", p_expected_version: 4,
      p_operation: "handoff", p_company_name: "합성 QA",
    });
  });
  it("seal approval never submits a replacement company name", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ version: 5, replayed: true }], error: null });
    expect(await mutateConsultationSeal(initial, form())).toMatchObject({ ok: true, version: 5, replayed: true });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_operation: "seal_approval", p_company_name: null });
  });
  it("read controls expose server approval capability and ready without prior intent", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ can_approve_seal: false, seal_approved: true, ready: true, version: 5, missing: [] }], error: null });
    expect(await readConsultationHandoff("item-1")).toMatchObject({ ok: true, canApproveSeal: false, sealApproved: true, ready: true });
  });
  it.each(["throw", "empty", "unclassified"])("%s response leaves the original intent unresolved", async (kind) => {
    if (kind === "throw") mocks.rpc.mockRejectedValue(new Error("private transport details"));
    else mocks.rpc.mockResolvedValue(kind === "empty" ? { data: [], error: null } : { data: null, error: { message: "private transport details" } });
    const result = await mutateConsultationHandoff(initial, form());
    expect(result).toMatchObject({ ok: false, field: "unknown_result" });
    expect(result.message).not.toContain("private");
  });
  it.each(["42501", "40001"])("explicit %s rejection is settled and translated", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private db error" } });
    const result = await mutateConsultationSeal(initial, form());
    expect(result.ok).toBe(false);
    expect(result.field).not.toBe("unknown_result");
    expect(result.message).not.toContain("private");
  });
  it("missing version makes no RPC and unexpected SQL errors stay sanitized", async () => {
    const missing = form(); missing.delete("expectedVersion");
    expect((await mutateConsultationSeal(initial, missing)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "private schema details" } });
    expect((await mutateConsultationHandoff(initial, form())).message).not.toContain("private");
  });
});
