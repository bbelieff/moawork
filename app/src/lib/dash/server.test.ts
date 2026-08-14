import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import type { DashboardSource } from "./server";
import { loadDashboardPageData } from "./server";

const ownerCtx: Ctx = {
  user: { id: "user-a", email: "owner@example.com", name: "Owner", avatar_url: null, created_at: "2026-01-01T00:00:00Z" },
  org: { id: "org-a", name: "Org A", plan_tier: "pro", created_at: "2026-01-01T00:00:00Z" },
  role: "owner",
  scope: "all",
};

const memberCtx: Ctx = {
  ...ownerCtx,
  user: { ...ownerCtx.user, id: "member-a", email: "member@example.com" },
  role: "member",
  scope: "assigned",
};

function fixtureSource(options: {
  fail?: keyof DashboardSource;
  counts?: { companies: number; deals: number };
} = {}): DashboardSource {
  const counts = options.counts ?? { companies: 1, deals: 1 };
  const fail = (operation: keyof DashboardSource) => {
    if (options.fail === operation) throw new Error("upstream detail must not escape");
  };
  return {
    async loadCrm(ctx) {
      fail("loadCrm");
      const companies = Array.from({ length: counts.companies }, (_, index) => ({
        id: `company-${index}`,
        org_id: ctx.org.id,
        name: `Company ${index}`,
        biz_type: null,
        region: null,
        owner_name: null,
        phone: null,
        email: null,
        revenue: null,
        founded_on: null,
        homepage: null,
        assigned_to: ctx.scope === "assigned" ? ctx.user.id : "user-a",
        created_at: "2026-08-01T00:00:00Z",
      }));
      const deals = Array.from({ length: counts.deals }, (_, index) => ({
        id: `deal-${index}`,
        org_id: ctx.org.id,
        company_id: companies[0]?.id ?? null,
        pipeline_id: "pipeline-a",
        stage_id: "stage-a",
        assigned_to: ctx.scope === "assigned" ? ctx.user.id : "user-a",
        title: `Deal ${index}`,
        amount: 1000,
        status_note: null,
        applied_on: null,
        custom: {},
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      }));
      const stages = [{ id: "stage-a", pipeline_id: "pipeline-a", name: "Lead", sort_order: 0, kind: "work" as const }];
      const pipelines = [{ id: "pipeline-a", org_id: ctx.org.id, name: "Sales", stages }];
      return { companies, deals, pipelines, stages };
    },
    async loadDashboardInputs(ctx, visibleDealIds) {
      fail("loadDashboardInputs");
      return {
        fieldDefs: [],
        settlements: [...visibleDealIds].map((dealId, index) => ({
          id: `settlement-${index}`,
          org_id: ctx.org.id,
          deal_id: dealId,
          down_payment: 100,
          down_paid_at: null,
          exec_amount: 1000,
          fee_pct: 10,
          fee_paid_at: "2026-08-10",
          fee_amount: 100,
          total_revenue: 200,
          d180: null,
          d365: null,
          created_at: "2026-08-10T00:00:00Z",
        })),
      };
    },
    async loadBoards() {
      fail("loadBoards");
      return { boardCount: 2, itemCount: 3 };
    },
    async loadNotices() {
      fail("loadNotices");
      return [];
    },
    async loadLedger(_ctx, visibleDealIds) {
      fail("loadLedger");
      return { entryCount: visibleDealIds.length, expectedFeeTotal: visibleDealIds.length * 100 };
    },
  };
}

describe("loadDashboardPageData", () => {
  it("builds the page model from the same scoped source without local fallback", async () => {
    const result = await loadDashboardPageData(ownerCtx, {
      source: fixtureSource(),
      month: "2026-08",
      now: () => new Date("2026-08-15T00:00:00Z"),
    });
    expect(result.core.status).toBe("ready");
    if (result.core.status !== "ready") throw new Error("expected core");
    expect(result.core.data.dash.totalCompanies).toBe(1);
    expect(result.core.data.dash.totalDeals).toBe(1);
    expect(result.core.data.dash.settlementAll.totalRevenueSum).toBe(200);
    expect(result.boards).toEqual({ status: "ready", data: { boardCount: 2, itemCount: 3 } });
    expect(result.ledger).toEqual({ status: "ready", data: { entryCount: 1, expectedFeeTotal: 100 } });
  });

  it.each([
    ["loadDashboardInputs", "core", "dashboard"],
    ["loadBoards", "boards", "boards"],
    ["loadNotices", "notices", "notices"],
    ["loadLedger", "ledger", "ledger"],
  ] as const)("maps %s failure to a typed %s unavailable segment", async (fail, key, operation) => {
    const result = await loadDashboardPageData(ownerCtx, { source: fixtureSource({ fail }) });
    expect(result[key]).toEqual({ status: "unavailable", operation });
  });

  it("keeps the active organization and assigned member scope in every read", async () => {
    const result = await loadDashboardPageData(memberCtx, {
      source: fixtureSource({ counts: { companies: 2, deals: 2 } }),
    });
    expect(result.core.status).toBe("ready");
    if (result.core.status !== "ready") throw new Error("expected core");
    expect(result.core.data.deals).toHaveLength(2);
    expect(result.core.data.deals.every((deal) => deal.org_id === "org-a")).toBe(true);
    expect(result.core.data.deals.every((deal) => deal.assigned_to === "member-a")).toBe(true);
  });

  it("re-reads persisted source state with a fresh dashboard request", async () => {
    const counts = { companies: 1, deals: 1 };
    const first = await loadDashboardPageData(ownerCtx, { source: fixtureSource({ counts }) });
    counts.deals = 2;
    const second = await loadDashboardPageData(ownerCtx, { source: fixtureSource({ counts }) });
    expect(first.core.status === "ready" && first.core.data.dash.totalDeals).toBe(1);
    expect(second.core.status === "ready" && second.core.data.dash.totalDeals).toBe(2);
  });

  it("creates one cookie-bound client per request and does not expose DB error details", async () => {
    const failedQuery = {
      select: () => failedQuery,
      eq: () => failedQuery,
      order: () => failedQuery,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: null,
        error: { message: "secret upstream detail", code: "42501" },
      })),
    };
    const db = { from: vi.fn(() => failedQuery) } as unknown as SupabaseClient;
    const clientFactory = vi.fn(async () => db);
    const result = await loadDashboardPageData(ownerCtx, { clientFactory });
    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(result.core).toEqual({ status: "unavailable", operation: "crm" });
    expect(JSON.stringify(result)).not.toContain("secret upstream detail");
  });
});
