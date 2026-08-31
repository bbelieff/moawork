import { describe, expect, it, vi } from "vitest";
import { CompanyStartWorkError, shouldRetryCompanyStartWork, startCompanyWork } from "./start-work";

describe("startCompanyWork", () => {
  it("passes the explicit company and idempotency key and parses one result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ case_id: "case-1", item_id: "item-1", version: 0, replayed: false }], error: null });
    await expect(startCompanyWork({ rpc }, { orgId: "org-1", companyId: "company-1", requestId: "request-1" }))
      .resolves.toEqual({ caseId: "case-1", dealId: "case-1", itemId: "item-1", version: 0, replayed: false });
    // 그룹을 안 넘기면 null 로 간다 — 서버가 종전과 같이 첫 그룹을 고른다(#588).
    // 회사 상세의 「업무 시작」이 이 경로다.
    expect(rpc).toHaveBeenCalledWith("create_company_case", {
      p_org_id: "org-1", p_company_id: "company-1", p_request_id: "request-1", p_group_id: null,
    });
  });

  it("does not guess success from an invalid RPC result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const error = await startCompanyWork({ rpc }, { orgId: "org-1", companyId: "company-1", requestId: "request-1" })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CompanyStartWorkError);
    expect(error).toMatchObject({ outcome: "retryable_unknown" });
    expect(shouldRetryCompanyStartWork(error)).toBe(true);
  });

  it("rejects coerced, negative, and unsafe result versions as unknown outcomes", async () => {
    for (const version of [null, "", true, {}, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ case_id: "case-1", item_id: "item-1", version, replayed: false }],
        error: null,
      });
      const error = await startCompanyWork(
        { rpc },
        { orgId: "org-1", companyId: "company-1", requestId: "request-1" },
      ).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(CompanyStartWorkError);
      expect(error).toMatchObject({ outcome: "retryable_unknown" });
      expect(shouldRetryCompanyStartWork(error)).toBe(true);
    }
  });

  it("classifies only authoritative business/security conflicts as terminal", async () => {
    for (const code of ["22023", "40001", "42501"]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: "terminal" } });
      const error = await startCompanyWork({ rpc }, { orgId: "org-1", companyId: "company-1", requestId: "request-1" })
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({ code, outcome: "terminal" });
      expect(shouldRetryCompanyStartWork(error)).toBe(false);
    }
    expect(shouldRetryCompanyStartWork(new Error("fetch failed"))).toBe(true);
  });
});
