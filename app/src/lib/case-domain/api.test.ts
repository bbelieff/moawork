import { describe, expect, it, vi } from "vitest";
import { CanonicalCaseApi, CaseApiError } from "./api";

function client(response: unknown, error: null | { code?: string; message: string } = null) {
  const rpc = vi.fn(async () => ({ data: response, error }));
  return { rpc, sdk: { rpc } as never };
}

describe("CanonicalCaseApi", () => {
  it("binds company Case creation to a caller-stable request identity", async () => {
    const fake = client([{ case_id: "case-1", item_id: "item-1", version: 0, replayed: false }]);
    const result = await new CanonicalCaseApi(fake.sdk).createForCompany({
      orgId: "org-a",
      companyId: "company-a",
      groupId: "group-a",
      requestId: "request-a",
    });
    expect(result).toEqual({ caseId: "case-1", itemId: "item-1", version: 0, replayed: false });
    expect(fake.rpc).toHaveBeenCalledWith("create_company_case", {
      p_org_id: "org-a",
      p_company_id: "company-a",
      p_request_id: "request-a",
      p_group_id: "group-a",
    });
  });

  it("uses caseId in canonical mutations and carries expected version", async () => {
    const fake = client([{ case_id: "case-1", version: 3, activity_id: "activity-1", stage_id: "stage-b", pipeline_id: "pipeline-a", replayed: true }]);
    await new CanonicalCaseApi(fake.sdk).moveStage({
      orgId: "org-a",
      caseId: "case-1",
      stageId: "stage-b",
      expectedVersion: 2,
      requestId: "request-b",
    });
    expect(fake.rpc).toHaveBeenCalledWith("move_case_stage_with_activity", expect.objectContaining({
      p_case_id: "case-1",
      p_expected_version: 2,
      p_request_id: "request-b",
    }));
  });

  it("keeps dealId only as an explicit read compatibility alias", async () => {
    const fake = client({ case_id: "case-1", company_id: "company-a", org_id: "org-a", pipeline_id: null, stage_id: null, assigned_to: null, title: "Case", version: 0, item_id: "item-1" });
    expect((await new CanonicalCaseApi(fake.sdk).read({ orgId: "org-a", dealId: "case-1" })).caseId).toBe("case-1");
  });

  it("does not turn unknown transport outcomes into a synthetic success", async () => {
    const fake = client(null, { code: "57014", message: "connection closed" });
    await expect(new CanonicalCaseApi(fake.sdk).mutateChecklist({
      orgId: "org-a", caseId: "case-1", expectedVersion: 0,
      requestId: "stable-request", productId: null, items: [],
    })).rejects.toEqual(expect.objectContaining<Partial<CaseApiError>>({
      name: "CaseApiError",
      code: "57014",
    }));
  });
});
