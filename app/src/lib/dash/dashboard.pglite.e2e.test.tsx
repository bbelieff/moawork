import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardSourceSummary } from "@/components/dash/DashboardSourceSummary";
import type { Ctx, Settlement } from "@/lib/types";
import type { DashboardSource } from "./server";
import { loadDashboardPageData } from "./server";

type DbRow = Record<string, unknown>;

const owner: Ctx = {
  user: { id: "owner-a", email: "owner@example.test", name: "Owner", avatar_url: null, created_at: "2026-01-01T00:00:00Z" },
  org: { id: "org-a", name: "Org A", plan_tier: "pro", created_at: "2026-01-01T00:00:00Z" },
  role: "owner",
  scope: "all",
};

const member: Ctx = {
  ...owner,
  user: { ...owner.user, id: "member-a", email: "member@example.test" },
  role: "member",
  scope: "assigned",
};

function source(db: PGlite): DashboardSource {
  return {
    async loadCrm(ctx) {
      const assigned = ctx.role === "member" && ctx.scope === "assigned";
      const dealsResult = await db.query<DbRow>(
        `select * from deals where org_id = $1${assigned ? " and assigned_to = $2" : ""} order by id`,
        assigned ? [ctx.org.id, ctx.user.id] : [ctx.org.id],
      );
      const companiesResult = await db.query<DbRow>(
        `select distinct c.* from companies c left join deals d on d.company_id = c.id
         where c.org_id = $1${assigned ? " and d.assigned_to = $2" : ""} order by c.id`,
        assigned ? [ctx.org.id, ctx.user.id] : [ctx.org.id],
      );
      const deals = dealsResult.rows.map((row) => ({
        ...row,
        amount: Number(row.amount),
        custom: {},
      })) as never[];
      const companies = companiesResult.rows as never[];
      const stages = [{ id: "stage-a", pipeline_id: "pipeline-a", name: "진행", sort_order: 0, kind: "work" as const }];
      return {
        deals,
        companies,
        stages,
        pipelines: [{ id: "pipeline-a", org_id: ctx.org.id, name: "업무", stages }],
      };
    },
    async loadDashboardInputs(ctx, visibleDealIds) {
      const result = await db.query<DbRow>("select * from settlements where org_id = $1 order by id", [ctx.org.id]);
      return {
        fieldDefs: [],
        settlements: result.rows
          .filter((row) => visibleDealIds.has(String(row.deal_id)))
          .map((row) => ({
            ...row,
            down_payment: Number(row.down_payment),
            exec_amount: Number(row.exec_amount),
            fee_pct: Number(row.fee_pct),
            fee_amount: Number(row.fee_amount),
            total_revenue: Number(row.total_revenue),
          } as unknown as Settlement)),
      };
    },
    async loadBoards(ctx) {
      const boards = await db.query<{ count: number }>("select count(*)::int as count from boards where org_id = $1", [ctx.org.id]);
      const items = await db.query<{ count: number }>("select count(*)::int as count from items where org_id = $1", [ctx.org.id]);
      return { boardCount: boards.rows[0].count, itemCount: items.rows[0].count };
    },
    async loadNotices() {
      return [];
    },
    async loadLedger(ctx, visibleDealIds) {
      const result = await db.query<{ count: number; total: number }>(
        "select count(*)::int as count, coalesce(sum(expected_fee), 0)::int as total from ledger where org_id = $1 and deal_id = any($2::text[])",
        [ctx.org.id, visibleDealIds],
      );
      return { entryCount: result.rows[0].count, expectedFeeTotal: result.rows[0].total };
    },
  };
}

describe("dashboard database-to-page boundary", () => {
  const databases: PGlite[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

  it("reads a mutable DB fixture, renders values, re-reads, and isolates organization/member scope", async () => {
    const db = new PGlite();
    databases.push(db);
    await db.exec(`
      create table companies (id text primary key, org_id text, name text, biz_type text, region text, owner_name text, phone text, email text, revenue int, founded_on text, homepage text, assigned_to text, created_at text);
      create table deals (id text primary key, org_id text, company_id text, pipeline_id text, stage_id text, assigned_to text, title text, amount int, status_note text, applied_on text, created_at text, updated_at text);
      create table settlements (id text primary key, org_id text, deal_id text, down_payment int, down_paid_at text, exec_amount int, fee_pct int, fee_paid_at text, fee_amount int, total_revenue int, d180 text, d365 text, created_at text);
      create table boards (id text primary key, org_id text);
      create table items (id text primary key, org_id text, board_id text);
      create table ledger (id text primary key, org_id text, deal_id text, expected_fee int);
      insert into companies values
        ('company-a','org-a','실제 회사 A',null,null,null,null,null,null,null,null,'owner-a','2026-08-01T00:00:00Z'),
        ('company-b','org-a','실제 회사 B',null,null,null,null,null,null,null,null,'member-a','2026-08-01T00:00:00Z'),
        ('company-x','org-x','다른 조직',null,null,null,null,null,null,null,null,'other','2026-08-01T00:00:00Z');
      insert into deals values
        ('deal-a','org-a','company-a','pipeline-a','stage-a','owner-a','실제 딜 A',1000,null,null,'2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
        ('deal-b','org-a','company-b','pipeline-a','stage-a','member-a','실제 딜 B',2000,null,null,'2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
        ('deal-x','org-x','company-x','pipeline-x','stage-x','other','격리 딜',9000,null,null,'2026-08-01T00:00:00Z','2026-08-01T00:00:00Z');
      insert into settlements values
        ('settlement-a','org-a','deal-a',100,null,1000,10,'2026-08-10',100,200,null,null,'2026-08-10T00:00:00Z'),
        ('settlement-b','org-a','deal-b',200,null,2000,10,'2026-08-10',200,400,null,null,'2026-08-10T00:00:00Z'),
        ('settlement-x','org-x','deal-x',900,null,9000,10,'2026-08-10',900,1800,null,null,'2026-08-10T00:00:00Z');
      insert into boards values ('board-a','org-a'), ('board-x','org-x');
      insert into items values ('item-a','org-a','board-a'), ('item-x','org-x','board-x');
      insert into ledger values ('ledger-a','org-a','deal-a',100), ('ledger-b','org-a','deal-b',200), ('ledger-x','org-x','deal-x',900);
    `);

    const first = await loadDashboardPageData(owner, { source: source(db), month: "2026-08" });
    expect(first.core.status).toBe("ready");
    if (first.core.status !== "ready") throw new Error("expected owner dashboard");
    expect(first.core.data.dash).toMatchObject({ totalCompanies: 2, totalDeals: 2 });
    expect(first.core.data.dash.settlementAll.totalRevenueSum).toBe(600);
    const html = renderToStaticMarkup(<DashboardSourceSummary boards={first.boards} ledger={first.ledger} />);
    expect(html).toContain("1");
    expect(html).toContain("300");

    await db.exec("insert into deals values ('deal-c','org-a','company-a','pipeline-a','stage-a','owner-a','재조회 딜',3000,null,null,'2026-08-15T00:00:00Z','2026-08-15T00:00:00Z')");
    const reread = await loadDashboardPageData(owner, { source: source(db), month: "2026-08" });
    expect(reread.core.status === "ready" && reread.core.data.dash.totalDeals).toBe(3);

    const scoped = await loadDashboardPageData(member, { source: source(db), month: "2026-08" });
    expect(scoped.core.status).toBe("ready");
    if (scoped.core.status !== "ready") throw new Error("expected member dashboard");
    expect(scoped.core.data.deals.map((deal) => deal.id)).toEqual(["deal-b"]);
    expect(scoped.core.data.dash.settlementAll.totalRevenueSum).toBe(400);
    expect(JSON.stringify(scoped)).not.toContain("deal-x");
    expect(JSON.stringify(scoped)).not.toContain("settlement-x");
  });
});
