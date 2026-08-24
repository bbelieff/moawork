import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { CompaniesWorkspace } from "@/components/companies/CompaniesWorkspace";
import type { Company, Ctx, Deal } from "@/lib/types";
import { loadCompaniesView, type CompaniesViewSource } from "./server";

type DbRow = Record<string, unknown>;
const owner = { user: { id: "owner-a" }, org: { id: "org-a" }, role: "owner", scope: "all" } as Ctx;
const member = { user: { id: "member-a" }, org: { id: "org-a" }, role: "member", scope: "assigned" } as Ctx;

function source(db: PGlite): CompaniesViewSource {
  const scoped = (ctx: Ctx) => ctx.role === "member" && ctx.scope === "assigned";
  return {
    async loadCompanies(ctx) {
      const result = await db.query<DbRow>(
        `select * from companies where org_id=$1${scoped(ctx) ? " and assigned_to=$2" : ""} order by id`,
        scoped(ctx) ? [ctx.org.id, ctx.user.id] : [ctx.org.id],
      );
      return result.rows as unknown as Company[];
    },
    async loadDeals(ctx) {
      const result = await db.query<DbRow>(
        `select * from deals where org_id=$1${scoped(ctx) ? " and assigned_to=$2" : ""} order by id`,
        scoped(ctx) ? [ctx.org.id, ctx.user.id] : [ctx.org.id],
      );
      return result.rows.map((row) => ({ ...row, amount: null, custom: {} })) as unknown as Deal[];
    },
    async loadLedger(ctx, dealId) {
      const result = await db.query<{ total: number; received: number; fee: number }>(
        "select coalesce(sum(amount),0)::int total, coalesce(sum(received),0)::int received, coalesce(sum(amount) filter(where kind='fee'),0)::int fee from ledger where org_id=$1 and deal_id=$2",
        [ctx.org.id, dealId],
      );
      const row = result.rows[0];
      // #531 — 표는 합계가 아니라 건별 계약금·수수료·수납일을 그린다. entry 원본도 같이 넘긴다.
      const detail = await db.query<DbRow>(
        "select * from ledger where org_id=$1 and deal_id=$2 order by id",
        [ctx.org.id, dealId],
      );
      const entries = detail.rows.map((entry) => ({
        id: String(entry.id),
        dealId,
        kind: entry.kind as "fee" | "contract_deposit",
        amount: Number(entry.amount),
        receivedAmount: Number(entry.received),
        occurredOn: "2026-08-01",
        paidOn: Number(entry.received) > 0 ? "2026-08-02" : null,
        attributionMonth: "2026-08",
        vatIncluded: false,
        taxInvoiceIssued: false,
      }));
      return { total: row.total, received: row.received, outstanding: row.total - row.received, fee: row.fee, entries };
    },
  };
}

describe("companies DB fixture → read model → page", () => {
  const databases: PGlite[] = [];
  afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

  it("re-reads company edits and isolates organization and assigned scope", async () => {
    const db = new PGlite(); databases.push(db);
    await db.exec(`
      create table companies(id text primary key,org_id text,name text,biz_type text,region text,owner_name text,phone text,email text,revenue int,founded_on text,homepage text,assigned_to text,created_at text);
      create table deals(id text primary key,org_id text,company_id text,pipeline_id text,stage_id text,assigned_to text,title text,status_note text,applied_on text,created_at text,updated_at text);
      create table ledger(id text primary key,org_id text,deal_id text,kind text,amount int,received int);
      insert into companies values ('company-a','org-a','수정 전 회사',null,'서울',null,null,null,null,null,null,'owner-a','2026-08-01'),('company-b','org-a','담당 회사',null,'부산',null,null,null,null,null,null,'member-a','2026-08-01'),('company-x','org-x','타 조직 회사',null,null,null,null,null,null,null,null,'other','2026-08-01');
      insert into deals values ('deal-a','org-a','company-a',null,null,'owner-a','업무 A',null,null,'2026-08-01','2026-08-01'),('deal-b','org-a','company-b',null,null,'member-a','업무 B',null,null,'2026-08-01','2026-08-01'),('deal-x','org-x','company-x',null,null,'other','격리 업무',null,null,'2026-08-01','2026-08-01');
      insert into ledger values ('ledger-a','org-a','deal-a','fee',1000,400),('ledger-b','org-a','deal-b','contract_deposit',2000,2000),('ledger-x','org-x','deal-x','fee',9000,0);
    `);
    const first = await loadCompaniesView(owner, { source: source(db) });
    expect(first.status).toBe("ready");
    const firstHtml = renderToStaticMarkup(<CompaniesWorkspace model={first} />);
    expect(firstHtml).toContain("수정 전 회사");
    expect(firstHtml).toContain("1,000원");
    expect(firstHtml).not.toContain("타 조직 회사");
    expect(firstHtml).not.toContain("9,000원");

    await db.exec("update companies set name='수정 후 회사' where id='company-a'");
    const reread = await loadCompaniesView(owner, { source: source(db) });
    const rereadHtml = renderToStaticMarkup(<CompaniesWorkspace model={reread} />);
    expect(rereadHtml).toContain("수정 후 회사");
    expect(rereadHtml).not.toContain("수정 전 회사");

    const assigned = await loadCompaniesView(member, { source: source(db) });
    const assignedHtml = renderToStaticMarkup(<CompaniesWorkspace model={assigned} />);
    expect(assignedHtml).toContain("담당 회사");
    expect(assignedHtml).toContain("업무 B");
    expect(assignedHtml).not.toContain("수정 후 회사");
    expect(assignedHtml).not.toContain("업무 A");
  });
});
