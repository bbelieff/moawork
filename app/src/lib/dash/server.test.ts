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
        fee_terms: null,
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

  it("Issue 857 — 거래에 기대는 읽기(inputs·원장·체크리스트 훅)는 보드·공지를 기다리지 않는다", async () => {
    const base = fixtureSource();
    let releaseBoards!: () => void;
    let releaseNotices!: () => void;
    const loadLedger = vi.fn(base.loadLedger);
    const loadDashboardInputs = vi.fn(base.loadDashboardInputs);
    const onCrmDeals = vi.fn();
    const source: DashboardSource = {
      ...base,
      loadLedger,
      loadDashboardInputs,
      loadBoards: (ctx) => new Promise((resolve) => { releaseBoards = () => resolve(base.loadBoards(ctx)); }),
      loadNotices: (ctx) => new Promise((resolve) => { releaseNotices = () => resolve(base.loadNotices(ctx)); }),
    };
    const pending = loadDashboardPageData(ownerCtx, { source, onCrmDeals });
    await vi.waitFor(() => {
      expect(loadLedger).toHaveBeenCalledTimes(1);
      expect(loadDashboardInputs).toHaveBeenCalledTimes(1);
      expect(onCrmDeals).toHaveBeenCalledWith(["deal-0"]);
    });
    releaseBoards();
    releaseNotices();
    const result = await pending;
    expect(result.core.status).toBe("ready");
    expect(result.boards).toEqual({ status: "ready", data: { boardCount: 2, itemCount: 3 } });
    expect(result.ledger.status).toBe("ready");
  });

  it("Issue 857 — crm 이 실패하면 core·원장은 crm 이유로 unavailable, 보드·공지는 따로 판단", async () => {
    const result = await loadDashboardPageData(ownerCtx, { source: fixtureSource({ fail: "loadCrm" }) });
    expect(result.core).toEqual({ status: "unavailable", operation: "crm" });
    expect(result.ledger).toEqual({ status: "unavailable", operation: "crm" });
    expect(result.boards.status).toBe("ready");
    expect(result.notices.status).toBe("ready");
  });

  it("Issue 857 — 계측 콜백이 던져도 묶음은 «불러오지 못함» 이 되지 않는다", async () => {
    const result = await loadDashboardPageData(ownerCtx, {
      source: fixtureSource(),
      onStage: () => { throw new Error("log sink down"); },
    });
    expect(result.core.status).toBe("ready");
    expect(result.boards.status).toBe("ready");
    expect(result.ledger.status).toBe("ready");
  });

  it("Issue 857 — 보드 행 수는 행을 읽지 않고 같은 조건으로 센다(보드 id 100개씩)", async () => {
    const calls: Array<{ table: string; ops: Array<[string, ...unknown[]]> }> = [];
    const boards = Array.from({ length: 150 }, (_, index) => ({ id: `board-${index}`, org_id: "org-a", source: index === 0 ? "user.section-preset/x" : null }));
    const db = {
      from: vi.fn((table: string) => {
        const entry = { table, ops: [] as Array<[string, ...unknown[]]> };
        calls.push(entry);
        const builder: Record<string, unknown> = new Proxy({}, {
          get(_target, property) {
            if (property === "then") {
              const result = table === "boards"
                ? { data: boards, error: null }
                : table === "items"
                  ? { data: null, error: null, count: (entry.ops.find(([name]) => name === "in")?.[2] as string[]).length }
                  : { data: null, error: { message: "not in this test" } };
              return (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result));
            }
            return (...args: unknown[]) => {
              entry.ops.push([String(property), ...args]);
              return builder;
            };
          },
        });
        return builder;
      }),
    } as unknown as SupabaseClient;
    const result = await loadDashboardPageData(ownerCtx, { clientFactory: async () => db });
    const itemCalls = calls.filter((call) => call.table === "items");
    expect(itemCalls).toHaveLength(2);
    for (const call of itemCalls) {
      expect(call.ops).toContainEqual(["select", "id", { count: "exact", head: true }]);
      expect(call.ops).toContainEqual(["eq", "org_id", "org-a"]);
      expect(call.ops).toContainEqual(["is", "deleted_at", null]);
      expect(call.ops).toContainEqual(["is", "archived_at", null]);
    }
    expect(itemCalls.map((call) => (call.ops.find(([name]) => name === "in")?.[2] as string[]).length)).toEqual([100, 49]);
    expect(calls.some((call) => call.table === "item_values")).toBe(false);
    // 섹션 프리셋 보드는 보드 수에서 빠지고, 그 보드의 행도 세지 않는다.
    expect(result.boards).toEqual({ status: "ready", data: { boardCount: 149, itemCount: 149 } });
  });

  it("Issue 857 — 보드 행 수 읽기가 실패하면 0 이 아니라 «불러오지 못함»", async () => {
    const db = {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = new Proxy({}, {
          get(_target, property) {
            if (property === "then") {
              const result = table === "boards"
                ? { data: [{ id: "board-1", org_id: "org-a", source: null }], error: null }
                : { data: null, error: table === "items" ? null : { message: "x" }, count: null };
              return (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result));
            }
            return () => builder;
          },
        });
        return builder;
      }),
    } as unknown as SupabaseClient;
    const result = await loadDashboardPageData(ownerCtx, { clientFactory: async () => db });
    expect(result.boards).toEqual({ status: "unavailable", operation: "boards" });
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
