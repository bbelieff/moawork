import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * 149 — 고객 RPC 세션 판정 수리 회귀 테스트 (REAL helper, stub 아님).
 *
 * 재는 것: 148의 8개 RPC가 obsolete member_account_session_valid()
 * (legacy request.jwt.claim.session_id GUC + custom member_account_sessions
 * 레지스트리 — hosted에 배선 없음, 항상 false)를 버리고, 실제 서명 JWT의
 * auth.jwt() JSON session_id + hosted auth.sessions(id+user_id, not_after
 * null/future) 판정으로 교체했는지다. 148 스위트(customer-ops.pglite.test.ts)의
 * app.session_valid 대역은 이 배선 부재를 가렸으므로, 여기서는 실제 GUC
 * request.jwt.claims JSON과 최소 auth.sessions 스키마로만 잰다.
 * 148 스위트는 손대지 않는다.
 */

const migration148 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/148_platform_customer_ops.sql"),
  "utf8",
);
const migration149 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/149_platform_customer_session_repair.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  orgA: id("a1"),
  orgB: id("b1"),
  orgDeleted: id("dd"),
  orgPending: id("dd1"),
  orgSuspended: id("dd2"),
  operator: id("0a"),
  ownerB: id("2b"),
  repB: id("1b"),
  outsider: id("9a"),
  taskSeed: id("70"),
  taskValid: id("71"),
};

const SESSION = {
  validFuture: id("e1"),
  validNullExpiry: id("e2"),
  wrongOwner: id("e3"),
  expired: id("e4"),
  revoked: id("e5"),
  absent: id("e6"),
  outsider: id("e7"),
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text not null);
  create table auth.sessions(id uuid primary key, user_id uuid not null, not_after timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;

  create table public.app_admins(
    email text primary key,
    role text not null default 'owner',
    is_platform boolean not null default true
  );

  -- canonical is_platform_admin (017 본문 그대로).
  create function public.is_platform_admin() returns boolean
    language sql stable security definer set search_path = public, auth, pg_temp as $$
    select exists (
      select 1
        from auth.users auth_user
        join public.app_admins platform_admin
          on lower(platform_admin.email) = lower(auth_user.email)
       where auth_user.id = auth.uid()
         and platform_admin.is_platform is true
    );
  $$;

  -- obsolete helper (011 본문 그대로: legacy GUC + custom 레지스트리).
  -- 149의 8개 RPC는 이를 호출하지 않는다. 여기서 false로 남는 것이 기대값이다.
  create table public.member_account_sessions(
    id uuid primary key,
    user_id uuid not null,
    org_id uuid,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    absolute_expires_at timestamptz not null default (now() + interval '30 days'),
    revoked_at timestamptz,
    revoked_by uuid
  );
  create function public.member_account_session_valid() returns boolean
    language plpgsql stable security definer set search_path = public, pg_temp as $$
  declare v_session_text text := nullif(current_setting('request.jwt.claim.session_id', true), '');
  begin
    if v_session_text is null then return false; end if;
    return exists (
      select 1 from public.member_account_sessions s
      where s.id = v_session_text::uuid and s.user_id = auth.uid()
        and s.revoked_at is null and s.absolute_expires_at > now()
        and s.last_seen_at > now() - interval '7 days'
    );
  exception when invalid_text_representation then
    return false;
  end;
  $$;

  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;

  create table public.orgs(
    id uuid primary key, name text not null, slug text, status text not null default 'active',
    created_at timestamptz not null default now()
  );
  create table public.users(id uuid primary key);
  create table public.org_members(
    org_id uuid not null,
    user_id uuid not null references public.users(id),
    role text not null default 'member',
    status text not null default 'active',
    primary key(org_id, user_id)
  );
`;

const SEED = `
  insert into auth.users(id, email) values
    ('${ids.operator}', 'op@platform.test'),
    ('${ids.ownerB}', 'owner@beta.test'),
    ('${ids.repB}', 'rep@beta.test'),
    ('${ids.outsider}', 'outsider@test.example');
  insert into public.app_admins(email, is_platform) values
    ('op@platform.test', true);
  insert into public.orgs(id, name, slug, status) values
    ('${ids.orgA}', '알파 회사', 'alpha', 'active'),
    ('${ids.orgB}', '베타 회사', 'beta', 'active'),
    ('${ids.orgDeleted}', '지운 회사', 'gone', 'deleted'),
    ('${ids.orgPending}', '지움대기 회사', 'pending-co', 'pending_delete'),
    ('${ids.orgSuspended}', '정지 회사', 'suspended-co', 'suspended');
  insert into public.users values
    ('${ids.operator}'), ('${ids.ownerB}'), ('${ids.repB}'), ('${ids.outsider}');
  insert into public.org_members(org_id, user_id, role, status) values
    ('${ids.orgA}', '${ids.operator}', 'owner', 'active'),
    ('${ids.orgB}', '${ids.ownerB}', 'owner', 'active'),
    ('${ids.orgB}', '${ids.repB}', 'member', 'active');
  insert into public.platform_customer_tasks(id, org_id, title, kind, status, created_by) values
    ('${ids.taskSeed}', '${ids.orgA}', '시드 작업', 'setup', 'todo', '${ids.operator}');
`;

const RPCS = [
  "select public.list_platform_customers(null, 'all', 50, 0)",
  `select public.get_platform_customer('${ids.orgA}')`,
  `select public.set_platform_customer_setup('${ids.orgA}', 'setting_up')`,
  `select public.record_platform_customer_invite('${ids.orgA}', 'pending')`,
  `select public.create_platform_customer_task('${ids.taskValid}', '${ids.orgA}', '제목', 'setup')`,
  `select public.update_platform_customer_task('${ids.taskSeed}', '${ids.orgA}', 'todo')`,
  `select public.list_platform_customer_tasks('${ids.orgA}')`,
  `select public.list_platform_customer_history('${ids.orgA}', 200)`,
];

describe("149 — 실제 세션 판정 수리", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(migration148);
    await db.exec(migration149);
    await db.exec(SEED);
  });
  afterEach(async () => { await db.close(); });

  /** 서명 JWT 상태를 만든다: sub + claims JSON session_id. legacy GUC는 건드리지 않는다. */
  const signIn = (userId: string, sessionId: string | null) => {
    const claims = sessionId === null ? "{}" : JSON.stringify({ session_id: sessionId });
    return db.exec(
      `select set_config('request.jwt.claim.sub', '${userId}', false);` +
      ` select set_config('request.jwt.claims', '${claims}', false);`,
    );
  };
  const signOut = () =>
    db.exec(
      "select set_config('request.jwt.claim.sub', '', false);" +
      " select set_config('request.jwt.claims', '', false);",
    );
  const issueSession = (sessionId: string, userId: string, notAfter: string) =>
    db.exec(
      `insert into auth.sessions(id, user_id, not_after) values ('${sessionId}', '${userId}', ${notAfter});`,
    );
  async function codeOf(sql: string): Promise<string> {
    try {
      await db.query(sql);
    } catch (error) {
      return (error as { code?: string }).code ?? "thrown-without-code";
    }
    throw new Error(`expected rejection: ${sql}`);
  }
  async function expectAll8(code: string) {
    for (const sql of RPCS) {
      expect(await codeOf(sql), sql).toBe(code);
    }
  }

  it("핵심 회귀: legacy GUC 부재 + custom 레지스트리 빈 상태에서도 실제 세션이면 통과한다", async () => {
    // legacy 배선은 비어 있다 — 148 코드라면 여기서 전부 42501이었다.
    const legacyGuc = await db.query<{ v: string | null }>(
      "select current_setting('request.jwt.claim.session_id', true) as v",
    );
    expect(legacyGuc.rows[0].v).toBeNull();
    expect(
      (await db.query<{ n: number }>("select count(*)::integer as n from public.member_account_sessions")).rows[0].n,
    ).toBe(0);
    expect(
      (await db.query<{ ok: boolean }>("select public.member_account_session_valid() as ok")).rows[0].ok,
    ).toBe(false);

    await issueSession(SESSION.validFuture, ids.operator, "now() + interval '1 hour'");
    await signIn(ids.operator, SESSION.validFuture);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(true);

    const list = await db.query<{ out: Array<{ slug: string }> }>(
      "select public.list_platform_customers(null, 'all', 50, 0) as out",
    );
    expect(list.rows[0].out.map((row) => row.slug).sort()).toEqual(["alpha", "beta"]);
    const detail = await db.query<{ out: { can_manage: boolean } }>(
      `select public.get_platform_customer('${ids.orgA}') as out`,
    );
    expect(detail.rows[0].out.can_manage).toBe(true);
  });

  it("not_after null 세션도 유효하다", async () => {
    await issueSession(SESSION.validNullExpiry, ids.operator, "null");
    await signIn(ids.operator, SESSION.validNullExpiry);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(true);
    const list = await db.query<{ out: unknown[] }>(
      "select public.list_platform_customers(null, 'all', 50, 0) as out",
    );
    expect(list.rows[0].out.length).toBeGreaterThan(0);
  });

  it("missing 세션(session_id 키 없음·빈값·claims 자체 없음)은 8개 모두 42501이다", async () => {
    await signIn(ids.operator, null);
    await expectAll8("42501");
    await db.exec(
      `select set_config('request.jwt.claims', '${JSON.stringify({ session_id: "" })}', false);`,
    );
    await expectAll8("42501");
    await db.exec("select set_config('request.jwt.claims', '', false);");
    await expectAll8("42501");
  });

  it("malformed 세션(uuid 오형식)은 8개 모두 42501이다", async () => {
    await db.exec(
      `select set_config('request.jwt.claim.sub', '${ids.operator}', false);` +
      ` select set_config('request.jwt.claims', '{"session_id":"not-a-uuid"}', false);`,
    );
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(false);
    await expectAll8("42501");
  });

  it("deleted 세션(발급된 적 없는 id)은 8개 모두 42501이다", async () => {
    await signIn(ids.operator, SESSION.absent);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(false);
    await expectAll8("42501");
  });

  it("revoked 세션(행 삭제 후)은 8개 모두 42501이다", async () => {
    await issueSession(SESSION.revoked, ids.operator, "now() + interval '1 hour'");
    await signIn(ids.operator, SESSION.revoked);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(true);
    await db.exec(`delete from auth.sessions where id = '${SESSION.revoked}';`);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(false);
    await expectAll8("42501");
  });

  it("wrong-owner 세션(다른 사용자의 id)은 8개 모두 42501이다", async () => {
    await issueSession(SESSION.wrongOwner, ids.outsider, "now() + interval '1 hour'");
    await signIn(ids.operator, SESSION.wrongOwner);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(false);
    await expectAll8("42501");
  });

  it("expired 세션(not_after 과거)은 8개 모두 42501이다", async () => {
    await issueSession(SESSION.expired, ids.operator, "now() - interval '1 minute'");
    await signIn(ids.operator, SESSION.expired);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(false);
    await expectAll8("42501");
  });

  it("유효한 관리자는 8개 모두 성공한다", async () => {
    await issueSession(SESSION.validFuture, ids.operator, "now() + interval '1 hour'");
    await signIn(ids.operator, SESSION.validFuture);
    const list = await db.query<{ out: unknown[] }>(
      "select public.list_platform_customers(null, 'all', 50, 0) as out",
    );
    expect(Array.isArray(list.rows[0].out)).toBe(true);
    await db.query(RPCS[1]);
    await db.query(RPCS[2]);
    await db.query(RPCS[3]);
    const created = await db.query<{ out: { created: boolean } }>(
      `select public.create_platform_customer_task('${ids.taskValid}', '${ids.orgA}', '제목', 'setup') as out`,
    );
    expect(created.rows[0].out.created).toBe(true);
    const updated = await db.query<{ out: { changed: boolean } }>(
      `select public.update_platform_customer_task('${ids.taskValid}', '${ids.orgA}', 'in_progress') as out`,
    );
    expect(updated.rows[0].out.changed).toBe(true);
    await db.query(RPCS[6]);
    await db.query(RPCS[7]);
  });

  it("유효한 세션의 비관리자와 anon은 8개 모두 42501이다", async () => {
    await issueSession(SESSION.outsider, ids.outsider, "now() + interval '1 hour'");
    await signIn(ids.outsider, SESSION.outsider);
    expect(
      (await db.query<{ ok: boolean }>("select public.platform_customer_session_valid() as ok")).rows[0].ok,
    ).toBe(true);
    expect(
      (await db.query<{ ok: boolean }>("select public.is_platform_admin() as ok")).rows[0].ok,
    ).toBe(false);
    await expectAll8("42501");
    await signOut();
    await expectAll8("42501");
  });

  it("helper는 직접 실행 불가이며 8개 정의는 새 판정 + canonical 관리자 검사를 쓴다", async () => {
    for (const role of ["anon", "authenticated", "public"]) {
      const row = await db.query<{ ok: boolean }>(
        `select not has_function_privilege('${role}', 'public.platform_customer_session_valid()', 'execute') as ok`,
      );
      expect(row.rows[0].ok, role).toBe(true);
    }
    const defs = await db.query<{ name: string; def: string }>(`
      select p.proname as name, pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('list_platform_customers', 'get_platform_customer',
           'set_platform_customer_setup', 'record_platform_customer_invite',
           'create_platform_customer_task', 'update_platform_customer_task',
           'list_platform_customer_tasks', 'list_platform_customer_history')`);
    expect(defs.rows).toHaveLength(8);
    for (const { name, def } of defs.rows) {
      expect(def.includes("platform_customer_session_valid()"), `${name} 새 판정`).toBe(true);
      expect(def.includes("is_platform_admin()"), `${name} 관리자 검사 유지`).toBe(true);
      expect(def.includes("member_account_session_valid"), `${name} obsolete 제거`).toBe(false);
    }
  });

  it("수명주기·권한 경계는 그대로다(8개 grant 유지·신규 3표 force RLS·직접 쓰기 불가)", async () => {
    const grants = await db.query<{ name: string; ok: boolean }>(`
      select p.proname as name,
        has_function_privilege('authenticated', p.oid, 'execute') as ok
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('list_platform_customers', 'get_platform_customer',
           'set_platform_customer_setup', 'record_platform_customer_invite',
           'create_platform_customer_task', 'update_platform_customer_task',
           'list_platform_customer_tasks', 'list_platform_customer_history')`);
    expect(grants.rows).toHaveLength(8);
    for (const { name, ok } of grants.rows) {
      expect(ok, `${name} authenticated grant 유지`).toBe(true);
    }
    const rls = await db.query<{ ok: boolean }>(`
      select bool_and(c.relforcerowsecurity) as ok
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('platform_customer_profiles', 'platform_customer_tasks', 'platform_customer_history')`);
    expect(rls.rows[0].ok).toBe(true);
    for (const table of ["platform_customer_profiles", "platform_customer_tasks", "platform_customer_history"]) {
      for (const role of ["anon", "authenticated"]) {
        const row = await db.query<{ ok: boolean }>(
          `select not has_table_privilege('${role}', 'public.${table}', 'SELECT, INSERT, UPDATE, DELETE') as ok`,
        );
        expect(row.rows[0].ok, `${role} → ${table}`).toBe(true);
      }
    }
  });
});
