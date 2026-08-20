import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * BBE-240 · add_deal_ledger_entry(9-인자) 가 실제로 강제하는가.
 *
 * 문자열 pin 테스트(migration-103.test.ts)는 SQL 원문이 맞는지만 잰다 — 이 파일은
 * 035+103 을 실제로 실행해 RPC 가 런타임에 진짜 그렇게 동작하는지 잰다.
 * 특히 계약금 중복 방지는 UI 비활성화만으로는 우회 가능하므로(수용기준), 서버가
 * «두 번째 contract_deposit 을 실제로 거부하는지» 를 반드시 실행형으로 확인한다.
 */
const ledger035 = readFileSync(resolve(process.cwd(), "../supabase/migrations/035_ledger.sql"), "utf8");
const vatWiring103 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/103_bbe240_deal_ledger_vat_wiring.sql"),
  "utf8",
);

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000010",
  deal: "00000000-0000-4000-8000-000000000020",
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid not null, user_id uuid not null, role text, scope text, primary key(org_id,user_id));
  create table public.deals(id uuid primary key default gen_random_uuid(), org_id uuid not null, assigned_to uuid);
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
  insert into public.users(id) values ('${ids.user}');
  insert into public.org_members(org_id,user_id,role,scope) values ('${ids.org}','${ids.user}','owner','all');
  insert into public.deals(id,org_id,assigned_to) values ('${ids.deal}','${ids.org}','${ids.user}');
`;

async function setup(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(ledger035);
  await db.exec(vatWiring103);
  await db.exec(`select set_config('app.uid','${ids.user}',false)`);
  return db;
}

describe("BBE-240 · add_deal_ledger_entry(9-인자) 런타임 동작", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
  });

  it("계약금 첫 입력은 성공한다", async () => {
    db = await setup();
    const result = await db.query<{ add_deal_ledger_entry: string }>(
      `select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`,
      [ids.deal, "contract_deposit", 1_000_000, 1_000_000, "2026-03-05", "2026-03-05", "2026-03-01"],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("같은 딜에 계약금을 두 번째 넣으면 서버가 거부한다 — UI 비활성화가 아니라 실제 강제", async () => {
    db = await setup();
    await db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [
      ids.deal, "contract_deposit", 1_000_000, 1_000_000, "2026-03-05", "2026-03-05", "2026-03-01",
    ]);
    await expect(
      db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [
        ids.deal, "contract_deposit", 500_000, 500_000, "2026-04-01", "2026-04-01", "2026-04-01",
      ]),
    ).rejects.toThrow(/contract deposit already recorded/);
  });

  it("수수료는 계약금과 달리 여러 번 넣을 수 있다(분할 입금)", async () => {
    db = await setup();
    // 부분입금(받은 금액 < 금액)은 035 원 규약대로 paid_on 이 null 이어야 한다 — 완납일 때만
    // paid_on 이 채워진다. 여기서는 "여러 번 넣을 수 있다"만 재는 것이라 둘 다 부분입금으로 둔다.
    await db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [
      ids.deal, "fee", 5_000_000, 2_000_000, "2026-05-20", null, "2026-05-01",
    ]);
    const second = await db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [
      ids.deal, "fee", 5_000_000, 3_000_000, "2026-06-01", null, "2026-06-01",
    ]);
    expect(second.rows).toHaveLength(1);
  });

  it("부가세 미포함이면 입금액이 금액을 넘는 순간 CHECK 이 막는다", async () => {
    db = await setup();
    await expect(
      db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7,$8)`, [
        ids.deal, "fee", 5_000_000, 5_500_000, "2026-05-20", "2026-05-20", "2026-05-01", false,
      ]),
    ).rejects.toThrow();
  });

  it("부가세 포함이면 입금액이 금액을 넘어도 허용된다(실제 전액 기록)", async () => {
    db = await setup();
    const result = await db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      ids.deal, "fee", 5_000_000, 5_500_000, "2026-05-20", "2026-05-20", "2026-05-01", true, true,
    ]);
    expect(result.rows).toHaveLength(1);
    const row = await db.query<{ vat_included: boolean; tax_invoice_issued: boolean; received_amount: string }>(
      `select vat_included, tax_invoice_issued, received_amount from deal_ledger_entries where deal_id=$1`,
      [ids.deal],
    );
    expect(row.rows[0]).toMatchObject({ vat_included: true, tax_invoice_issued: true, received_amount: "5500000" });
  });
});
