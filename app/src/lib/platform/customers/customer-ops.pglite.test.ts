import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * 148 — ADMIN 고객 운영(고객사 대장) 영속 계층.
 *
 * 재는 것: «플랫폼 관리자만 좁은 등록 메타를 읽고 쓴다»는 경계 자체다.
 * 화면이 버튼을 감추는 것과, DB가 거부하는 것은 다른 사실이다.
 * 특히 forged id가 멤버십·지원 범위·owner 권한을 만들지 않는지,
 * 같은 값 재호출이 이력을 중복하지 않는지를 DB에서 직접 잰다.
 *
 * 2차 수정(독립 리뷰 반영):
 * - 대표 판정은 member_count>=2가 아니라 «활성 owner 행의 주인이 플랫폼
 *   운영자가 아님»으로만 난다. 일반 두 번째 구성원·두 번째 운영자는
 *   대표로 세지 않는다. owner 이전 기능은 없다(다음 단계).
 * - 8개 RPC 모두 member_account_session_valid() IS NOT TRUE fail-closed.
 *   세션 무효(만료·취소)는 JWT가 남아도 DB에서 거부한다.
 * - 대장은 active-only다. pending_delete/suspended/deleted에는 쓰지 않고
 *   들어가지도 않는다. 실제 enum은 006(orgs_status_check) 기준이다.
 * - 감사는 원문 복사 금지: after는 상태 enum, task_id 참조, memo 고정.
 */

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/148_platform_customer_ops.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  orgA: id("a1"),
  orgB: id("b1"),
  orgC: id("c1"),
  orgD: id("d1"),
  orgE: id("e1"),
  orgDeleted: id("dd"),
  orgPending: id("dd1"),
  orgSuspended: id("dd2"),
  operator: id("0a"),
  operator2: id("0b"),
  staffAdmin: id("0c"),
  ownerB: id("2b"),
  repB: id("1b"),
  plainMember: id("1c"),
  ownerE: id("2e"),
  outsider: id("9a"),
  task1: id("71"),
  task2: id("72"),
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text not null);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

  create table public.app_admins(
    email text primary key,
    role text not null default 'owner',
    is_platform boolean not null default true
  );

  -- is_platform_admin() 대역: app.is_admin='1' 일 때만 true.
  create function public.is_platform_admin() returns boolean language sql stable as
    $$ select current_setting('app.is_admin', true) = '1' $$;

  -- member_account_session_valid() 대역: app.session_valid='1' 일 때만 true.
  -- 만료·취소된 세션('0'·미설정)은 JWT가 남아도 false다.
  create function public.member_account_session_valid() returns boolean language sql stable as
    $$ select current_setting('app.session_valid', true) = '1' $$;

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
    org_id uuid not null references public.orgs(id) on delete cascade,
    user_id uuid not null references public.users(id),
    role text not null default 'member',
    status text not null default 'active',
    primary key(org_id, user_id)
  );
`;

const SEED = `
  insert into auth.users(id, email) values
    ('${ids.operator}', 'op@platform.test'),
    ('${ids.operator2}', 'op2@platform.test'),
    ('${ids.staffAdmin}', 'staff@platform.test'),
    ('${ids.ownerB}', 'owner@beta.test'),
    ('${ids.repB}', 'rep@beta.test'),
    ('${ids.plainMember}', 'member@gamma.test'),
    ('${ids.ownerE}', 'owner@epsilon.test'),
    ('${ids.outsider}', 'outsider@test.example');
  insert into public.app_admins(email, is_platform) values
    ('op@platform.test', true),
    ('op2@platform.test', true),
    ('staff@platform.test', true);
  insert into public.orgs(id, name, slug, status) values
    ('${ids.orgA}', '알파 회사', 'alpha', 'active'),
    ('${ids.orgB}', '베타 회사', 'beta', 'active'),
    ('${ids.orgC}', '감마 회사', 'gamma', 'active'),
    ('${ids.orgD}', '델타 회사', 'delta', 'active'),
    ('${ids.orgE}', '엡실론 회사', 'epsilon', 'active'),
    ('${ids.orgDeleted}', '지운 회사', 'gone', 'deleted'),
    ('${ids.orgPending}', '지움대기 회사', 'pending-co', 'pending_delete'),
    ('${ids.orgSuspended}', '정지 회사', 'suspended-co', 'suspended');
  insert into public.users values
    ('${ids.operator}'), ('${ids.operator2}'), ('${ids.staffAdmin}'),
    ('${ids.ownerB}'), ('${ids.repB}'), ('${ids.plainMember}'),
    ('${ids.ownerE}'), ('${ids.outsider}');
  -- orgA: 운영자 owner 1명뿐 → 초대 pending, 대표 미참여(대표 확인 필요).
  -- orgB: 비운영자 owner + 구성원 2명 → 검증된 대표 있음 → active.
  -- orgC: 운영자 owner + 일반 구성원 1명 → 2명이어도 대표 아님(핵심 반례).
  -- orgD: 운영자 owner + 운영자 구성원 → 둘 다 운영자라 대표 아님(핵심 반례).
  -- orgE: 비운영자 owner 1명 → 1명이어도 검증된 대표 있음 → active.
  insert into public.org_members(org_id, user_id, role, status) values
    ('${ids.orgA}', '${ids.operator}', 'owner', 'active'),
    ('${ids.orgB}', '${ids.ownerB}', 'owner', 'active'),
    ('${ids.orgB}', '${ids.repB}', 'member', 'active'),
    ('${ids.orgB}', '${ids.staffAdmin}', 'member', 'active'),
    ('${ids.orgC}', '${ids.operator}', 'owner', 'active'),
    ('${ids.orgC}', '${ids.plainMember}', 'member', 'active'),
    ('${ids.orgD}', '${ids.operator}', 'owner', 'active'),
    ('${ids.orgD}', '${ids.operator2}', 'member', 'active'),
    ('${ids.orgE}', '${ids.ownerE}', 'owner', 'active'),
    ('${ids.orgPending}', '${ids.operator}', 'owner', 'active'),
    ('${ids.orgSuspended}', '${ids.operator}', 'owner', 'active');
`;

describe("148 — 고객 운영 영속 계층", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(migration);
    await db.exec(SEED);
  });
  afterEach(async () => { await db.close(); });

  const admin = () => db.exec(`set app.uid = '${ids.operator}'; set app.is_admin = '1'; set app.session_valid = '1';`);
  const outsiderAdmin = () => db.exec(`set app.uid = '${ids.outsider}'; set app.is_admin = '1'; set app.session_valid = '1';`);
  const staffAdmin = () => db.exec(`set app.uid = '${ids.staffAdmin}'; set app.is_admin = '1'; set app.session_valid = '1';`);
  const nonAdmin = () => db.exec(`set app.uid = '${ids.outsider}'; set app.is_admin = '0'; set app.session_valid = '1';`);
  const anon = () => db.exec(`set app.uid = ''; set app.is_admin = '0'; set app.session_valid = '0';`);
  const expiredSession = () => db.exec(`set app.uid = '${ids.operator}'; set app.is_admin = '1'; set app.session_valid = '0';`);

  async function call<T = Record<string, unknown>>(sql: string): Promise<T> {
    const rows = await db.query<{ out: T }>(sql);
    return rows.rows[0].out;
  }
  async function codeOf(sql: string): Promise<string> {
    try {
      await db.query(sql);
    } catch (error) {
      return (error as { code?: string }).code ?? "thrown-without-code";
    }
    throw new Error(`expected rejection: ${sql}`);
  }

  describe("직접 테이블 접근은 아무에게도 없다", () => {
    it("신규 등록 확인은 회사 이름과 다른 주소로도 찾는다", async () => {
      await admin();
      const result = await call<Array<{ slug: string }>>(
        `select public.list_platform_customers('alpha', 'all', 50, 0) as out`);
      expect(result.map((row) => row.slug)).toEqual(["alpha"]);
    });
    it.each(["platform_customer_profiles", "platform_customer_tasks", "platform_customer_history"])(
      "%s — anon/authenticated 모두 권한 없음",
      async (table) => {
        for (const role of ["anon", "authenticated"]) {
          const rows = await db.query<{ ok: boolean }>(
            `select not has_table_privilege('${role}', 'public.${table}', 'SELECT, INSERT, UPDATE, DELETE') as ok`);
          expect(rows.rows[0].ok, `${role} → ${table}`).toBe(true);
        }
      },
    );
  });

  describe("거부 — 플랫폼 관리자가 아니면 함수도 닫힌다", () => {
    it("anon과 일반 인증 사용자는 목록·상세를 못 읽는다", async () => {
      anon();
      expect(await codeOf(`select public.list_platform_customers(null, 'all', 50, 0)`)).toBe("42501");
      nonAdmin();
      expect(await codeOf(`select public.list_platform_customers(null, 'all', 50, 0)`)).toBe("42501");
      expect(await codeOf(`select public.get_platform_customer('${ids.orgA}')`)).toBe("42501");
    });

    it("쓰기 4종도 42501로 닫힌다", async () => {
      nonAdmin();
      expect(await codeOf(`select public.set_platform_customer_setup('${ids.orgA}', 'active')`)).toBe("42501");
      expect(await codeOf(`select public.record_platform_customer_invite('${ids.orgA}', 'sent')`)).toBe("42501");
      expect(await codeOf(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '제목', 'setup')`)).toBe("42501");
      expect(await codeOf(`select public.update_platform_customer_task('${ids.task1}', '${ids.orgA}', 'done')`)).toBe("42501");
    });

    it("세션 무효(만료·취소)는 JWT가 남아도 8개 RPC 모두 42501이다", async () => {
      expiredSession();
      expect(await codeOf(`select public.list_platform_customers(null, 'all', 50, 0)`)).toBe("42501");
      expect(await codeOf(`select public.get_platform_customer('${ids.orgA}')`)).toBe("42501");
      expect(await codeOf(`select public.set_platform_customer_setup('${ids.orgA}', 'active')`)).toBe("42501");
      expect(await codeOf(`select public.record_platform_customer_invite('${ids.orgA}', 'sent')`)).toBe("42501");
      expect(await codeOf(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '제목', 'setup')`)).toBe("42501");
      expect(await codeOf(`select public.update_platform_customer_task('${ids.task1}', '${ids.orgA}', 'done')`)).toBe("42501");
      expect(await codeOf(`select public.list_platform_customer_tasks('${ids.orgA}')`)).toBe("42501");
      expect(await codeOf(`select public.list_platform_customer_history('${ids.orgA}', 200)`)).toBe("42501");
    });
  });

  describe("목록 — 좁은 등록 메타만, active 대장만", () => {
    it("프로필 없으면 업종 미설정·세팅 중·초대 전으로 읽히고 비active는 빠진다", async () => {
      admin();
      const out = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customers(null, 'all', 50, 0) as out`);
      expect(out.map((row) => row.slug).sort()).toEqual(["alpha", "beta", "delta", "epsilon", "gamma"]);
      const alpha = out.find((row) => row.slug === "alpha")!;
      expect(alpha).toMatchObject({
        name: "알파 회사", industry: "미설정",
        setup_status: "setting_up", invite_state: "pending",
        member_count: 1, open_task_count: 0,
      });
      const raw = JSON.stringify(out);
      expect(raw).not.toContain("gone");
      expect(raw).not.toContain("pending-co");
      expect(raw).not.toContain("suspended-co");
      expect(raw).not.toContain("requester_user_id");
    });

    it("검증된 대표(비운영자 owner)가 있으면 저장값과 무관하게 active다", async () => {
      admin();
      const out = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customers('베타', 'all', 50, 0) as out`);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ invite_state: "active", member_count: 3 });
      const single = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customers('엡실론', 'all', 50, 0) as out`);
      expect(single).toHaveLength(1);
      // 1명뿐이어도 주인이 비운영자 owner면 대표 참여다.
      expect(single[0]).toMatchObject({ invite_state: "active", member_count: 1 });
    });

    it("일반 두 번째 구성원·두 번째 운영자는 2명이어도 대표로 세지 않는다", async () => {
      admin();
      const gamma = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customers('감마', 'all', 50, 0) as out`);
      expect(gamma).toHaveLength(1);
      expect(gamma[0]).toMatchObject({ invite_state: "pending", member_count: 2 });
      const delta = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customers('델타', 'all', 50, 0) as out`);
      expect(delta).toHaveLength(1);
      expect(delta[0]).toMatchObject({ invite_state: "pending", member_count: 2 });
    });

    it("검색·상태 필터가 좁혀지고 잘못된 창은 22023이다", async () => {
      admin();
      const searched = await call<unknown[]>(
        `select public.list_platform_customers('알파', 'all', 50, 0) as out`);
      expect(searched).toHaveLength(1);
      const none = await call<unknown[]>(
        `select public.list_platform_customers('없는회사', 'all', 50, 0) as out`);
      expect(none).toEqual([]);
      expect(await codeOf(`select public.list_platform_customers(null, 'bogus', 50, 0)`)).toBe("22023");
      expect(await codeOf(`select public.list_platform_customers(null, 'all', 0, 0)`)).toBe("22023");
      expect(await codeOf(`select public.list_platform_customers(null, 'all', 101, 0)`)).toBe("22023");
      expect(await codeOf(`select public.list_platform_customers(null, 'all', 50, -1)`)).toBe("22023");
    });
  });

  describe("상세 — forged id는 권한을 만들지 않는다", () => {
    it("운영자 멤버 회사는 can_enter=true, 남은 아니오. 초기관리는 owner 본인만", async () => {
      admin();
      const alpha = await call<Record<string, unknown>>(
        `select public.get_platform_customer('${ids.orgA}') as out`);
      expect(alpha).toMatchObject({ can_enter: true, can_manage: true, has_rep: false, invite_state: "pending", industry: "미설정" });
      outsiderAdmin();
      const same = await call<Record<string, unknown>>(
        `select public.get_platform_customer('${ids.orgA}') as out`);
      expect(same).toMatchObject({ can_enter: false, can_manage: false, has_rep: false });
    });

    it("들어갈 수 있는 일반 구성원은 초대 관리를 열지 못한다", async () => {
      staffAdmin();
      const beta = await call<Record<string, unknown>>(
        `select public.get_platform_customer('${ids.orgB}') as out`);
      expect(beta).toMatchObject({ can_enter: true, can_manage: false, has_rep: true, invite_state: "active" });
    });

    it("없는 id·삭제·대기·정지 회사는 P0002 — 있어도 권한이 생기지 않는다", async () => {
      outsiderAdmin();
      expect(await codeOf(`select public.get_platform_customer('${id("ff")}')`)).toBe("P0002");
      expect(await codeOf(`select public.get_platform_customer('${ids.orgDeleted}')`)).toBe("P0002");
      expect(await codeOf(`select public.get_platform_customer('${ids.orgPending}')`)).toBe("P0002");
      expect(await codeOf(`select public.get_platform_customer('${ids.orgSuspended}')`)).toBe("P0002");
      expect(await codeOf(`select public.set_platform_customer_setup('${id("ff")}', 'active')`)).toBe("P0002");
      expect(await codeOf(`select public.set_platform_customer_setup('${ids.orgPending}', 'active')`)).toBe("P0002");
      expect(await codeOf(`select public.record_platform_customer_invite('${ids.orgPending}', 'sent')`)).toBe("P0002");
      expect(await codeOf(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgPending}', '제목', 'setup')`)).toBe("P0002");
      expect(await codeOf(`select public.update_platform_customer_task('${ids.task1}', '${ids.orgPending}', 'done')`)).toBe("P0002");
      expect(await codeOf(`select public.list_platform_customer_tasks('${ids.orgPending}')`)).toBe("P0002");
      expect(await codeOf(`select public.list_platform_customer_history('${ids.orgPending}', 200)`)).toBe("P0002");
    });
  });

  describe("쓰기 검증 — 잘못된 값은 22023", () => {
    it("상태·구분·길이·필수 id를 거부한다", async () => {
      admin();
      expect(await codeOf(`select public.set_platform_customer_setup('${ids.orgA}', 'bogus')`)).toBe("22023");
      expect(await codeOf(`select public.record_platform_customer_invite('${ids.orgA}', 'active')`)).toBe("22023");
      expect(await codeOf(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '', 'setup')`)).toBe("22023");
      expect(await codeOf(
        `select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '${"가".repeat(121)}', 'setup')`)).toBe("22023");
      expect(await codeOf(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '제목', 'bogus')`)).toBe("22023");
      expect(await codeOf(`select public.create_platform_customer_task(null, '${ids.orgA}', '제목', 'setup')`)).toBe("22023");
      expect(await codeOf(`select public.update_platform_customer_task('${ids.task1}', '${ids.orgA}', 'bogus')`)).toBe("22023");
    });

    it("다른 회사 id로는 작업을 건드릴 수 없고 «없다»고만 한다", async () => {
      admin();
      await call(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '알파 작업', 'setup') as out`);
      expect(await codeOf(`select public.update_platform_customer_task('${ids.task1}', '${ids.orgB}', 'done')`)).toBe("P0002");
      const tasks = await call<unknown[]>(
        `select public.list_platform_customer_tasks('${ids.orgB}') as out`);
      expect(tasks).toEqual([]);
    });
  });

  describe("영속·재조회 — 쓰면 읽힌다", () => {
    it("세팅 변경→상세 재조회→이력 before→after가 이어진다", async () => {
      admin();
      const set = await call<Record<string, unknown>>(
        `select public.set_platform_customer_setup('${ids.orgA}', 'active') as out`);
      expect(set).toMatchObject({ ok: true, changed: true, setup_status: "active" });
      const detail = await call<Record<string, unknown>>(
        `select public.get_platform_customer('${ids.orgA}') as out`);
      expect(detail.setup_status).toBe("active");
      // 명시적 프로필 등록 때 기본 업종이 들어간다.
      expect(detail.industry).toBe("경영컨설팅");
      const history = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customer_history('${ids.orgA}', 200) as out`);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ label: "세팅 완료", before: "setting_up", after: "active" });
    });

    it("초대 안내 기록→재조회가 sent로 이어진다", async () => {
      admin();
      const rec = await call<Record<string, unknown>>(
        `select public.record_platform_customer_invite('${ids.orgA}', 'sent') as out`);
      expect(rec).toMatchObject({ ok: true, changed: true, invite_state: "sent" });
      const detail = await call<Record<string, unknown>>(
        `select public.get_platform_customer('${ids.orgA}') as out`);
      expect(detail.invite_state).toBe("sent");
      // 도입 상태와 초대는 별개 축이다.
      expect(detail.setup_status).toBe("setting_up");
    });

    it("2명이어도 미검증 회사의 안내 기록은 active로 둔갑하지 않는다", async () => {
      admin();
      const rec = await call<Record<string, unknown>>(
        `select public.record_platform_customer_invite('${ids.orgC}', 'sent') as out`);
      expect(rec).toMatchObject({ ok: true, changed: true, invite_state: "sent" });
      const detail = await call<Record<string, unknown>>(
        `select public.get_platform_customer('${ids.orgC}') as out`);
      expect(detail).toMatchObject({ invite_state: "sent", has_rep: false, member_count: 2 });
    });

    it("작업 추가→목록→상태 변경→이력이 이어지고 원문은 history에 복사되지 않는다", async () => {
      admin();
      await call(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '대표 초대 안내', 'setup') as out`);
      const tasks = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customer_tasks('${ids.orgA}') as out`);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ title: "대표 초대 안내", kind: "setup", status: "todo" });
      const created = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customer_history('${ids.orgA}', 200) as out`);
      expect(created).toHaveLength(1);
      // 감사는 상태 enum + task_id 참조만. 제목 원문을 복사하지 않는다.
      expect(created[0]).toMatchObject({ label: "관리 작업 추가", before: "없음", after: "todo", task_id: ids.task1 });
      expect(JSON.stringify(created)).not.toContain("대표 초대 안내");
      const upd = await call<Record<string, unknown>>(
        `select public.update_platform_customer_task('${ids.task1}', '${ids.orgA}', 'in_progress') as out`);
      expect(upd).toMatchObject({ ok: true, changed: true, status: "in_progress" });
      const history = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customer_history('${ids.orgA}', 200) as out`);
      expect(history.map((h) => h.label)).toEqual(["작업 상태 변경", "관리 작업 추가"]);
      expect(history[0]).toMatchObject({ before: "todo", after: "in_progress", memo: "", task_id: ids.task1 });
      expect(JSON.stringify(history)).not.toContain("대표 초대 안내");
    });

    it("작업 목록은 최대 200건으로 묶인다", async () => {
      admin();
      await db.exec(`
        insert into public.platform_customer_tasks(id, org_id, title, kind, status, created_by)
        select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
          '${ids.orgA}', '작업 ' || g, 'setup', 'todo', '${ids.operator}'
        from generate_series(1, 205) g;
      `);
      const tasks = await call<Array<Record<string, unknown>>>(
        `select public.list_platform_customer_tasks('${ids.orgA}') as out`);
      expect(tasks).toHaveLength(200);
    });
  });

  describe("멱등·no-op — 같은 호출은 이력을 늘리지 않는다", () => {
    it("같은 상태 재설정은 changed=false, 이력 0건", async () => {
      admin();
      const first = await call<Record<string, unknown>>(
        `select public.set_platform_customer_setup('${ids.orgA}', 'setting_up') as out`);
      expect(first).toMatchObject({ changed: false });
      const history = await call<unknown[]>(
        `select public.list_platform_customer_history('${ids.orgA}', 200) as out`);
      expect(history).toEqual([]);
    });

    it("같은 작업 id·같은 내용 재등록은 created=false, 이력 1건 유지", async () => {
      admin();
      const a = await call<Record<string, unknown>>(
        `select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '중복 등록', 'support') as out`);
      const b = await call<Record<string, unknown>>(
        `select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '중복 등록', 'support') as out`);
      expect(a).toMatchObject({ created: true });
      expect(b).toMatchObject({ created: false });
      const history = await call<unknown[]>(
        `select public.list_platform_customer_history('${ids.orgA}', 200) as out`);
      expect(history).toHaveLength(1);
    });

    it("같은 작업 id에 다른 내용은 22023 — 조용히 덮지 않는다", async () => {
      admin();
      await call(`select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '원본', 'setup') as out`);
      expect(await codeOf(
        `select public.create_platform_customer_task('${ids.task1}', '${ids.orgA}', '바뀐 제목', 'setup')`)).toBe("22023");
      expect(await codeOf(
        `select public.create_platform_customer_task('${ids.task1}', '${ids.orgB}', '원본', 'setup')`)).toBe("22023");
    });

    it("같은 작업 상태 재지정은 changed=false, 이력 미증가", async () => {
      admin();
      await call(`select public.create_platform_customer_task('${ids.task2}', '${ids.orgA}', '상태 유지', 'support') as out`);
      const again = await call<Record<string, unknown>>(
        `select public.update_platform_customer_task('${ids.task2}', '${ids.orgA}', 'todo') as out`);
      expect(again).toMatchObject({ changed: false });
      const history = await call<unknown[]>(
        `select public.list_platform_customer_history('${ids.orgA}', 200) as out`);
      expect(history).toHaveLength(1);
    });

    it("수락된 회사에 sent 기록은 changed=false — active를 되돌리지 않는다", async () => {
      admin();
      const rec = await call<Record<string, unknown>>(
        `select public.record_platform_customer_invite('${ids.orgB}', 'sent') as out`);
      expect(rec).toMatchObject({ invite_state: "active", changed: false });
      const history = await call<unknown[]>(
        `select public.list_platform_customer_history('${ids.orgB}', 200) as out`);
      expect(history).toEqual([]);
    });
  });
});
