import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * BBE-240 · 연도별 전체 원장의 핵심 전제 — deal_ledger_entries 를 org_id 로만 걸고
 * 직접 조회해도 can_access_deal_ledger 의 select 정책이 그 위에서 자기-필터링하는가.
 *
 * 이걸 실행형으로 확인해두는 이유: dash/aggregate.ts 처럼 딜을 먼저 불러와 딜마다
 * 루프 도는 패턴을 안 쓰기로 한 근거가 바로 이 RLS 동작이다 — 틀렸으면 다른 조직
 * 데이터가 새는 사고다.
 */
const ledger035 = readFileSync(resolve(process.cwd(), "../supabase/migrations/035_ledger.sql"), "utf8");
const vatWiring103 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/103_bbe240_deal_ledger_vat_wiring.sql"),
  "utf8",
);

const ids = {
  orgA: "00000000-0000-4000-8000-0000000000a1",
  orgB: "00000000-0000-4000-8000-0000000000b1",
  userA: "00000000-0000-4000-8000-00000000001a",
  userB: "00000000-0000-4000-8000-00000000001b",
  dealA: "00000000-0000-4000-8000-00000000002a",
  dealB: "00000000-0000-4000-8000-00000000002b",
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid not null, user_id uuid not null, role text, scope text, primary key(org_id,user_id));
  create table public.deals(id uuid primary key default gen_random_uuid(), org_id uuid not null, assigned_to uuid, title text not null default '');
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

  grant usage on schema public to authenticated;
  grant select on public.deals, public.org_members, public.orgs to authenticated;

  insert into public.orgs(id) values ('${ids.orgA}'), ('${ids.orgB}');
  insert into public.users(id) values ('${ids.userA}'), ('${ids.userB}');
  insert into public.org_members(org_id,user_id,role,scope) values
    ('${ids.orgA}','${ids.userA}','owner','all'),
    ('${ids.orgB}','${ids.userB}','owner','all');
  insert into public.deals(id,org_id,assigned_to,title) values
    ('${ids.dealA}','${ids.orgA}','${ids.userA}','A사 자금건'),
    ('${ids.dealB}','${ids.orgB}','${ids.userB}','B사 자금건');
`;

async function setup(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(ledger035);
  await db.exec(vatWiring103);
  await db.exec(`grant select on public.deal_ledger_entries to authenticated`);
  return db;
}

describe("BBE-240 · 연도별 원장의 org 직접 조회가 RLS 로 자기-필터링하는가", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
  });

  it("org_id 로만 걸어도 다른 조직 항목은 절대 안 섞인다", async () => {
    db = await setup();
    await db.exec(`select set_config('app.uid','${ids.userA}',false); set role authenticated;`);
    await db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [
      ids.dealA, "contract_deposit", 1_000_000, 1_000_000, "2026-03-05", "2026-03-05", "2026-03-01",
    ]);
    await db.exec(`reset role`);
    await db.exec(`select set_config('app.uid','${ids.userB}',false); set role authenticated;`);
    await db.query(`select add_deal_ledger_entry($1,$2,$3,$4,$5,$6,$7)`, [
      ids.dealB, "fee", 5_000_000, 5_000_000, "2026-05-20", "2026-05-20", "2026-05-01",
    ]);

    // A로 다시 전환해서 "org_id = orgA" 만 건 조회를 흉내낸다 — RLS 가 이미 걸려 있으니
    // 애플리케이션 필터가 없어도(또는 실수로 orgB 를 넣어도) B의 행은 절대 안 보여야 한다.
    await db.exec(`reset role`);
    await db.exec(`select set_config('app.uid','${ids.userA}',false); set role authenticated;`);
    const asOrgA = await db.query(`select deal_id from deal_ledger_entries where org_id=$1`, [ids.orgA]);
    expect(asOrgA.rows).toHaveLength(1);

    // orgB 로 걸어도(애플리케이션 버그를 가정) userA 세션에서는 여전히 0행 — RLS 가 진짜 방어선이다.
    const asOrgBWhileUserA = await db.query(`select deal_id from deal_ledger_entries where org_id=$1`, [ids.orgB]);
    expect(asOrgBWhileUserA.rows).toHaveLength(0);

    // 필터 없이 전체를 조회해도(코드 실수) A 세션에서는 A 것만 보인다.
    const unfiltered = await db.query(`select deal_id from deal_ledger_entries`);
    expect(unfiltered.rows).toHaveLength(1);
    expect((unfiltered.rows[0] as { deal_id: string }).deal_id).toBe(ids.dealA);
  });
});
