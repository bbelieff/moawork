import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * v17 consultation security repair — 7 findings 회귀 (REAL SQL, stub 아님).
 *
 * F1 래퍼 사전인증+helper 비공개+영수증 덮어쓰기 방지 / F2 정본 deal 보존+불일치 거부 /
 * F3 잠금 순서 게이트 재확인 / F4 view_tabs(076:792) / F5 부서 가시성(076:812-814) /
 * F6 replay 우선+초기 noop 정합 / F7 bounded IDs+입력 검증.
 *
 * 픽스처는 151·152 본문(가드 호출 제외)을 그대로 적용한다. 069 inner 는 최소 대역으로
 * 두되 F2 회귀용으로 null deal 이면 새 deal 을 만드는 구 버그 동작을 재현한다 —
 * 래퍼가 정본 deal 을 강제하므로 중복 생성이 막히는 것을 증명한다.
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
  outsider: "00000000-0000-4000-8000-000000000012",
  stranger: "00000000-0000-4000-8000-000000000013",
  teamLead: "00000000-0000-4000-8000-000000000014",
  deptMember: "00000000-0000-4000-8000-000000000015",
  pipeline: "00000000-0000-4000-8000-000000000020",
  meeting: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  board: "00000000-0000-4000-8000-000000000030",
  item: "00000000-0000-4000-8000-000000000031",
  deal: "00000000-0000-4000-8000-000000000040",
  dept: "00000000-0000-4000-8000-000000000060",
  itemDept: "00000000-0000-4000-8000-000000000061",
  dealDept: "00000000-0000-4000-8000-000000000062",
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
    declare v_seal text; v_move text; v_deal uuid; v_reason text;
    begin
      if auth.uid() is null or p_kind <> 'contact_to_work' then
        raise exception 'transition unavailable' using errcode = '42501';
      end if;
      if p_source_item_id is null then
        raise exception 'transition unavailable' using errcode = '22023';
      end if;
      select iv.value_jsonb #>> '{}' into v_seal from public.item_values iv
       where iv.item_id = p_source_item_id and iv.column_key = 'seal_status';
      select iv.value_jsonb #>> '{}' into v_move from public.item_values iv
       where iv.item_id = p_source_item_id and iv.column_key = 'work_move';
      if coalesce(v_move, '') <> '업무관리 이동' then v_reason := '업무관리 이동을 먼저 선택해 주세요.';
      elsif coalesce(v_seal, '대기') <> '완료' then v_reason := '대표 직인 승인이 필요합니다.';
      end if;
      if v_reason is not null then
        insert into public.contact_pipeline_transitions(org_id, source_item_id, request_id, kind, actor_id, status, block_reason)
        values (p_org_id, p_source_item_id, p_request_id, p_kind, auth.uid(), 'blocked', v_reason)
        on conflict (org_id, request_id) do update set status = 'blocked', block_reason = excluded.block_reason;
        return query select 'blocked'::text, null::uuid, null::uuid, v_reason; return;
      end if;
      if p_deal_id is null then
        insert into public.deals(id, org_id, pipeline_id, stage_id, assigned_to, title)
        values (gen_random_uuid(), p_org_id, null, '${ids.work}', auth.uid(), 'handoff-new-deal')
        returning id into v_deal;
      else
        v_deal := p_deal_id;
        update public.deals set stage_id = '${ids.work}' where id = v_deal;
      end if;
      insert into public.contact_pipeline_transitions(org_id, deal_id, source_item_id, request_id, kind, actor_id, status)
      values (p_org_id, v_deal, p_source_item_id, p_request_id, p_kind, auth.uid(), 'committed')
      on conflict (org_id, request_id) do update set status = 'committed';
      return query select 'committed'::text, v_deal, null::uuid, null::text; return;
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
    insert into users values ('${ids.owner}'), ('${ids.assignee}'), ('${ids.outsider}'),
      ('${ids.stranger}'), ('${ids.teamLead}'), ('${ids.deptMember}');
    insert into org_members values
      ('${ids.org}','${ids.owner}','owner','all','active'),
      ('${ids.org}','${ids.assignee}','member','assigned','active'),
      ('${ids.org}','${ids.stranger}','member','assigned','active'),
      ('${ids.org}','${ids.teamLead}','team_lead','department','active'),
      ('${ids.org}','${ids.deptMember}','member','assigned','active'),
      ('${ids.other}','${ids.outsider}','owner','all','active');
    insert into pipelines values ('${ids.pipeline}','${ids.org}');
    insert into stages values ('${ids.meeting}','${ids.pipeline}','meeting'), ('${ids.work}','${ids.pipeline}','work');
    insert into boards values ('${ids.board}','${ids.org}','core.default-tab/contact');
    insert into deals values
      ('${ids.deal}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','테스트 회사','{}'),
      ('${ids.dealDept}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.deptMember}','부서 건','{}');
    insert into items values
      ('${ids.item}','${ids.org}','${ids.board}','테스트 회사','${ids.assignee}','${ids.deal}',null),
      ('${ids.itemDept}','${ids.org}','${ids.board}','부서 건','${ids.deptMember}','${ids.dealDept}',null);
    insert into item_values values
      ('${ids.org}','${ids.item}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.item}','seal_status','"완료"'),
      ('${ids.org}','${ids.itemDept}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.itemDept}','seal_status','"완료"');
    insert into departments values ('${ids.dept}','${ids.org}',null,null);
    insert into department_members values
      ('${ids.org}','${ids.dept}','${ids.teamLead}',true),
      ('${ids.org}','${ids.dept}','${ids.deptMember}',true);
  `);
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`select set_config('app.uid','${userId}',false)`);
}

const req = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

async function check(db: PGlite, suffix: string, step: string, confirmed: boolean, version: number) {
  return db.query<{ version: number; replayed: boolean }>(
    `select version, replayed from execute_consultation_transition(
      '${ids.org}','${ids.item}','${req(suffix)}','check','${step}',${confirmed},null,null,null,${version})`,
  );
}

async function transitionCount(db: PGlite) {
  const r = (await db.query("select count(*)::int n from contact_pipeline_transitions")) as unknown as { rows: Array<{ n: number }> };
  return r.rows[0].n;
}

describe("consultation security repair (PGlite, REAL SQL)", () => {

  it("F1: 타 org 아웃사이더 helper 직접 읽기·래퍼 영수증 삽입이 거부되고 부작용이 없다", async () => {
    const db = await setup();
    await asUser(db, ids.outsider);
    // helper 직접 호출 — 내부 인증에서 거부된다(42501).
    await expect(db.query(
      `select consultation_handoff_block_reason('${ids.org}','${ids.item}','${ids.deal}')`))
      .rejects.toThrow(/permission denied|authentication/);
    // 래퍼 차단 경로 — 읽기·영수증 쓰기 전에 거부된다.
    await expect(db.query(
      `select * from execute_contact_pipeline_transition(
        '${ids.org}','${ids.deal}','${ids.item}','${req("f10000000001")}','contact_to_work',null,'테스트 회사')`))
      .rejects.toThrow(/unavailable|permission denied/);
    expect(await transitionCount(db)).toBe(0);
    // 권한 밖 행은 만들지 않았다.
    expect((((await db.query("select count(*)::int n from consultation_states")) as unknown as { rows: Array<{ n: number }> }).rows[0])).toMatchObject({ n: 0 });
  });

  it("F1: 다른 동작의 영수증을 덮어쓰지 않는다(요청 재사용 불일치 22023)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await check(db, "f10000000011", "contract_sent", true, 0);
    // 같은 requestId 로 차단 영수증을 만든다.
    await db.query(
      `select * from execute_contact_pipeline_transition(
        '${ids.org}','${ids.deal}','${ids.item}','${req("f10000000019")}','contact_to_work',null,'테스트 회사')`);
    expect(await transitionCount(db)).toBe(1);
    // 같은 requestId + 다른 source_item → 22023, 기존 영수증 유지.
    await expect(db.query(
      `select * from execute_contact_pipeline_transition(
        '${ids.org}','${ids.dealDept}','${ids.itemDept}','${req("f10000000019")}','contact_to_work',null,'부서 건')`))
      .rejects.toThrow(/target mismatch/);
    const row = await db.query<{ status: string; source_item_id: string }>(
      `select status, source_item_id from contact_pipeline_transitions where request_id='${req("f10000000019")}'`);
    expect(row.rows[0]).toMatchObject({ status: "blocked", source_item_id: ids.item });
  });

  it("F2: 정본 deal 로 인계하면 같은 deal 이 보존되고 중복 deal 이 생기지 않는다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const steps = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"];
    for (const [index, step] of steps.entries()) {
      await check(db, `f2000000002${index}`, step, true, index);
    }
    const before = ((await db.query("select count(*)::int n from deals")) as unknown as { rows: Array<{ n: number }> }).rows[0].n;
    const snap = await db.query<{ deal_id: string; company_id: string | null }>(
      `select deal_id, company_id from read_consultation_snapshot('${ids.org}','${ids.item}')`);
    expect(snap.rows[0].deal_id).toBe(ids.deal);
    // 실제 069 deal-branch 는 deals.custom 직인(정본)을 요구한다. 정본 승인까지
    // 갖춰야 정식 인계가 커밋된다(REAL-CHAIN 정합).
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    const done = await db.query<{ status: string; deal_id: string }>(
      `select status, deal_id from execute_contact_pipeline_transition(
        '${ids.org}','${ids.deal}','${ids.item}','${req("f20000000029")}','contact_to_work',null,'테스트 회사')`);
    expect(done.rows[0]).toMatchObject({ status: "committed", deal_id: ids.deal });
    const after = ((await db.query("select count(*)::int n from deals")) as unknown as { rows: Array<{ n: number }> }).rows[0].n;
    expect(after).toBe(before);
  });

  it("F2: 불일치 deal·company·null deal(활성행)은 22023 으로 거부된다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await check(db, "f20000000031", "contract_sent", true, 0);
    const otherDeal = "00000000-0000-4000-8000-00000000ff01";
    await db.exec(`insert into deals values ('${otherDeal}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.owner}','다른 건','{}')`);
    await expect(db.query(
      `select * from execute_contact_pipeline_transition(
        '${ids.org}','${otherDeal}','${ids.item}','${req("f20000000039")}','contact_to_work',null,'테스트 회사')`))
      .rejects.toThrow(/target mismatch/);
    // 활성 상담행에 null deal → 새 deal 생성을 막고 거부한다.
    await expect(db.query(
      `select * from execute_contact_pipeline_transition(
        '${ids.org}',null,'${ids.item}','${req("f2000000003a")}','contact_to_work',null,'테스트 회사')`))
      .rejects.toThrow(/target mismatch/);
    expect(await transitionCount(db)).toBe(0);
  });

  it("F3: 취소 경합은 잠금 안 재확인 게이트에 막힌다(순서 item->deal->state)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const steps = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"];
    for (const [index, step] of steps.entries()) {
      await check(db, `f3000000004${index}`, step, true, index);
    }
    // «동시 취소»를 순차로 재현: 1단계를 취소하면 뒤가 함께 무효가 된다(version 5).
    await db.query(
      `select * from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("f3000000004f")}','check','contract_sent',false,null,null,null,4)`);
    // 잠금 뒤 재확인 게이트가 미완을 보고 blocked 로 막는다. deal 은 그대로다.
    const blocked = await db.query<{ status: string }>(
      `select status from execute_contact_pipeline_transition(
        '${ids.org}','${ids.deal}','${ids.item}','${req("f30000000059")}','contact_to_work',null,'테스트 회사')`);
    expect(blocked.rows[0].status).toBe("blocked");
    expect((await db.query<{ stage_id: string }>(`select stage_id from deals where id='${ids.deal}'`)).rows[0].stage_id)
      .toBe(ids.meeting);
    // 래퍼가 item->deal->state 순서로 잠그는지 계약으로 고정한다.
    const src = readFileSync(resolve(process.cwd(), "../supabase/migrations/151_consultation_protected_state.sql"), "utf8");
    const wrapper = src.slice(src.indexOf("create or replace function public.execute_contact_pipeline_transition("));
    const itemLock = wrapper.indexOf("for update of i;");
    const dealLock = wrapper.indexOf("for update of d;");
    const stateLock = wrapper.indexOf("for update of s;");
    expect(itemLock).toBeGreaterThan(-1);
    expect(dealLock).toBeGreaterThan(itemLock);
    expect(stateLock).toBeGreaterThan(dealLock);
  });

  it("F4: view_tabs 박탈은 단일·일괄·쓰기를 모두 거부한다(076:792)", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await db.exec(`insert into test_permission_deny values ('${ids.org}','${ids.assignee}','work.view_tabs')`);
    await expect(db.query(`select * from read_consultation_snapshot('${ids.org}','${ids.item}')`))
      .rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from read_consultation_board_view('${ids.org}','${ids.board}')`))
      .rejects.toThrow(/permission denied/);
    await expect(check(db, "f40000000001", "contract_sent", true, 0)).rejects.toThrow(/permission denied/);
    expect((((await db.query("select count(*)::int n from consultation_states")) as unknown as { rows: Array<{ n: number }> }).rows[0])).toMatchObject({ n: 0 });
    expect(await transitionCount(db)).toBe(0);
  });

  it("F5: 부서 가시성 — team_lead 는 같은 부서 건을 보고 낯선 건을 못 본다(076:812-814)", async () => {
    const db = await setup();
    await asUser(db, ids.teamLead);
    const seen = await db.query<{ item_id: string }>(
      `select item_id from read_consultation_board_view('${ids.org}','${ids.board}')`);
    expect(seen.rows.map((r) => r.item_id)).toEqual([ids.itemDept]);
    await expect(db.query(`select * from read_consultation_snapshot('${ids.org}','${ids.item}')`))
      .rejects.toThrow(/permission denied/);
    const deptSnap = await db.query(`select * from read_consultation_snapshot('${ids.org}','${ids.itemDept}')`);
    expect(deptSnap.rows).toHaveLength(1);
  });

  it("F6: 초기 noop 영수증 replay·요청 해시 불일치·유실 응답 재시도가 정합하다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    // 초기 noop: 아무 확인도 없는 상태에서 취소는 버전 그대로 영수증만 남긴다(상태행 없음).
    const noop = await db.query<{ version: number; replayed: boolean }>(
      `select version, replayed from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("f60000000001")}','check','contract_sent',false,null,null,null,0)`);
    expect(noop.rows[0]).toMatchObject({ version: 0, replayed: false });
    expect((((await db.query("select count(*)::int n from consultation_states")) as unknown as { rows: Array<{ n: number }> }).rows[0])).toMatchObject({ n: 0 });
    // 같은 request+payload replay → replayed true, 상태행 없이 저장 결과로 답한다.
    const replay = await db.query<{ version: number; replayed: boolean }>(
      `select version, replayed from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("f60000000001")}','check','contract_sent',false,null,null,null,0)`);
    expect(replay.rows[0]).toMatchObject({ version: 0, replayed: true });
    // 같은 request+다른 payload → 22023.
    await expect(db.query(
      `select * from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("f60000000001")}','check','signed_copy_sent',true,null,null,null,0)`))
      .rejects.toThrow(/idempotency key reuse/);
    // 유실 응답 재시도: 커밋 뒤 같은 request 재전송은 사건을 늘리지 않고 replay 한다.
    await check(db, "f60000000011", "contract_sent", true, 0);
    const eventsBefore = (((await db.query("select count(*)::int n from consultation_events")) as unknown as { rows: Array<{ n: number }> }).rows[0]).n;
    const lost = await check(db, "f60000000011", "contract_sent", true, 0);
    expect(lost.rows[0]).toMatchObject({ replayed: true });
    expect((((await db.query("select count(*)::int n from consultation_events")) as unknown as { rows: Array<{ n: number }> }).rows[0]).n).toBe(eventsBefore);
  });

  it("F7: bounded IDs·입력 검증 — 권한 밖 제외, 범위 밖 거부, 안정 정렬", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    // 부분 ID 만 요청하면 그것만 온다.
    const part = await db.query<{ item_id: string }>(
      `select item_id from read_consultation_board_view('${ids.org}','${ids.board}',array['${ids.item}']::uuid[],200,0)`);
    expect(part.rows.map((r) => r.item_id)).toEqual([ids.item]);
    // 낯선 ID·타 org ID 를 섞어도 권한 밖은 제외된다(fail-closed, 누출 없음).
    const mixed = await db.query<{ item_id: string }>(
      `select item_id from read_consultation_board_view('${ids.org}','${ids.board}',array['${ids.item}','00000000-0000-4000-8000-00000000ffff']::uuid[],200,0)`);
    expect(mixed.rows.map((r) => r.item_id)).toEqual([ids.item]);
    // 범위 밖 입력은 거부된다.
    await expect(db.query(`select * from read_consultation_board_view('${ids.org}','${ids.board}',null,0,0)`))
      .rejects.toThrow(/limit out of range/);
    await expect(db.query(`select * from read_consultation_board_view('${ids.org}','${ids.board}',null,501,0)`))
      .rejects.toThrow(/limit out of range/);
    await expect(db.query(`select * from read_consultation_board_view('${ids.org}','${ids.board}',null,200,-1)`))
      .rejects.toThrow(/offset out of range/);
    // 안정 정렬: id 순으로 온다.
    const all = await db.query<{ item_id: string }>(
      `select item_id from read_consultation_board_view('${ids.org}','${ids.board}',null,200,0)`);
    const sorted = [...all.rows.map((r) => r.item_id)].sort();
    expect(all.rows.map((r) => r.item_id)).toEqual(sorted);
  });
});
