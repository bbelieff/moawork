import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * QA #885 · migration 174 — 원장 고치기·지우기(지운 표시)·계약금 여러 건을 035+104+174 위에서 실제로 돌려 본다.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), `../supabase/migrations/${file}`), "utf8");
const MIGRATIONS = [read("035_ledger.sql"), read("104_bbe240_deal_ledger_vat_wiring.sql"), read("174_deal_ledger_edit_delete.sql")];

const id = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const ids = { org: id("1"), owner: id("10"), member: id("11"), other: id("12"), deal: id("20"), otherDeal: id("21") };

// 권한표 대역: perms 표에 있는 (사용자, 권한)만 허용한다.
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid not null, user_id uuid not null, role text, scope text, primary key(org_id,user_id));
  create table public.deals(id uuid primary key default gen_random_uuid(), org_id uuid not null, assigned_to uuid);
  create table public.activities(id uuid primary key default gen_random_uuid(), org_id uuid not null, deal_id uuid, type text not null, content text, actor uuid, at timestamptz not null default now());
  create table public.perms(user_id uuid, perm text);
  create function public.effective_permission(p_org_id uuid, p_perm text) returns boolean language sql stable as
    $$ select exists(select 1 from public.perms where user_id = auth.uid() and perm = p_perm) $$;
  create function public.is_org_member(p_org_id uuid) returns boolean language sql stable as
    $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid()) $$;
  create function public.org_role(p_org_id uuid) returns text language sql stable as
    $$ select role from public.org_members where org_id=p_org_id and user_id=auth.uid() $$;
  create function public.org_scope(p_org_id uuid) returns text language sql stable as
    $$ select scope from public.org_members where org_id=p_org_id and user_id=auth.uid() $$;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;

  insert into public.orgs(id) values ('${ids.org}');
  insert into public.users(id) values ('${ids.owner}'), ('${ids.member}'), ('${ids.other}');
  insert into public.org_members values
    ('${ids.org}','${ids.owner}','owner','all'),
    ('${ids.org}','${ids.member}','member','assigned'),
    ('${ids.org}','${ids.other}','member','assigned');
  insert into public.deals(id,org_id,assigned_to) values ('${ids.deal}','${ids.org}','${ids.member}'), ('${ids.otherDeal}','${ids.org}','${ids.other}');
  insert into public.perms values
    ('${ids.owner}','work.item_upsert'), ('${ids.owner}','work.item_delete'),
    ('${ids.member}','work.item_upsert'), ('${ids.other}','work.item_upsert');
`;

let db: PGlite | undefined;
afterEach(async () => { await db?.close(); db = undefined; });

async function setup(): Promise<PGlite> {
  const g = new PGlite();
  await g.exec(SCHEMA);
  for (const sql of MIGRATIONS) await g.exec(sql);
  return g;
}
const as = (g: PGlite, uid: string) => g.exec(`select set_config('app.uid','${uid}',false)`);
async function addEntry(g: PGlite, kind: string, amount: number, deal = ids.deal): Promise<string> {
  const r = await g.query<{ add_deal_ledger_entry: string }>(
    `select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`,
    [deal, kind, amount, amount, "2026-10-01", "2026-10-01", "2026-10-01"],
  );
  return r.rows[0].add_deal_ledger_entry;
}

describe("migration 174 — 원장 고치기·지우기·계약금 여러 건", () => {
  it("계약금을 여러 건 넣을 수 있다(분납)", async () => {
    db = await setup();
    await as(db, ids.member);
    await addEntry(db, "contract_deposit", 500_000);
    await addEntry(db, "contract_deposit", 500_000);
    const n = await db.query<{ n: number }>(`select count(*)::int n from deal_ledger_entries where kind='contract_deposit'`);
    expect(n.rows[0].n).toBe(2);
  });

  it("고치기: 값·귀속월이 바뀌고 활동 기록에 전후가 남는다", async () => {
    db = await setup();
    await as(db, ids.member);
    const entry = await addEntry(db, "fee", 1_000_000);
    await db.query(`select update_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [entry, 2_000_000, 0, "2026-11-15", null, false, false]);
    const row = await db.query<{ amount: string; attribution_month: string; updated_by: string }>(
      `select amount, attribution_month::text, updated_by from deal_ledger_entries where id=$1`, [entry]);
    expect(row.rows[0]).toMatchObject({ amount: "2000000", attribution_month: "2026-11-01", updated_by: ids.member });
    const log = await db.query<{ content: string }>(`select content from activities where deal_id=$1`, [ids.deal]);
    expect(log.rows[0].content).toContain("1,000,000원");
    expect(log.rows[0].content).toContain("2,000,000원");
  });

  it("고치기: 원장 접근권이 없으면(남의 딜) 막는다, 104 CHECK 도 그대로 막는다", async () => {
    db = await setup();
    await as(db, ids.other);
    const theirs = await addEntry(db, "fee", 1_000_000, ids.otherDeal);
    await as(db, ids.member);
    await expect(db.query(`select update_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [theirs, 1, 0, "2026-10-01", null, false, false]))
      .rejects.toThrow(/access denied/);
    const mine = await addEntry(db, "fee", 1_000_000);
    await expect(db.query(`select update_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [mine, 1_000_000, 2_000_000, "2026-10-01", "2026-10-01", false, false]))
      .rejects.toThrow();
  });

  it("지우기: 본인이 넣은 항목은 지울 수 있고, 지운 항목은 목록·요약에서 빠지며 행은 남는다", async () => {
    db = await setup();
    await as(db, ids.member);
    const keep = await addEntry(db, "fee", 1_000_000);
    const gone = await addEntry(db, "fee", 3_000_000);
    await db.query(`select delete_deal_ledger_entry($1)`, [gone]);
    await db.exec("set role authenticated");
    const visible = await db.query<{ id: string }>(`select id from deal_ledger_entries`);
    await db.exec("reset role");
    expect(visible.rows.map((r) => r.id)).toEqual([keep]);
    const summary = await db.query<{ ledger_total: string; entry_count: string }>(`select ledger_total::text, entry_count::text from deal_ledger_summary($1)`, [ids.deal]);
    expect(summary.rows[0]).toEqual({ ledger_total: "1000000", entry_count: "1" });
    const stored = await db.query<{ deleted_by: string }>(`select deleted_by from deal_ledger_entries where id=$1`, [gone]);
    expect(stored.rows[0].deleted_by).toBe(ids.member);
    await expect(db.query(`select delete_deal_ledger_entry($1)`, [gone])).rejects.toThrow(/not found/);
  });

  it("지우기: 남이 넣은 항목은 항목 삭제 권한이 있어야 지운다", async () => {
    db = await setup();
    await as(db, ids.owner);
    const byOwner = await addEntry(db, "fee", 1_000_000);
    await as(db, ids.member);
    await expect(db.query(`select delete_deal_ledger_entry($1)`, [byOwner])).rejects.toThrow(/access denied/);
    const byMember = await addEntry(db, "fee", 2_000_000);
    await as(db, ids.owner);
    await db.query(`select delete_deal_ledger_entry($1)`, [byMember]);
    const left = await db.query<{ n: number }>(`select count(*)::int n from deal_ledger_entries where deleted_at is null`);
    expect(left.rows[0].n).toBe(1);
  });

  it("익명(anon)은 새 함수를 부를 수 없다", async () => {
    db = await setup();
    const grants = await db.query<{ anon: boolean; auth: boolean }>(`
      select has_function_privilege('anon','public.update_deal_ledger_entry(uuid,numeric,numeric,date,date,boolean,boolean)','execute') anon,
             has_function_privilege('authenticated','public.update_deal_ledger_entry(uuid,numeric,numeric,date,date,boolean,boolean)','execute') auth`);
    expect(grants.rows[0]).toEqual({ anon: false, auth: true });
  });
});
