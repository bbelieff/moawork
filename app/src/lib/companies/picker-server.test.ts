import { describe, expect, it, vi } from "vitest";
import type { Company, Ctx, Deal } from "@/lib/types";
import { buildCompanyPickerRows, loadCompanyPickerRows } from "./picker-server";

const ctx = { user: { id: "user-1" }, org: { id: "org-1" }, role: "owner", scope: "all" } as Ctx;
const company: Company = {
  id: "company-1", org_id: "org-1", name: "모아상사", biz_type: "법인", region: "서울",
  owner_name: "홍대표", phone: "010-1234-5678", email: "owner@example.test", revenue: 123,
  founded_on: "2020-01-01", homepage: "https://example.test", assigned_to: "user-1",
  created_at: "2026-01-01T00:00:00.000Z",
};
const deal = {
  id: "deal-1", org_id: "org-1", company_id: "company-1", pipeline_id: null, stage_id: null,
  assigned_to: "user-1", title: "정책자금", amount: null, status_note: null, fee_terms: null,
  applied_on: null, custom: {}, created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} satisfies Deal;

describe("company picker server boundary", () => {
  it("정상 0건과 읽기 실패를 구분한다", async () => {
    await expect(loadCompanyPickerRows(ctx, {
      source: { listCompanies: vi.fn(async () => []), listDeals: vi.fn(async () => []) },
    })).resolves.toEqual({ rows: [], error: null });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(loadCompanyPickerRows(ctx, {
      source: {
        listCompanies: vi.fn(async () => { throw new Error("private database detail"); }),
        listDeals: vi.fn(async () => []),
      },
    })).resolves.toEqual({
      rows: [],
      error: "업체 목록을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.",
    });
    error.mockRestore();
  });

  it("브라우저에는 검색·표시에 필요한 최소 회사 정보만 보낸다", () => {
    const [row] = buildCompanyPickerRows([company], [deal, { ...deal, id: "deal-2" }]);
    expect(row).toEqual({
      company: {
        id: "company-1", name: "모아상사", biz_type: "법인", region: "서울",
        owner_name: "홍대표", phone: "010-1234-5678", email: "owner@example.test",
        homepage: "https://example.test",
      },
      dealCount: 2,
    });
    expect(row.company).not.toHaveProperty("org_id");
    expect(row.company).not.toHaveProperty("revenue");
    expect(row.company).not.toHaveProperty("assigned_to");
  });
});
