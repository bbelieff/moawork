import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { loadCompaniesView, type CompaniesViewSource } from "./server";

const ctx = { user: { id: "user-1" }, org: { id: "org-1" }, role: "member", scope: "assigned" } as Ctx;
const company = {
  id: "company-1", org_id: "org-1", name: "모아상사", biz_type: null, region: null,
  owner_name: null, phone: null, email: null, revenue: null, founded_on: null,
  homepage: null, assigned_to: "user-1", created_at: "2026-01-01T00:00:00.000Z",
};
const deal = {
  id: "deal-1", org_id: "org-1", company_id: "company-1", title: "정책자금 업무",
  pipeline_id: null, stage_id: null, assigned_to: "user-1", amount: null, custom: {},
  status_note: null, fee_terms: null, applied_on: null,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

function source(overrides: Partial<CompaniesViewSource> = {}): CompaniesViewSource {
  return {
    loadCompanies: vi.fn(async () => [company]),
    loadDeals: vi.fn(async () => [deal]),
    loadLedger: vi.fn(async () => ({ total: 1000, received: 400, outstanding: 600, fee: 300 })),
    ...overrides,
  } as CompaniesViewSource;
}

describe("loadCompaniesView", () => {
  it("keeps one company and links many deals by company_id without copying company fields", async () => {
    const db = source({ loadDeals: vi.fn(async () => [deal, { ...deal, id: "deal-2" }]) });
    const result = await loadCompaniesView(ctx, { source: db });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.companies).toHaveLength(1);
      expect(result.companies[0].deals.map(({ deal }) => deal.id)).toEqual(["deal-1", "deal-2"]);
      expect(result.companies[0].company).toEqual(company);
    }
  });

  it("does not disguise a CRM failure as zero companies", async () => {
    const result = await loadCompaniesView(ctx, { source: source({ loadCompanies: vi.fn(async () => { throw new Error("down"); }) }) });
    expect(result).toEqual({ status: "error" });
  });

  it("keeps companies visible and marks the deals segment when deals fail", async () => {
    const result = await loadCompaniesView(ctx, { source: source({ loadDeals: vi.fn(async () => { throw new Error("down"); }) }) });
    expect(result).toEqual({ status: "ready", companies: [{ company, deals: [] }], dealsStatus: "error" });
  });

  it("isolates a ledger failure instead of reporting zero won", async () => {
    const result = await loadCompaniesView(ctx, { source: source({ loadLedger: vi.fn(async () => { throw new Error("down"); }) }) });
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.companies[0].deals[0].ledger).toEqual({ status: "error" });
  });
});
