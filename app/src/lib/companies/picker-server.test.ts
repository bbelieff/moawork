import { describe, expect, it, vi } from "vitest";
import type { Company, Ctx, Deal } from "@/lib/types";
import { buildCompanyPickerRows, COMPANY_PICKER_LIMIT, loadCompanyPickerRows } from "./picker-server";

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
    })).resolves.toEqual({ rows: [], error: null, truncated: false });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(loadCompanyPickerRows(ctx, {
      source: {
        listCompanies: vi.fn(async () => { throw new Error("private database detail"); }),
        listDeals: vi.fn(async () => []),
      },
    })).resolves.toEqual({
      rows: [],
      error: "업체 목록을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.",
      truncated: false,
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

  /**
   * ★ 상한을 «조용히» 넘기지 않는다.
   *   목록은 최근 순이라 잘리면 오래된 회사부터 사라진다. 안 알리면 사람은
   *   「없구나」 하고 새로 만든다 — 이 화면이 막으려던 중복을 이 화면이 만든다.
   */
  it("상한을 넘으면 자르고, 잘렸다는 사실을 «말한다»", async () => {
    const many = Array.from({ length: COMPANY_PICKER_LIMIT + 3 }, (_, i) => ({
      ...company, id: `company-${i}`, name: `회사${i}`,
    }));
    const result = await loadCompanyPickerRows(ctx, {
      source: { listCompanies: vi.fn(async () => many), listDeals: vi.fn(async () => []) },
    });
    expect(result.rows).toHaveLength(COMPANY_PICKER_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.error).toBeNull();
  });

  it("상한 «미만» 이면 자르지 않고 잘렸다고 말하지도 않는다", async () => {
    const under = Array.from({ length: COMPANY_PICKER_LIMIT - 1 }, (_, i) => ({
      ...company, id: `company-${i}`, name: `회사${i}`,
    }));
    const result = await loadCompanyPickerRows(ctx, {
      source: { listCompanies: vi.fn(async () => under), listDeals: vi.fn(async () => []) },
    });
    expect(result.rows).toHaveLength(COMPANY_PICKER_LIMIT - 1);
    expect(result.truncated).toBe(false);
  });

  /**
   * ★ 정확히 상한만큼 받았을 때 — «딱 그만큼» 인지 «잘려서 그만큼» 인지 구분할 수 없다.
   *   구분이 안 되면 «모른다» 고 말해야 한다. 안 그러면 DB 가 자른 걸 우리가
   *   「안 잘렸다」고 단정해 버린다.
   */
  it("★ 정확히 상한만큼이면 «모른다» 쪽으로 — 잘렸다고 말한다", async () => {
    const exact = Array.from({ length: COMPANY_PICKER_LIMIT }, (_, i) => ({
      ...company, id: `company-${i}`, name: `회사${i}`,
    }));
    const result = await loadCompanyPickerRows(ctx, {
      source: { listCompanies: vi.fn(async () => exact), listDeals: vi.fn(async () => []) },
    });
    expect(result.truncated).toBe(true);
  });
});
