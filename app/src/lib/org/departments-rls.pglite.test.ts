import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * #571 · 부서 도입의 «핵심 전제» 를 실행형으로 증명한다.
 *
 * 왜 실행형인가
 *   조직도는 «누가 어느 회사 사람인가» 를 담는다. 여기가 새면 남의 회사 조직도가 보인다.
 *   말로 「RLS 를 걸었다」 고 적는 것은 근거가 아니다 — 실제 정책이 실제로 막는지 돌려 본다.
 *   이 저장소에서 «전제만 재고 통과한 채 망가진» 적이 있다(096).
 *
 * 무엇을 재는가
 *   ① 다른 회사의 부서가 «0건» 으로 보인다
 *   ② 멤버가 아닌 사람에게도 «0건»
 *   ③ 쓰기는 owner/admin 만 — member 는 못 만든다
 *   ④ 이 마이그레이션이 부서를 «심지 않는다» (빈 상태가 기본)
 */
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/130_issue571_departments.sql"),
  "utf8",
);

const ids = {
  orgA: "00000000-0000-4000-8000-0000000000a1",
  orgB: "00000000-0000-4000-8000-0000000000b1",
  ownerA: "00000000-0000-4000-8000-00000000001a",
  memberA: "00000000-0000-4000-8000-00000000002a",
  ownerB: "00000000-0000-4000-8000-00000000001b",
  outsider: "00000000-0000-4000-8000-00000000009f",
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid not null, user_id uuid not null, role text, status text default 'active', primary key(org_id,user_id));
  create function public.is_org_member(p_org_id uuid) returns boolean language sql stable as
    $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid() and status='active') $$;
  create function public.app_admin_role() returns text language sql stable as $$ select null::text $$;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;

  grant usage on schema public to authenticated;
  -- 정책이 auth.uid() 를 부른다 — 그 함수를 못 부르면 «권한 없음» 으로 터지고,
  -- 그러면 RLS 가 아니라 «스키마 접근» 을 재는 테스트가 된다.
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select on public.org_members, public.orgs, public.users to authenticated;

  insert into public.orgs(id) values ('${ids.orgA}'), ('${ids.orgB}');
  insert into public.users(id) values ('${ids.ownerA}'), ('${ids.memberA}'), ('${ids.ownerB}'), ('${ids.outsider}');
  insert into public.org_members(org_id,user_id,role) values
    ('${ids.orgA}','${ids.ownerA}','owner'),
    ('${ids.orgA}','${ids.memberA}','member'),
    ('${ids.orgB}','${ids.ownerB}','owner');
`;

const databases: PGlite[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

async function boot() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(SCHEMA);
  await db.exec(migration);
  await db.exec(`grant select, insert, update, delete on public.departments, public.org_member_departments to authenticated;`);
  return db;
}

/**
 * 그 사람이 되어 본다 — 정책은 auth.uid() 로만 판단한다.
 *
 * ⚠ `set local` 을 쓰면 안 된다. 그건 트랜잭션 안에서만 살아 있는데 각 호출이
 *   자기 트랜잭션으로 돌아서, 정작 조회할 때는 역할이 이미 돌아가 있다.
 *   그러면 RLS 가 «안 걸린 채로» 통과해서 테스트가 초록인데 실제로는 아무것도 안 잰다.
 *   세션에 붙는 `set role` + `set_config(..., false)` 를 쓴다(집안 다른 RLS 테스트와 같은 방식).
 */
async function as<T>(db: PGlite, userId: string, sql: string) {
  await db.exec(`reset role; select set_config('app.uid','${userId}',false); set role authenticated;`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec("reset role");
  }
}

describe("#571 부서 — 조직 경계", () => {
  it("④ 마이그레이션이 부서를 «심지 않는다» — 빈 상태가 기본", async () => {
    const db = await boot();
    const rows = await db.query<{ count: string }>("select count(*)::text as count from public.departments");
    expect(rows.rows[0].count, "제품이 예시 조직도를 심으면 안 된다").toBe("0");
  });

  it("① 다른 회사의 부서는 0건이다", async () => {
    const db = await boot();
    await db.exec(`
      insert into public.departments(org_id,name) values
        ('${ids.orgA}','A사 어느 부서'), ('${ids.orgB}','B사 어느 부서');
    `);

    const seenByA = await as(db, ids.ownerA, "select name from public.departments");
    expect(seenByA.rows.map((r) => (r as { name: string }).name)).toEqual(["A사 어느 부서"]);

    const seenByB = await as(db, ids.ownerB, "select name from public.departments");
    expect(seenByB.rows.map((r) => (r as { name: string }).name)).toEqual(["B사 어느 부서"]);
  });

  it("② 회사 사람이 아니면 아무것도 못 본다", async () => {
    const db = await boot();
    await db.exec(`insert into public.departments(org_id,name) values ('${ids.orgA}','A사 어느 부서');`);
    const seen = await as(db, ids.outsider, "select id from public.departments");
    expect(seen.rows).toHaveLength(0);
  });

  it("③ 조직도를 바꾸는 것은 owner/admin 만 — member 는 못 만든다", async () => {
    const db = await boot();
    await expect(
      as(db, ids.memberA, `insert into public.departments(org_id,name) values ('${ids.orgA}','멤버가 만든 부서')`),
    ).rejects.toThrow();

    // owner 는 된다 — 막는 것이 목적이지 잠그는 것이 목적이 아니다.
    await as(db, ids.ownerA, `insert into public.departments(org_id,name) values ('${ids.orgA}','대표가 만든 부서')`);
    const seen = await as(db, ids.ownerA, "select count(*)::text as count from public.departments");
    expect((seen.rows[0] as { count: string }).count).toBe("1");
  });

  it("배정도 같은 경계를 쓴다 — 남의 회사 배정이 안 보인다", async () => {
    const db = await boot();
    await db.exec(`
      insert into public.departments(id,org_id,name) values
        ('00000000-0000-4000-8000-00000000d001','${ids.orgA}','A사 부서'),
        ('00000000-0000-4000-8000-00000000d002','${ids.orgB}','B사 부서');
      insert into public.org_member_departments(org_id,department_id,user_id) values
        ('${ids.orgA}','00000000-0000-4000-8000-00000000d001','${ids.memberA}'),
        ('${ids.orgB}','00000000-0000-4000-8000-00000000d002','${ids.ownerB}');
    `);
    const seen = await as(db, ids.ownerA, "select user_id from public.org_member_departments");
    expect(seen.rows).toHaveLength(1);
    expect((seen.rows[0] as { user_id: string }).user_id).toBe(ids.memberA);
  });

  it("이름은 회사 안에서 유일하다 — 같은 이름 둘이면 대상 지정이 모호해진다", async () => {
    const db = await boot();
    await db.exec(`insert into public.departments(org_id,name) values ('${ids.orgA}','같은 이름');`);
    await expect(
      db.exec(`insert into public.departments(org_id,name) values ('${ids.orgA}','같은 이름');`),
    ).rejects.toThrow();
    // 다른 회사에서는 같은 이름을 쓸 수 있다 — 회사끼리는 남남이다.
    await db.exec(`insert into public.departments(org_id,name) values ('${ids.orgB}','같은 이름');`);
  });
});
