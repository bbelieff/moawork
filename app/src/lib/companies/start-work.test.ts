import { describe, expect, it, vi } from "vitest";
import { startCompanyWork } from "./start-work";

describe("startCompanyWork", () => {
  it("passes the explicit company and idempotency key and parses one result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ deal_id: "deal-1", item_id: "item-1", replayed: false }], error: null });
    await expect(startCompanyWork({ rpc }, { orgId: "org-1", companyId: "company-1", requestId: "request-1" }))
      .resolves.toEqual({ dealId: "deal-1", itemId: "item-1", replayed: false });
    // 그룹을 안 넘기면 null 로 간다 — 서버가 종전과 같이 첫 그룹을 고른다(#588).
    // 회사 상세의 「업무 시작」이 이 경로다.
    expect(rpc).toHaveBeenCalledWith("start_company_work_v2", {
      p_org_id: "org-1", p_company_id: "company-1", p_request_id: "request-1", p_group_id: null,
    });
  });

  it("does not guess success from an invalid RPC result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await expect(startCompanyWork({ rpc }, { orgId: "org-1", companyId: "company-1", requestId: "request-1" })).rejects.toThrow("결과");
  });
});
