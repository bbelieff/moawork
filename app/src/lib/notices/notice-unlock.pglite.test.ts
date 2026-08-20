import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * BBE-238 · 공지사항 보드가 is_system=false 로 되돌아가는가.
 *
 * 066(원 배포 — is_system=true 회귀 재현)을 먼저 돌리고 101(되돌림)을 얹는다.
 * ① 이미 회귀를 겪은 기존 조직의 보드가 백필로 풀리는지
 * ② 101 배포 이후 처음 만드는 조직도 애초에 안 잠기는지
 * 둘 다 잰다 — 백필만 재면 「새 조직도 여전히 잠긴다」를 놓친다.
 */
const notice066 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/066_notice_atomic_contract.sql"),
  "utf8",
);
const notice101 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/102_bbe238_notice_board_unlock.sql"),
  "utf8",
);

const ids = {
  existingOrg: "00000000-0000-4000-8000-000000000001",
  freshOrg: "00000000-0000-4000-8000-000000000002",
  user: "00000000-0000-4000-8000-000000000010",
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid,user_id uuid,role text,primary key(org_id,user_id));
  create function public.is_org_member(p_org_id uuid) returns boolean language sql stable as
    $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid()) $$;
  create table public.boards(id uuid primary key default gen_random_uuid(),org_id uuid not null,name text not null,description text,icon text,is_system boolean not null default false,source text,sort_order int not null default 0,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
  create table public.board_groups(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null references public.boards(id) on delete cascade,name text not null,color text,sort_order int not null default 0);
  create table public.board_columns(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null references public.boards(id) on delete cascade,key text not null,label text not null,type text not null,source text,options_jsonb jsonb,sort_order int not null default 0,width int,right_pinned boolean not null default false,move_rule_jsonb jsonb,is_readonly boolean not null default false,unique(board_id,key));
  create table public.items(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null references public.boards(id) on delete cascade,group_id uuid references public.board_groups(id) on delete set null,title text not null,sort_order int not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
  create table public.item_values(org_id uuid not null,item_id uuid not null references public.items(id) on delete cascade,column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;
`;

async function seedOrgAndActor(db: PGlite, orgId: string) {
  await db.exec(`insert into public.orgs(id) values('${orgId}')`);
  await db.exec(
    `insert into public.org_members(org_id,user_id,role) values('${orgId}','${ids.user}','member') on conflict do nothing`,
  );
}

describe("BBE-238 · 공지사항 is_system 회귀 되돌림", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
  });

  it("이미 is_system=true 로 잠긴 기존 조직의 보드를 101 의 백필이 푼다", async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(`insert into public.users(id) values('${ids.user}')`);
    await seedOrgAndActor(db, ids.existingOrg);
    await db.exec(`select set_config('app.uid','${ids.user}',false)`);

    // 066 원 배포 — 회귀 재현(이 시점엔 is_system=true 로 만들어진다).
    await db.exec(notice066);
    await db.query(`select * from public.bbe151_ensure_notice_tab($1::uuid)`, [ids.existingOrg]);
    const before = await db.query<{ is_system: boolean }>(
      `select is_system from public.boards where org_id=$1 and source='core.default-tab/notice'`,
      [ids.existingOrg],
    );
    expect(before.rows[0]?.is_system).toBe(true); // 회귀가 실제로 재현됐는지 먼저 확인.

    // 101 적용 — 백필 + 함수 재정의.
    await db.exec(notice101);
    const after = await db.query<{ is_system: boolean }>(
      `select is_system from public.boards where org_id=$1 and source='core.default-tab/notice'`,
      [ids.existingOrg],
    );
    expect(after.rows[0]?.is_system).toBe(false);

    // 컬럼·그룹 구조는 그대로 유지된다(파괴적 변경 아님).
    const columns = await db.query<{ n: number }>(
      `select count(*)::int n from public.board_columns bc join public.boards b on b.id=bc.board_id where b.org_id=$1`,
      [ids.existingOrg],
    );
    expect(columns.rows[0]?.n).toBe(10);
  });

  it("101 배포 이후 처음 만드는 조직은 애초에 잠기지 않는다", async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(notice066);
    await db.exec(notice101); // 배포 순서 그대로 — 066 다음 101.
    await db.exec(`insert into public.users(id) values('${ids.user}')`);
    await seedOrgAndActor(db, ids.freshOrg);
    await db.exec(`select set_config('app.uid','${ids.user}',false)`);

    const result = await db.query<{ board_id: string; created: boolean }>(
      `select * from public.bbe151_ensure_notice_tab($1::uuid)`,
      [ids.freshOrg],
    );
    expect(result.rows[0]?.created).toBe(true);

    const board = await db.query<{ is_system: boolean }>(
      `select is_system from public.boards where id=$1`,
      [result.rows[0]!.board_id],
    );
    expect(board.rows[0]?.is_system).toBe(false);
  });

  it("101 을 두 번 적용해도(재실행) is_system=false 는 그대로다", async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(`insert into public.users(id) values('${ids.user}')`);
    await seedOrgAndActor(db, ids.existingOrg);
    await db.exec(`select set_config('app.uid','${ids.user}',false)`);
    await db.exec(notice066);
    await db.query(`select * from public.bbe151_ensure_notice_tab($1::uuid)`, [ids.existingOrg]);

    await db.exec(notice101);
    await db.exec(notice101); // 멱등성 — 두 번째 적용도 에러 없이 통과해야 한다.

    const after = await db.query<{ is_system: boolean }>(
      `select is_system from public.boards where org_id=$1 and source='core.default-tab/notice'`,
      [ids.existingOrg],
    );
    expect(after.rows[0]?.is_system).toBe(false);
  });
});
