import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 152 — 상담 단계 보기 일괄 조회 PGlite 경계 테스트 (REAL SQL, stub 아님).
 *
 * 재는 것: STEP2·STEP3 탭이 같은 정본 보드를 복제 없이 mode 로 가르는 데 쓰는
 * `read_consultation_board_view` 가
 *  ① 보드 한 번 조회로 끝나는지(N+1 없음 — 호출 1회),
 *  ② 151 단일 스냅샷과 같은 권한 눈을 쓰는지(owner 전부·assigned 자기 건만·무관 멤버 빈 집합·타 org 거부),
 *  ③ 기록 없는 행을 remote·v0·빈 체크리스트로 읽는지(쓰기 없음),
 *  ④ EAV 위조가 섞이지 않는지(보호 상태만 정본),
 *  ⑤ contact 가 아닌 보드에서 빈 집합을 주는지,
 *  ⑥ 보기 전환(mode)이 다음 조회에도 유지되는지(새로고침 유지).
 *
 * 픽스처는 151 테스트와 같은 최소 스키마 + 069 최소 대역을 세우고,
 * 151 본문과 152 본문(가드 호출 제외)을 그대로 적용한다.
 */

const full151 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/151_consultation_protected_state.sql"),
  "utf8",
);
const body151 = full151.slice(full151.indexOf("create unique index if not exists deals_org_id_id_uq"));

const full152 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/152_consultation_board_view.sql"),
  "utf8",
);
const body152 = full152.slice(
  full152.indexOf("create or replace function public.read_consultation_board_view"),
);

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010",
  assignee: "00000000-0000-4000-8000-000000000011",
  stranger: "00000000-0000-4000-8000-000000000013",
  outsider: "00000000-0000-4000-8000-000000000012",
  pipeline: "00000000-0000-4000-8000-000000000020",
  meeting: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  board: "00000000-0000-4000-8000-000000000030",
  newLeadBoard: "00000000-0000-4000-8000-000000000033",
  itemA: "00000000-0000-4000-8000-0000000000a1",
  itemB: "00000000-0000-4000-8000-0000000000b2",
  dealA: "00000000-0000-4000-8000-0000000000d1",
  dealB: "00000000-0000-4000-8000-0000000000d2",
};

let sharedDb: PGlite;
beforeAll(async () => { sharedDb = new PGlite(); await sharedDb.waitReady; });
afterAll(async () => { await sharedDb?.close(); });

async function setup(): Promise<PGlite> {
  const db = sharedDb;
    // Reuse only the WASM engine. Every test still installs the real SQL on a
    // fresh schema with autocommit, fresh roles and no inherited actor/GUCs.
    await db.exec(`reset role; reset all;
      drop schema if exists public cascade; drop schema if exists auth cascade;
      drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;
      create schema public; grant usage on schema public to public;
      select set_config('app.uid','',false), set_config('request.jwt.claim.sub','',false);`);

  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
    create type public.stage_kind as enum ('marketing','meeting','contract','work','settle','post');
    create table public.orgs(id uuid primary key, status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid references public.orgs, user_id uuid references public.users,
      role text not null default 'member', scope text not null default 'assigned',
      status text not null default 'active', primary key(org_id, user_id));
    create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer
      set search_path = public as $$select exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid())$$;
    create function public.org_role(p_org uuid) returns text language sql stable security definer
      set search_path = public as $$select role from org_members where org_id = p_org and user_id = auth.uid()$$;
    create function public.org_scope(p_org uuid) returns text language sql stable security definer
      set search_path = public as $$select scope from org_members where org_id = p_org and user_id = auth.uid()$$;
    create table public.departments(id uuid primary key, org_id uuid, parent_id uuid, archived_at timestamptz);
    create table public.department_members(org_id uuid, dept_id uuid, user_id uuid, is_primary boolean not null default false, primary key(org_id, dept_id, user_id));
    create table public.test_permission_deny(org_id uuid, user_id uuid, perm text, primary key(org_id, user_id, perm));
    create function public.effective_permission(p_org_id uuid, p_scope_key text) returns boolean
      language sql stable security definer set search_path = public as
      $$select exists (select 1 from org_members m where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active')
        and not exists (select 1 from test_permission_deny d where d.org_id = p_org_id and d.user_id = auth.uid() and d.perm = p_scope_key)$$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant execute on function public.is_org_member(uuid) to anon, authenticated, service_role;
    grant execute on function public.org_role(uuid) to anon, authenticated, service_role;
    grant execute on function public.org_scope(uuid) to anon, authenticated, service_role;
    grant execute on function public.effective_permission(uuid, text) to anon, authenticated, service_role;
    create table public.pipelines(id uuid primary key, org_id uuid);
    create table public.stages(id uuid primary key, pipeline_id uuid, kind public.stage_kind);
    create table public.companies(id uuid primary key default gen_random_uuid(), org_id uuid);
    create table public.deals(id uuid primary key, org_id uuid references public.orgs,
      company_id uuid, pipeline_id uuid, stage_id uuid, assigned_to uuid,
      title text, custom jsonb not null default '{}', updated_at timestamptz default now());
    create table public.activities(id uuid primary key default gen_random_uuid(), org_id uuid, deal_id uuid, type text, content text, actor uuid);
    create table public.boards(id uuid primary key, org_id uuid, source text);
    create table public.items(id uuid primary key, org_id uuid, board_id uuid, title text,
      assigned_to uuid, deal_id uuid, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, primary key(item_id, column_key));
    create table public.contact_pipeline_transitions(org_id uuid, request_id uuid, deal_id uuid,
      source_item_id uuid, kind text, from_stage_id uuid, to_stage_id uuid, actor_id uuid,
      status text, block_reason text, primary key(org_id, request_id));
    create function public.execute_contact_pipeline_transition(
      p_org_id uuid, p_deal_id uuid, p_source_item_id uuid, p_request_id uuid, p_kind text,
      p_company_id uuid default null, p_company_name text default null,
      p_biz_no text default null, p_owner_name text default null,
      p_business_type text default null, p_industry text default null,
      p_region_sido text default null, p_region_sigungu text default null,
      p_phone text default null, p_founded_on date default null,
      p_revenue numeric default null)
    returns table(status text, deal_id uuid, company_id uuid, reason text)
    language plpgsql security definer set search_path = '' as $stub$
    begin
      return query select 'blocked'::text, null::uuid, null::uuid, 'stub'::text; return;
    end; $stub$;
  `);
  await db.exec(`
    grant select on public.orgs, public.users, public.org_members, public.pipelines, public.stages,
      public.companies, public.deals, public.activities, public.boards, public.items,
      public.item_values, public.contact_pipeline_transitions, public.departments,
      public.department_members, public.test_permission_deny to anon, authenticated, service_role;
  `);
  await db.exec(body151);
  await db.exec(body152);
  await db.exec(`
    insert into orgs values ('${ids.org}'), ('${ids.other}');
    insert into users values ('${ids.owner}'), ('${ids.assignee}'), ('${ids.stranger}'), ('${ids.outsider}');
    insert into org_members values
      ('${ids.org}','${ids.owner}','owner','all','active'),
      ('${ids.org}','${ids.assignee}','member','assigned','active'),
      ('${ids.org}','${ids.stranger}','member','assigned','active'),
      ('${ids.other}','${ids.outsider}','owner','all','active');
    insert into pipelines values ('${ids.pipeline}','${ids.org}');
    insert into stages values ('${ids.meeting}','${ids.pipeline}','meeting'), ('${ids.work}','${ids.pipeline}','work');
    insert into boards values ('${ids.board}','${ids.org}','core.default-tab/contact'),
      ('${ids.newLeadBoard}','${ids.org}','core.default-tab/new-lead');
    insert into deals values
      ('${ids.dealA}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','테스트 회사A','{}'),
      ('${ids.dealB}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.owner}','테스트 회사B','{}');
    insert into items values
      ('${ids.itemA}','${ids.org}','${ids.board}','테스트 회사A','${ids.assignee}','${ids.dealA}',null),
      ('${ids.itemB}','${ids.org}','${ids.board}','테스트 회사B','${ids.owner}','${ids.dealB}',null);
  `);
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`select set_config('app.uid','${userId}',false)`);
}

const req = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

async function boardView(db: PGlite, org: string, board: string) {
  return db.query<Record<string, unknown>>(
    `select * from read_consultation_board_view('${org}','${board}')`,
  );
}

describe("152 consultation board view (PGlite)", () => {

  it("owner 는 보드 한 번 조회로 전 행을 본다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const result = await boardView(db, ids.org, ids.board);
    const byId = new Map(result.rows.map((row) => [row.item_id, row]));
    expect([...byId.keys()].sort()).toEqual([ids.itemA, ids.itemB].sort());
    // 기록 없는 행은 remote·v0·빈 체크리스트(쓰기 없음).
    expect(byId.get(ids.itemA)).toMatchObject({ mode: "remote", version: 0, ready: false });
  });

  it("assigned 멤버는 자기 건만 본다 — 권한 밖 행은 결과에 없다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    const result = await boardView(db, ids.org, ids.board);
    expect(result.rows.map((row) => row.item_id)).toEqual([ids.itemA]);
  });

  it("맡은 건이 없는 멤버는 빈 집합, 타 org 는 거부된다", async () => {
    const db = await setup();
    await asUser(db, ids.stranger);
    expect((await boardView(db, ids.org, ids.board)).rows).toEqual([]);
    await asUser(db, ids.outsider);
    await expect(boardView(db, ids.org, ids.board)).rejects.toThrow(/permission denied/);
  });

  it("EAV 위조는 섞이지 않는다 — 보호 상태만 정본이다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    // 가짜 거울: EAV 에 확인한 것처럼 적는다.
    await db.exec(
      `insert into item_values values ('${ids.org}','${ids.itemA}','consultation_ledger','{"contract_sent": true}')`,
    );
    const result = await boardView(db, ids.org, ids.board);
    const entry = result.rows.find((row) => row.item_id === ids.itemA);
    const checklist = entry?.checklist as Record<string, { confirmed: boolean }>;
    expect(checklist.contract_sent.confirmed).toBe(false);
    expect(entry).toMatchObject({ ready: false });
  });

  it("contact 가 아닌 보드는 빈 집합이다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    expect((await boardView(db, ids.org, ids.newLeadBoard)).rows).toEqual([]);
  });

  it("보기 전환(mode)은 다음 조회에도 유지된다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await db.query(
      `select version from execute_consultation_transition(
        '${ids.org}','${ids.itemA}','${req("00000000b101")}','mode',null,null,'inperson',
        '2026-10-02T10:00:00+09:00','${ids.assignee}',0)`,
    );
    const first = await boardView(db, ids.org, ids.board);
    expect(first.rows.find((row) => row.item_id === ids.itemA)).toMatchObject({
      mode: "inperson",
      version: 1,
    });
    // «새로고침» — 새 조회에서도 같은 자리다.
    const second = await boardView(db, ids.org, ids.board);
    expect(second.rows.find((row) => row.item_id === ids.itemA)).toMatchObject({
      mode: "inperson",
      version: 1,
    });
  });

  it("4확인 + 직인 행은 ready 로 읽힌다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await db.exec(
      `insert into item_values values
        ('${ids.org}','${ids.itemB}','work_move','"업무관리 이동"'),
        ('${ids.org}','${ids.itemB}','seal_status','"완료"')`,
    );
    // 실제 069 deal-branch 는 deals.custom 직인(정본)을 요구한다. 보드 거울만으로
    // ready 가 되지 않으므로 정본 승인까지 갖춘다(REAL-CHAIN 정합).
    await db.exec(
      `update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.dealB}'`,
    );
    const steps = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"];
    for (const [index, step] of steps.entries()) {
      await db.query(
        `select version from execute_consultation_transition(
          '${ids.org}','${ids.itemB}','${req(`00000000b20${index}`)}','check','${step}',true,null,null,null,${index})`,
      );
    }
    const result = await boardView(db, ids.org, ids.board);
    expect(result.rows.find((row) => row.item_id === ids.itemB)).toMatchObject({
      ready: true,
      version: 4,
    });
  });
});
