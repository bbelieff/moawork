import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { loadCompaniesView } from "./server";

const ctx = { user: { id: "user-1" }, org: { id: "org-1" } } as Ctx;

function client(options: { companies?: unknown[]; deals?: unknown[]; crmError?: string; ledgerError?: string } = {}) {
  const from = vi.fn((table: string) => {
    if (table === "companies" || table === "deals") {
      const rows = table === "companies" ? options.companies ?? [] : options.deals ?? [];
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query),
        order: vi.fn(() => query), then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: options.crmError ? { message: options.crmError } : null }),
      };
      return query;
    }
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      order: vi.fn(async () => ({ data: options.ledgerError ? null : [], error: options.ledgerError ? { message: options.ledgerError } : null })),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string) => name === "can_access_deal_ledger"
    ? { data: true, error: null }
    : { data: [{ deal_id: "deal-1", fee_total: 0 }], error: null });
  return { from, rpc };
}

const company = {
  id: "company-1", org_id: "org-1", name: "모아상사", biz_type: null, region: null,
  owner_name: null, phone: null, email: null, revenue: null, founded_on: null,
  homepage: null, assigned_to: "user-1", created_at: "2026-01-01T00:00:00.000Z",
};
const deal = {
  id: "deal-1", org_id: "org-1", company_id: "company-1", title: "정책자금 업무",
  pipeline_id: null, stage_id: null, assigned_to: "user-1", amount: null, custom: {},
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

describe("loadCompaniesView", () => {
  it("keeps one company and links many deals by company_id without copying company fields", async () => {
    const db = client({ companies: [company], deals: [deal, { ...deal, id: "deal-2" }] });
    const result = await loadCompaniesView(ctx, async () => db as never);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.companies).toHaveLength(1);
      expect(result.companies[0].deals.map(({ deal }) => deal.id)).toEqual(["deal-1", "deal-2"]);
      expect(result.companies[0].company).toEqual(company);
    }
  });

  it("does not disguise a CRM failure as zero companies", async () => {
    const result = await loadCompaniesView(ctx, async () => client({ crmError: "down" }) as never);
    expect(result).toEqual({ status: "error" });
  });

  it("isolates a ledger failure instead of reporting zero won", async () => {
    const result = await loadCompaniesView(ctx, async () => client({ companies: [company], deals: [deal], ledgerError: "down" }) as never);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.companies[0].deals[0].ledger).toEqual({ status: "error" });
  });
});
