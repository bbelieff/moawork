import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx, Settlement } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const crm = vi.hoisted(() => ({ deals: vi.fn(), companies: vi.fn() }));
vi.mock("@/lib/crm/asyncService", () => ({
  AsyncCrmService: class {
    listDeals = crm.deals;
    listCompanies = crm.companies;
  },
}));

import { MonthlyContractCompaniesReadError, loadMonthlyContractCompanies, normalizeTopCompaniesPeriod } from "./server";

const ctx = { user: { id: "u1" }, org: { id: "o1" }, role: "member", scope: "assigned" } as Ctx;
const deal = { id: "d1", org_id: "o1", company_id: "c1", assigned_to: "u1" } as never;
const company = { id: "c1", org_id: "o1", name: "서울상사" } as never;
const settlement = { id: "s1", org_id: "o1", deal_id: "d1", down_payment: 0, down_paid_at: null, exec_amount: 10000000, fee_pct: 3, fee_paid_at: "2026-08-15", fee_amount: 300000, total_revenue: 300000, d180: null, d365: null, created_at: "2026-08-01T00:00:00.000Z" } satisfies Settlement;

describe("monthly contract companies server reader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("기존 월 집계를 재사용하고 주입된 가시 범위만 반환한다", async () => {
    const source = { load: vi.fn().mockResolvedValue({ deals: [deal], companies: [company], settlements: [settlement] }) };
    const result = await loadMonthlyContractCompanies(ctx, { period: "2026-08", source });
    expect(source.load).toHaveBeenCalledWith(ctx);
    expect(result.top).toMatchObject({ companyId: "c1", name: "서울상사", feeSum: 300000 });
  });

  it("새 요청의 readback을 다시 집계하며 0건을 성공으로 표시한다", async () => {
    const source = { load: vi.fn().mockResolvedValue({ deals: [deal], companies: [company], settlements: [] }) };
    await expect(loadMonthlyContractCompanies(ctx, { period: "2026-08", source })).resolves.toMatchObject({ available: false, entries: [] });
  });

  it("잘못된 월은 KST 현재 월로 정규화한다", () => {
    expect(normalizeTopCompaniesPeriod("2026-13", new Date("2026-09-01T00:00:00Z"))).toBe("2026-09");
    expect(normalizeTopCompaniesPeriod("2026-08", new Date())).toBe("2026-08");
  });

  it.each([
    ["null numeric", { ...settlement, exec_amount: null }],
    ["blank numeric", { ...settlement, fee_amount: "" }],
    ["boolean numeric", { ...settlement, fee_pct: true }],
    ["invalid paid date", { ...settlement, fee_paid_at: "2026-02-30" }],
    ["date with trailing text", { ...settlement, d180: "2026-08-15T00:00:00Z" }],
    ["invalid created date", { ...settlement, created_at: "2026-99-99T00:00:00Z" }],
  ])("운영 행의 %s를 0건으로 숨기지 않고 거부한다", async (_label, row) => {
    crm.deals.mockResolvedValue([deal]);
    crm.companies.mockResolvedValue([company]);
    const client = fakeClient({ rows: [row] });
    await expect(loadMonthlyContractCompanies(ctx, { period: "2026-08", clientFactory: async () => client as never }))
      .rejects.toBeInstanceOf(MonthlyContractCompaniesReadError);
  });

  it("cookie-bound query에 조직과 visible deal을 묶고 숨은 행을 최종 방어한다", async () => {
    crm.deals.mockResolvedValue([deal]);
    crm.companies.mockResolvedValue([company]);
    const hidden = { ...settlement, id: "s-hidden", deal_id: "d-hidden", fee_amount: 999999 };
    const client = fakeClient({ rows: [settlement, hidden] });
    const result = await loadMonthlyContractCompanies(ctx, { period: "2026-08", clientFactory: async () => client as never });
    expect(client.from).toHaveBeenCalledOnce();
    expect(client.eq).toHaveBeenCalledWith("org_id", "o1");
    expect(client.in).toHaveBeenCalledWith("deal_id", ["d1"]);
    expect(result.entries).toHaveLength(1);
    expect(result.top?.feeSum).toBe(300000);
  });

  it("가시 deal이 없으면 settlements를 조회하지 않는다", async () => {
    crm.deals.mockResolvedValue([]);
    crm.companies.mockResolvedValue([]);
    const client = fakeClient({ rows: [] });
    await expect(loadMonthlyContractCompanies(ctx, { period: "2026-08", clientFactory: async () => client as never }))
      .resolves.toMatchObject({ available: false });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("Supabase 오류 원문을 노출하지 않고 정제된 오류로 닫는다", async () => {
    crm.deals.mockResolvedValue([deal]);
    crm.companies.mockResolvedValue([company]);
    const client = fakeClient({ rows: [], error: { message: "secret upstream detail" } });
    await expect(loadMonthlyContractCompanies(ctx, { clientFactory: async () => client as never }))
      .rejects.toMatchObject({ name: "MonthlyContractCompaniesReadError", operation: "settlements" });
  });
});

function fakeClient(input: { rows: unknown[]; error?: unknown }) {
  const query = {
    from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockResolvedValue({ data: input.rows, error: input.error ?? null });
  return query;
}
