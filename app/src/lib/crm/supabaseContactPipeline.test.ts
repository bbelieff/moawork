import { describe, expect, it, vi } from "vitest";
import { executeContactPipelineTransition } from "./supabaseContactPipeline";

describe("executeContactPipelineTransition", () => {
  it("passes stable tenant/deal/request identifiers to the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ status:"committed",deal_id:"deal-1",company_id:null,reason:null }], error:null });
    await expect(executeContactPipelineTransition({ rpc }, { orgId:"org-1",dealId:"deal-1",requestId:"req-1",kind:"lead_to_contact" }))
      .resolves.toMatchObject({ status:"committed",dealId:"deal-1" });
    expect(rpc).toHaveBeenCalledWith("execute_contact_pipeline_transition", expect.objectContaining({ p_org_id:"org-1",p_deal_id:"deal-1",p_source_item_id:null,p_request_id:"req-1",p_kind:"lead_to_contact" }));
  });
  it("preserves the explicit double-lock reason", async () => {
    const reason="대표 직인 승인이 필요합니다. 현재 직인 완료 = 대기";
    const rpc = vi.fn().mockResolvedValue({ data:[{status:"blocked",deal_id:"deal-1",company_id:null,reason}],error:null });
    await expect(executeContactPipelineTransition({rpc},{orgId:"org-1",dealId:"deal-1",requestId:"req-1",kind:"contact_to_work"}))
      .resolves.toMatchObject({status:"blocked",reason});
  });
});
