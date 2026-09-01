import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * #683 — 역할 정의서를 «누가» 쓰고 «누가» 읽을 수 있나.
 *
 * ★ 화면에서 버튼을 감추는 것으로는 아무것도 못 막는다 — 버튼이 없어도 요청은 손으로 만들 수 있다.
 *   그래서 서버가 실제로 거부하는지를 DB 에서 직접 잰다.
 */

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/146_issue683_seat_definitions.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  orgA: id("a1"),
  orgB: id("b1"),
  deptA: id("d0a1"),
  deptB: id("d0b1"),
  owner: id("1a"),
  admin: id("2a"),
  member: id("3a"),
  ownerB: id("1b"),
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create type public.member_role as enum ('owner','admin','team_lead','member');
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(
    org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
    role public.member_role not null, status text not null default 'active', primary key(org_id,user_id)
  );
  create table public.departments(
    id uuid primary key, org_id uuid not null references public.orgs(id) on delete cascade,
    name text not null
  );
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;

  insert into public.orgs values ('${ids.orgA}'), ('${ids.orgB}');
  insert into public.users values ('${ids.owner}'), ('${ids.admin}'), ('${ids.member}'), ('${ids.ownerB}');
  insert into public.org_members values
    ('${ids.orgA}','${ids.owner}','owner','active'),
    ('${ids.orgA}','${ids.admin}','admin','active'),
    ('${ids.orgA}','${ids.member}','member','active'),
    ('${ids.orgB}','${ids.ownerB}','owner','active');
  insert into public.departments values
    ('${ids.deptA}','${ids.orgA}','영업1팀'), ('${ids.deptB}','${ids.orgB}','남의 팀');
`;

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
});
afterEach(async () => { await db.close(); });

const actor = (user: string) => db.exec(`select set_config('app.uid','${user}',false)`);

const save = (user: string, org: string, dept: string | null, role: string, summary: string) =>
  actor(user).then(() =>
    db.query(
      "select * from public.save_seat_definition($1,$2,$3::public.member_role,$4,$5::jsonb,$6::jsonb,$7,$8)",
      [org, dept, role, summary, JSON.stringify([{ cycle: "daily", text: "아침에 뷰부터" }]), "{}", null, null],
    ),
  );

describe("#683 역할 정의서 — 누가 쓸 수 있나", () => {
  it("대표는 쓴다", async () => {
    await expect(save(ids.owner, ids.orgA, ids.deptA, "team_lead", "3일 안에 첫 통화")).resolves.toBeTruthy();
  });

  it("관리자도 쓴다", async () => {
    await expect(save(ids.admin, ids.orgA, ids.deptA, "member", "본인 담당분")).resolves.toBeTruthy();
  });

  it("★ 일반 구성원은 못 쓴다 — 서버가 거부한다", async () => {
    await expect(save(ids.member, ids.orgA, ids.deptA, "member", "몰래")).rejects.toThrow(/permission_denied/);
  });

  it("★ 남의 조직 부서에는 못 단다", async () => {
    await expect(save(ids.owner, ids.orgA, ids.deptB, "team_lead", "남의 팀")).rejects.toThrow(/seat_department_mismatch/);
  });

  it("★ 남의 조직에는 아예 못 쓴다", async () => {
    await expect(save(ids.owner, ids.orgB, null, "member", "침입")).rejects.toThrow(/permission_denied/);
  });

  it("로그인 안 했으면 못 쓴다", async () => {
    await db.exec("select set_config('app.uid','',false)");
    await expect(
      db.query("select * from public.save_seat_definition($1,$2,$3::public.member_role,$4,'[]'::jsonb,'{}'::jsonb,null,null)",
        [ids.orgA, ids.deptA, "team_lead", "익명"]),
    ).rejects.toThrow(/permission_denied/);
  });
});

describe("#683 한 자리에 정의서는 하나", () => {
  it("두 번 쓰면 덮어쓴다 — 행이 늘지 않는다", async () => {
    await save(ids.owner, ids.orgA, ids.deptA, "team_lead", "처음");
    await save(ids.owner, ids.orgA, ids.deptA, "team_lead", "고침");
    const rows = await db.query<{ n: number; s: string }>(
      "select count(*)::int n, max(summary) s from public.seat_definitions where department_id=$1 and role='team_lead'",
      [ids.deptA],
    );
    expect(rows.rows[0].n).toBe(1);
    expect(rows.rows[0].s).toBe("고침");
  });

  it("★ 부서 없는 자리도 덮어쓴다 — null 을 «다른 값» 으로 세지 않는다", async () => {
    await save(ids.owner, ids.orgA, null, "member", "미배정 처음");
    await save(ids.owner, ids.orgA, null, "member", "미배정 고침");
    const rows = await db.query<{ n: number; s: string }>(
      "select count(*)::int n, max(summary) s from public.seat_definitions where department_id is null and role='member'",
    );
    expect(rows.rows[0].n).toBe(1);
    expect(rows.rows[0].s).toBe("미배정 고침");
  });

  it("부서가 다르면 다른 자리다", async () => {
    await save(ids.owner, ids.orgA, ids.deptA, "member", "부서 있음");
    await save(ids.owner, ids.orgA, null, "member", "부서 없음");
    const rows = await db.query<{ n: number }>("select count(*)::int n from public.seat_definitions");
    expect(rows.rows[0].n).toBe(2);
  });
});

describe("#683 빈 값과 잘못된 값", () => {
  it("빈 요약은 «없음» 으로 저장된다 — 공백만 남기지 않는다", async () => {
    await save(ids.owner, ids.orgA, ids.deptA, "team_lead", "   ");
    const rows = await db.query<{ s: string | null }>("select summary s from public.seat_definitions");
    expect(rows.rows[0].s).toBeNull();
  });

  it("★ 할 일이 배열이 아니면 거부한다", async () => {
    await actor(ids.owner);
    await expect(
      db.query("select * from public.save_seat_definition($1,$2,$3::public.member_role,null,'\"글자\"'::jsonb,'{}'::jsonb,null,null)",
        [ids.orgA, ids.deptA, "team_lead"]),
    ).rejects.toThrow(/seat_duties_invalid/);
  });
});

describe("#683 읽기", () => {
  it("★ 표에 «직접 쓰는» 길이 없다 — 쓰기는 RPC 로만", async () => {
    const rows = await db.query<{ n: number }>(
      "select count(*)::int n from pg_policies where schemaname='public' and tablename='seat_definitions' and cmd <> 'SELECT'",
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("authenticated 는 select 만 갖는다", async () => {
    const rows = await db.query<{ p: string }>(
      "select string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_name='seat_definitions' and grantee='authenticated'",
    );
    expect(rows.rows[0].p).toBe("SELECT");
  });
});
