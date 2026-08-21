import { describe, expect, it, vi } from "vitest";
import { canonicalPhone, createCanonicalNewLead, NewLeadMutationError, updateCanonicalNewLead } from "./mutations";

describe("BBE-171 canonical new-lead mutations", () => {
  it("formats a Korean phone for display while the RPC owns normalized storage", () => {
    expect(canonicalPhone("01012345678")).toBe("010-1234-5678");
    expect(canonicalPhone("not a phone")).toBeNull();
  });

  it("creates through the single atomic BBE-173 RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ deal_id: "d1", item_id: "i1", replayed: false }], error: null });
    const row = await createCanonicalNewLead({ rpc } as never, {
      p_org_id: "o1", p_board_id: "b1", p_group_id: "g1", p_request_id: "r1", p_title: "예시 리드", p_phone: "01012345678",
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("create_new_lead", expect.objectContaining({ p_phone: "010-1234-5678" }));
    expect(row.item_id).toBe("i1");
  });

  it("routes manual and automation edits through the audited RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ deal_id: "d1", changed_fields: ["industry"], replayed: false }], error: null });
    await updateCanonicalNewLead({ rpc } as never, {
      orgId: "o1", dealId: "d1", requestId: "r2", patch: { industry: "제조업" }, valueSource: "manual",
    });
    expect(rpc).toHaveBeenCalledWith("update_new_lead_fields", expect.objectContaining({
      p_patch: { industry: "제조업" }, p_value_source: "manual",
    }));
  });

  it("does not hide cross-org/permission rejection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createCanonicalNewLead({ rpc } as never, {
      p_org_id: "other", p_board_id: "b1", p_group_id: "g1", p_request_id: "r1", p_title: "예시",
    })).rejects.toEqual(expect.objectContaining<Partial<NewLeadMutationError>>({ code: "42501" }));
  });
});
