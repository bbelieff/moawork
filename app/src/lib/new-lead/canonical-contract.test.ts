import { describe, expect, it } from "vitest";
import { NEW_LEAD_ERROR, NEW_LEAD_RPC, type CreateNewLeadArgs, type NewLeadFieldPatch } from "./canonical-contract";

describe("BBE-173 canonical new-lead RPC contract", () => {
  it("freezes the consumer-facing RPC names and stable SQLSTATEs", () => {
    // 기존 6종 이름은 고정이다. 뒤 4종은 154 초안(미적용) 추가분이며
    // 기존 이름을 바꾸지 않는다.
    expect(NEW_LEAD_RPC).toEqual({
      create: "create_new_lead",
      createWithFoundedMonth: "create_new_lead_with_founded_month",
      update: "update_new_lead_fields",
      updateTitle: "update_new_lead_title",
      updateMeta: "update_new_lead_intake_meta",
      advance: "advance_new_lead_to_contact",
      ocrMeta: "update_new_lead_ocr_meta",
      companyBizNo: "ocr_update_linked_company_biz_no",
      companyNameSync: "ocr_sync_linked_company_name",
    });
    expect(NEW_LEAD_ERROR).toEqual({ invalidInput: "22023", forbidden: "42501", manualCorrectionConflict: "40001" });
  });

  it("keeps industry in both create and field-level update inputs", () => {
    const create = { p_org_id: "o", p_board_id: "b", p_group_id: "g", p_request_id: "r", p_title: "lead", p_industry: "manufacturing" } satisfies CreateNewLeadArgs;
    const patch = { industry: "logistics", industry_code: null } satisfies NewLeadFieldPatch;
    expect(create.p_industry).toBe("manufacturing");
    expect(patch).toEqual({ industry: "logistics", industry_code: null });
  });
});
