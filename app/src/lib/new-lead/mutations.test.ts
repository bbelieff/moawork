import { describe, expect, it, vi } from "vitest";
import { canonicalAssignee, canonicalPhone, createCanonicalNewLead, NewLeadMutationError, updateCanonicalNewLead, updateCanonicalNewLeadMeta, updateCanonicalNewLeadTitle } from "./mutations";

describe("BBE-171 canonical new-lead mutations", () => {
  it("formats a Korean phone for display while the RPC owns normalized storage", () => {
    expect(canonicalPhone("01012345678")).toBe("010-1234-5678");
    expect(canonicalPhone("not a phone")).toBeNull();
  });

  it("keeps the actor-default assignment system-owned and sends only an explicit alternate", () => {
    expect(canonicalAssignee("actor", "actor")).toBeNull();
    expect(canonicalAssignee("actor", "")).toBeNull();
    expect(canonicalAssignee("actor", "member")).toBe("member");
  });

  it("creates through the single atomic BBE-173 RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ deal_id: "d1", item_id: "i1", replayed: false }], error: null });
    const row = await createCanonicalNewLead({ rpc } as never, {
      p_org_id: "o1", p_board_id: "b1", p_group_id: "g1", p_request_id: "r1", p_title: "예시 리드", p_phone: "01012345678",
      p_business_registration_type: "법인", p_revenue_band: "미정", p_region_sigungu: "강남구",
      p_address_detail: "테헤란로", p_acquisition_source: "검색 광고", p_assigned_to: "u1", p_collaborator_ids: ["u2"],
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("create_new_lead", expect.objectContaining({ p_phone: "010-1234-5678" }));
    expect(rpc).toHaveBeenCalledWith("create_new_lead", expect.objectContaining({
      p_business_registration_type: "법인", p_region_sigungu: "강남구", p_address_detail: "테헤란로",
      p_acquisition_source: "검색 광고", p_assigned_to: "u1", p_collaborator_ids: ["u2"],
    }));
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

  it("routes title edits through the atomic audited title RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ deal_id: "d1", item_id: "i1", replayed: false }], error: null });
    await updateCanonicalNewLeadTitle({ rpc } as never, { orgId: "o1", dealId: "d1", requestId: "r3", title: " 새 이름 ", valueSource: "manual" });
    expect(rpc).toHaveBeenCalledWith("update_new_lead_title", expect.objectContaining({ p_title: "새 이름", p_value_source: "manual" }));
  });

  it("routes owner, collaborators, applied date, and address corrections through the audited meta RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ deal_id: "d1", item_id: "i1", changed_fields: ["address_detail"], replayed: false }], error: null });
    await updateCanonicalNewLeadMeta({ rpc } as never, { orgId: "o1", dealId: "d1", requestId: "r4", patch: { address_detail: "수정 주소" } });
    expect(rpc).toHaveBeenCalledWith("update_new_lead_intake_meta", expect.objectContaining({ p_patch: { address_detail: "수정 주소" } }));
  });

  it("does not hide cross-org/permission rejection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createCanonicalNewLead({ rpc } as never, {
      p_org_id: "other", p_board_id: "b1", p_group_id: "g1", p_request_id: "r1", p_title: "예시",
    })).rejects.toEqual(expect.objectContaining<Partial<NewLeadMutationError>>({ code: "42501" }));
  });
});
