import { describe, expect, it, vi } from "vitest";
import { handoffCompanyWithSupabase, type CompanyHandoffRpcClient } from "./supabase-handoff";

function client(data: unknown, error: { message?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as CompanyHandoffRpcClient, rpc };
}

describe("handoffCompanyWithSupabase (BBE-125)", () => {
  it("원자 RPC에 회사 입력을 전달하고 참조 id만 돌려준다", async () => {
    const { client: rpcClient, rpc } = client([
      { company_id: "company-1", mode: "created", duplicate_candidate_ids: [] },
    ]);

    const result = await handoffCompanyWithSupabase(rpcClient, "org-1", {
      dealId: "deal-1",
      name: "새봄상사",
      bizNo: "123-45-67890",
      ceoName: "오새봄",
      bizType: "법인",
      industry: "도소매",
      regionSido: "서울",
      regionSigungu: "강서구",
      phone: "02-1234-5678",
      foundedOn: "2020-01-01",
      revenue: "100000000",
    });

    expect(result).toEqual({ companyId: "company-1", mode: "created", duplicateCandidateIds: [] });
    expect(rpc).toHaveBeenCalledWith("handoff_company_to_work", expect.objectContaining({
      p_org_id: "org-1",
      p_deal_id: "deal-1",
      p_name: "새봄상사",
      p_owner_name: "오새봄",
    }));
    expect(result).not.toHaveProperty("company");
  });

  it("의심 중복은 후보 id 목록을 보존한다", async () => {
    const { client: rpcClient } = client([
      {
        company_id: "company-new",
        mode: "created_needs_review",
        duplicate_candidate_ids: ["company-old"],
      },
    ]);

    await expect(handoffCompanyWithSupabase(rpcClient, "org-1", {
      dealId: "deal-1",
      name: "새봄상사",
    })).resolves.toEqual({
      companyId: "company-new",
      mode: "created_needs_review",
      duplicateCandidateIds: ["company-old"],
    });
  });

  it("RPC 오류·다건·알 수 없는 mode를 성공으로 추측하지 않는다", async () => {
    const failed = client(null, { message: "deal unavailable" }).client;
    await expect(handoffCompanyWithSupabase(failed, "org-1", {
      dealId: "deal-1",
      name: "새봄상사",
    })).rejects.toThrow("deal unavailable");

    const multiple = client([
      { company_id: "a", mode: "existing", duplicate_candidate_ids: [] },
      { company_id: "b", mode: "existing", duplicate_candidate_ids: [] },
    ]).client;
    await expect(handoffCompanyWithSupabase(multiple, "org-1", {
      dealId: "deal-1",
      name: "새봄상사",
    })).rejects.toThrow("정확히 1건");

    const unknown = client([
      { company_id: "a", mode: "merged", duplicate_candidate_ids: [] },
    ]).client;
    await expect(handoffCompanyWithSupabase(unknown, "org-1", {
      dealId: "deal-1",
      name: "새봄상사",
    })).rejects.toThrow("형식");
  });
});
