import { describe, expect, it } from "vitest";
import { NEW_LEAD_ERROR, NEW_LEAD_RPC, type CreateNewLeadArgs, type NewLeadFieldPatch } from "./canonical-contract";

describe("BBE-173 canonical new-lead RPC contract", () => {
  it("freezes the three consumer-facing RPC names and stable SQLSTATEs", () => {
    expect(NEW_LEAD_RPC).toEqual({
      create: "create_new_lead",
      update: "update_new_lead_fields",
      updateTitle: "update_new_lead_title",
      advance: "advance_new_lead_to_contact",
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
