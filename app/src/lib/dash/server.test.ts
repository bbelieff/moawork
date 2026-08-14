import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmSource } from "@/lib/repo/supabase";
import type { Ctx } from "@/lib/types";
import { DashboardReadError, loadDashboardPageData } from "./server";

const ctx: Ctx = {
  user: { id: "user-1", email: "owner@example.com", name: "Owner", avatar_url: null, created_at: "2026-01-01T00:00:00Z" },
  org: { id: "org-1", name: "Org", plan_tier: "pro", created_at: "2026-01-01T00:00:00Z" },
  role: "owner",
  scope: "all",
};

function source(): CrmSource {
  return {
    kind: "supabase",
    listPipelines: vi.fn(async () => [{ id: "pipeline-1", org_id: "org-1", name: "Sales" }]),
    listStages: vi.fn(async () => [{ id: "stage-1", pipeline_id: "pipeline-1", name: "Lead", sort_order: 0, kind: "lead" }]),
    getStage: vi.fn(),
    listCompanies: vi.fn(async () => [{
      id: "company-1", org_id: "org-1", name: "Company", biz_type: null, region: null,
      owner_name: null, phone: null, email: null, revenue: null, founded_on: null,
      homepage: null, assigned_to: "user-1", created_at: "2026-01-01T00:00:00Z",
    }]),
    getCompany: vi.fn(), createCompany: vi.fn(), updateCompany: vi.fn(), deleteCompany: vi.fn(),
    listDeals: vi.fn(async () => [{
      id: "deal-1", org_id: "org-1", company_id: "company-1", pipeline_id: "pipeline-1",
      stage_id: "stage-1", assigned_to: "user-1", title: "Deal", amount: 1000,
      status_note: null, applied_on: null, custom: {}, created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    }]),
    getDeal: vi.fn(), createDeal: vi.fn(), updateDeal: vi.fn(), moveDeal: vi.fn(), deleteDeal: vi.fn(),
    listActivities: vi.fn(), createActivity: vi.fn(),
  } as unknown as CrmSource;
}

function query(result: { data: unknown[] | null; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: vi.fn(() => chain),
    order: () => chain,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
  return chain;
}

function client(options: { fieldError?: boolean; settlementError?: boolean } = {}) {
  const fieldRows = [{
    id: "field-1", org_id: "org-1", entity: "deal", key: "contract_status", label: "Contract",
    type: "select", options_jsonb: { options: [] }, module_key: null, sort_order: 0,
  }];
  const settlementRows = [{
    id: "settlement-1", org_id: "org-1", deal_id: "deal-1", down_payment: "100",
    down_paid_at: null, exec_amount: "1000", fee_pct: "10", fee_paid_at: "2026-08-10",
    fee_amount: "100", total_revenue: "200", d180: "2027-02-06", d365: "2027-08-10",
    created_at: "2026-08-10T00:00:00Z",
  }];
  return {
    from: vi.fn((table: string) => table === "field_defs"
      ? query({ data: options.fieldError ? null : fieldRows, error: options.fieldError ? { code: "42501" } : null })
      : query({ data: options.settlementError ? null : settlementRows, error: options.settlementError ? { code: "42501" } : null })),
  } as unknown as SupabaseClient;
}

describe("loadDashboardPageData", () => {
  it("constructs the CRM source and dashboard reads from the same request client", async () => {
    const db = client();
    const sourceFactory = vi.fn((received: SupabaseClient) => {
      expect(received).toBe(db);
      return source();
    });

    await loadDashboardPageData(ctx, {
      supabaseConfigured: true,
      clientFactory: async () => db,
      sourceFactory,
    });

    expect(sourceFactory).toHaveBeenCalledOnce();
  });

  it("uses request-scoped Supabase CRM and settlement rows instead of LocalRepo", async () => {
    const db = client();
    const result = await loadDashboardPageData(ctx, {
      source: source(),
      clientFactory: async () => db,
      month: "2026-08",
      now: () => new Date("2026-08-15T00:00:00Z"),
    });

    expect(result.sourceKind).toBe("supabase");
    expect(result.dash.totalCompanies).toBe(1);
    expect(result.dash.totalDeals).toBe(1);
    expect(result.dash.settlementAll).toMatchObject({
      available: true,
      provisional: false,
      count: 1,
      downPaymentSum: 100,
      feeSum: 100,
      totalRevenueSum: 200,
    });
    expect(db.from).toHaveBeenCalledWith("field_defs");
    expect(db.from).toHaveBeenCalledWith("settlements");
    const settlementQuery = vi.mocked(db.from).mock.results[1]?.value as { in: ReturnType<typeof vi.fn> };
    expect(settlementQuery.in).toHaveBeenCalledWith("deal_id", ["deal-1"]);
  });

  it("does not query settlements when no deals are visible", async () => {
    const db = client();
    const emptySource = source();
    vi.mocked(emptySource.listDeals).mockResolvedValue([]);

    await loadDashboardPageData(ctx, {
      source: emptySource,
      clientFactory: async () => db,
    });

    expect(db.from).not.toHaveBeenCalledWith("settlements");
  });

  it("fails closed when the DB read fails instead of returning fake zeroes", async () => {
    await expect(loadDashboardPageData(ctx, {
      source: source(),
      clientFactory: async () => client({ settlementError: true }),
    })).rejects.toBeInstanceOf(DashboardReadError);
  });
});
