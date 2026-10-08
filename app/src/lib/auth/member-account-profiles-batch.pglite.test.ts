import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 시험 대상. 작업 폴더(app/)에서 supabase 쪽 마이그레이션을 읽는다.
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/170_member_account_profiles_batch.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  orgA: id("a1"), orgB: id("b1"), orgClosed: id("c1"),
  owner: id("1a"), member: id("2a"), left: id("3a"), outsider: id("1b"),
};

// 170 이 참조하는 것만 최소로 둔다. 열 이름은 실제와 같게.
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key, status text not null default 'active');
  create table public.users(id uuid primary key, name text);
  create table public.org_members(
    org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
    status text not null default 'active', created_at timestamptz not null default now(),
    primary key(org_id, user_id)
  );
  create table public.member_account_profiles(
    org_id uuid not null, user_id uuid not null, title text, team_key text, primary key(org_id, user_id)
  );
  create function public.is_org_member(p_org uuid) returns boolean language sql stable as
    $$ select exists(select 1 from public.org_members m join public.orgs o on o.id = m.org_id
         where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active' and o.status = 'active') $$;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;
`;

let db: PGliteInterface;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`
    delete from public.member_account_profiles; delete from public.org_members; delete from public.users; delete from public.orgs;
    insert into public.orgs(id, status) values ('${ids.orgA}','active'), ('${ids.orgB}','active'), ('${ids.orgClosed}','closed');
    insert into public.users(id, name) values ('${ids.owner}','대표'), ('${ids.member}','구성원'), ('${ids.left}','퇴사자'), ('${ids.outsider}','다른 회사');
    insert into public.org_members(org_id, user_id, status, created_at) values
      ('${ids.orgA}','${ids.owner}','active','2026-01-01'),
      ('${ids.orgA}','${ids.member}','active','2026-01-02'),
      ('${ids.orgA}','${ids.left}','inactive','2026-01-03'),
      ('${ids.orgB}','${ids.outsider}','active','2026-01-01'),
      ('${ids.orgClosed}','${ids.owner}','active','2026-01-01');
    insert into public.member_account_profiles(org_id, user_id, title, team_key) values
      ('${ids.orgA}','${ids.member}','매니저','team-1'),
      ('${ids.orgB}','${ids.member}','다른 회사 직함','team-x');
  `);
});

async function as(userId: string | null) {
  await db.exec(`select set_config('app.uid', '${userId ?? ""}', false)`);
}

async function profiles(orgId: string) {
  const { rows } = await db.query<{ list: unknown }>(`select public.list_member_account_profiles('${orgId}') as list`);
  return rows[0].list as Array<{ id: string; name: string | null; title: string | null; team_key: string | null }>;
}

describe("170 list_member_account_profiles — 회원 표시 정보를 한 번에", () => {
  it("이 회사의 활성 회원만, 011 과 같은 모양으로, 이 회사의 직함·팀을 돌려준다", async () => {
    await as(ids.owner);
    expect(await profiles(ids.orgA)).toEqual([
      { id: ids.owner, name: "대표", title: null, team_key: null },
      { id: ids.member, name: "구성원", title: "매니저", team_key: "team-1" },
    ]);
  });

  it("이 회사 회원이 아니거나 로그인하지 않았으면 거부한다", async () => {
    await as(ids.outsider);
    await expect(profiles(ids.orgA)).rejects.toThrow(/active membership required/);
    await as(null);
    await expect(profiles(ids.orgA)).rejects.toThrow(/active membership required/);
  });

  it("닫힌 회사는 회원이어도 거부한다", async () => {
    await as(ids.owner);
    await expect(profiles(ids.orgClosed)).rejects.toThrow(/active membership required/);
  });

  it("익명 키로는 부를 수 없고 로그인한 사람만 부를 수 있다", async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon', 'public.list_member_account_profiles(uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.list_member_account_profiles(uuid)', 'execute') as authenticated`);
    expect(rows[0]).toEqual({ anon: false, authenticated: true });
  });
});
