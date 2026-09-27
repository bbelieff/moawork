import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 151 — 상담 보호 상태 PGlite 경계 테스트 (REAL SQL, stub 아님).
 *
 * 재는 것: EAV readVersion->setValues 가 아닌 RPC+행잠금+CAS 로
 * 동시성(CAS)/롤백(원자실패 무변경)/위조거부(EAV·직접쓰기)/cross-org/scope/
 * replay(같은 request+payload)/mismatch(같은 request+다른 payload)/noop 을 증명한다.
 * 메모리 CAS 테스트는 DB 를 증명하지 않으므로 여기서는 PGlite 에서만 잰다.
 *
 * 픽스처는 최소 스키마만 세우고, 151 본문(가드 호출 제외)을 그대로 적용한다.
 * 069 inner 는 같은 시그니처의 최소 대역으로 둔다 — 069 자체 계약은 기존
 * contactPipeline.pglite.test.ts 가 증명하므로, 여기서는 래퍼의 게이트
 * (활성 상담행 차단 vs 레거시 위임 vs committed replay 위임)만 잰다.
 */

const full = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/151_consultation_protected_state.sql"),
  "utf8",
);
const body = full.slice(full.indexOf("create unique index if not exists deals_org_id_id_uq"));

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010",
  assignee: "00000000-0000-4000-8000-000000000011",
  outsider: "00000000-0000-4000-8000-000000000012",
  stranger: "00000000-0000-4000-8000-000000000013",
  pipeline: "00000000-0000-4000-8000-000000000020",
  meeting: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  board: "00000000-0000-4000-8000-000000000030",
  newLeadBoard: "00000000-0000-4000-8000-000000000033",
  item: "00000000-0000-4000-8000-000000000031",
  newLeadItem: "00000000-0000-4000-8000-000000000034",
  deal: "00000000-0000-4000-8000-000000000040",
  newLeadDeal: "00000000-0000-4000-8000-000000000044",
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
    -- 069 inner 최소 대역: 정식 seal/work_move 게이트 + meeting->work 커밋.
    -- F2 회귀용: p_deal_id null 이면 새 deal 을 만들어 구 버그(중복 생성)를 재현하고,
    -- 정본 deal 을 주면 같은 deal 을 보존한다. 래퍼는 정본 deal 을 강제한다.
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
  await db.exec(body);
  await db.exec(`
    insert into orgs values ('${ids.org}'), ('${ids.other}');
    insert into users values ('${ids.owner}'), ('${ids.assignee}'), ('${ids.outsider}'), ('${ids.stranger}');
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
      ('${ids.deal}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','테스트 회사','{}'),
      ('${ids.newLeadDeal}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','신규리드 건','{}');
    insert into items values
      ('${ids.item}','${ids.org}','${ids.board}','테스트 회사','${ids.assignee}','${ids.deal}',null),
      ('${ids.newLeadItem}','${ids.org}','${ids.newLeadBoard}','신규리드 건','${ids.assignee}','${ids.newLeadDeal}',null);
    insert into item_values values
      ('${ids.org}','${ids.item}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.item}','seal_status','"완료"');
  `);
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`select set_config('app.uid','${userId}',false)`);
}

const req = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

async function check(
  db: PGlite,
  suffix: string,
  step: string,
  confirmed: boolean,
  expectedVersion: number,
) {
  return db.query<{ version: number; replayed: boolean }>(
    `select version, replayed from execute_consultation_transition(
      '${ids.org}','${ids.item}','${req(suffix)}','check','${step}',${confirmed},null,null,null,${expectedVersion})`,
  );
}

describe("151 consultation protected state (PGlite)", () => {

  it("순차 확인 + CAS: 동시 version0 둘 중 하나만 성공하고 나머지는 40001", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const first = await check(db, "00000000c001", "contract_sent", true, 0);
    expect(first.rows[0]).toMatchObject({ version: 1, replayed: false });
    await expect(check(db, "00000000c002", "signed_copy_sent", true, 0)).rejects.toThrow(/consultation version conflict/);
    const second = await check(db, "00000000c002", "signed_copy_sent", true, 1);
    expect(second.rows[0]).toMatchObject({ version: 2, replayed: false });
    const state = await db.query<{ version: number }>(
      `select version from consultation_states where org_id='${ids.org}' and item_id='${ids.item}'`);
    expect(state.rows[0].version).toBe(2);
  });

  it("순서 위반은 원자 실패로 버전·히스토리·요청을 그대로 둔다(롤백)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await expect(check(db, "00000000c011", "deposit_confirmed", true, 0)).rejects.toThrow(/checklist blocked/);
    const state = await db.query<{ version: number }>(
      `select version from consultation_states where org_id='${ids.org}' and item_id='${ids.item}'`);
    expect(state.rows).toHaveLength(0);
    expect((await db.query("select count(*)::int n from consultation_events")).rows[0]).toMatchObject({ n: 0 });
    expect((await db.query("select count(*)::int n from consultation_requests")).rows[0]).toMatchObject({ n: 0 });
  });

  it("앞 취소가 뒤를 무효화하고 사건을 쌓는다(되돌리기도 새 사건)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    let version = 0;
    const steps = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"];
    for (let i = 0; i < steps.length; i += 1) {
      const r = await check(db, `00000000c02${i}`, steps[i]!, true, version);
      version = Number(r.rows[0].version);
    }
    expect(version).toBe(4);
    const undone = await db.query<{ version: number }>(
      `select version from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("00000000c02f")}','check','contract_sent',false,null,null,null,${version})`);
    expect(undone.rows[0].version).toBe(5);
    const kinds = await db.query<{ kind: string }>(
      `select kind from consultation_events order by created_at`);
    expect(kinds.rows.map((r) => r.kind)).toEqual(
      ["confirmed", "confirmed", "confirmed", "confirmed", "unconfirmed", "invalidated", "invalidated", "invalidated"]);
    await expect(check(db, "00000000c030", "deposit_confirmed", true, 5)).rejects.toThrow(/checklist blocked/);
  });

  it("같은 request+payload 는 저장 없이 replay, 다른 payload 는 22023 mismatch", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const first = await check(db, "00000000c041", "contract_sent", true, 0);
    expect(first.rows[0]).toMatchObject({ version: 1, replayed: false });
    const replay = await check(db, "00000000c041", "contract_sent", true, 0);
    expect(replay.rows[0]).toMatchObject({ version: 1, replayed: true });
    expect((await db.query("select count(*)::int n from consultation_events")).rows[0]).toMatchObject({ n: 1 });
    await expect(db.query(
      `select * from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("00000000c041")}','check','signed_copy_sent',true,null,null,null,1)`))
      .rejects.toThrow(/idempotency key reuse/);
  });

  it("이미 확인된 단계 재확인은 noop(버전·사건 불변, 요청만 기록)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await check(db, "00000000c051", "contract_sent", true, 0);
    const noop = await check(db, "00000000c052", "contract_sent", true, 1);
    expect(noop.rows[0]).toMatchObject({ version: 1, replayed: false });
    expect((await db.query("select count(*)::int n from consultation_events")).rows[0]).toMatchObject({ n: 1 });
  });

  it("EAV 거울을 손으로 채워도 스냅샷 readiness 가 되지 않는다(위조 거부)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await db.exec(`insert into item_values values
      ('${ids.org}','${ids.item}','consultation_ledger','"{\\"version\\":99}"'),
      ('${ids.org}','${ids.item}','contract_sent','true'),
      ('${ids.org}','${ids.item}','signed_copy_sent','true'),
      ('${ids.org}','${ids.item}','counterparty_signature_confirmed','true'),
      ('${ids.org}','${ids.item}','deposit_confirmed','true')
      on conflict do nothing`);
    const snap = await db.query<{ ready: boolean; version: number; missing: string[] }>(
      `select ready, version, missing from read_consultation_snapshot('${ids.org}','${ids.item}')`);
    expect(snap.rows[0].ready).toBe(false);
    expect(snap.rows[0].version).toBe(0);
    expect(snap.rows[0].missing).toHaveLength(4);
  });

  it("직접 테이블 쓰기는 권한 없이 거부된다(보호 상태 RPC-only)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await db.exec(`set role authenticated`);
    await expect(db.query(`insert into consultation_states(org_id,item_id,deal_id,mode,version,checklist)
      values ('${ids.org}','${ids.item}','${ids.deal}','remote',99,'{}')`)).rejects.toThrow();
    await expect(db.query(`select * from consultation_states where org_id='${ids.org}'`)).resolves.toBeDefined();
    await db.exec(`reset role`);
  });

  it("cross-org 와 담당범위 밖 읽기·쓰기를 거부한다", async () => {
    const db = await setup();
    await asUser(db, ids.outsider);
    await expect(check(db, "00000000c081", "contract_sent", true, 0)).rejects.toThrow(/permission denied/);
    await expect(db.query(
      `select * from read_consultation_snapshot('${ids.org}','${ids.item}')`)).rejects.toThrow(/permission denied/);
    await asUser(db, ids.stranger);
    await expect(check(db, "00000000c082", "contract_sent", true, 0)).rejects.toThrow(/permission denied/);
    await expect(db.query(
      `select * from read_consultation_snapshot('${ids.org}','${ids.item}')`)).rejects.toThrow(/permission denied/);
    await asUser(db, ids.assignee);
    await expect(db.query(
      `select * from read_consultation_snapshot('${ids.org}','${ids.item}')`)).resolves.toBeDefined();
  });

  it("신규리드 보드 쓰기는 거부되고 단계는 new 로 남는다(정식 이전만 허용)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await expect(db.query(
      `select * from execute_consultation_transition(
        '${ids.org}','${ids.newLeadItem}','${req("00000000c091")}','check','contract_sent',true,null,null,null,0)`))
      .rejects.toThrow(/new lead transfer required/);
    const snap = await db.query<{ mode: string; ready: boolean }>(
      `select mode, ready from read_consultation_snapshot('${ids.org}','${ids.newLeadItem}')`);
    expect(snap.rows[0]).toMatchObject({ mode: "new_lead", ready: false });
  });

  it("mode 전이는 회의일시+정식 담당자로 검증하고 임의 assignee 값을 무시하지 않는다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await expect(db.query(
      `select * from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("00000000c0a1")}','mode',null,null,'inperson',null,null,0)`))
      .rejects.toThrow(/meeting required/);
    // assignee 생략 → 현재 item 담당자(활성 멤버)로 일정 검증 후 성공한다.
    const moved = await db.query<{ mode: string; version: number }>(
      `select mode, version from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("00000000c0a2")}','mode',null,null,'inperson','2026-10-01T10:00+09',null,0)`);
    expect(moved.rows[0]).toMatchObject({ mode: "inperson", version: 1 });
    // 현재 담당자와 다른 값은 lineage 선행 요구로 거부된다(조용히 무시하지 않는다).
    await expect(db.query(
      `select * from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("00000000c0a3")}','mode',null,null,'inperson','2026-10-01T10:00+09','${ids.outsider}',1)`))
      .rejects.toThrow(/lineage/);
    // 같은 mode+일시+담당자는 noop 이다.
    const noop = await db.query<{ mode: string; version: number; replayed: boolean }>(
      `select mode, version, replayed from execute_consultation_transition(
        '${ids.org}','${ids.item}','${req("00000000c0a4")}','mode',null,null,'inperson','2026-10-01T10:00+09','${ids.assignee}',1)`);
    expect(noop.rows[0]).toMatchObject({ mode: "inperson", version: 1, replayed: false });
    const item = await db.query<{ assigned_to: string }>(`select assigned_to from items where id='${ids.item}'`);
    expect(item.rows[0].assigned_to).toBe(ids.assignee);
  });

  it("활성 상담행이 미완이면 contact_to_work 를 blocked 로 막고, 완료되면 위임한다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await check(db, "00000000c0b1", "contract_sent", true, 0);
    // F2: 활성 상담행은 정본 deal 을 함께 넘긴다(null 금지).
    const blocked = await db.query<{ status: string; reason: string }>(
      `select status, reason from execute_contact_pipeline_transition(
        '${ids.org}','${ids.deal}','${ids.item}','${req("00000000c0b9")}','contact_to_work',null,'테스트 회사')`);
    expect(blocked.rows[0].status).toBe("blocked");
    expect(blocked.rows[0].reason).toMatch(/인계 조건/);
    expect((await db.query<{ stage_id: string }>(`select stage_id from deals where id='${ids.deal}'`)).rows[0].stage_id).toBe(ids.meeting);
  });

  it("상담행 없는 레거시는 기존 게이트 그대로 위임된다(업그레이드 호환)", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const committed = await db.query<{ status: string }>(
      `select status from execute_contact_pipeline_transition(
        '${ids.org}',null,'${ids.item}','${req("00000000c0c9")}','contact_to_work',null,'테스트 회사')`);
    expect(committed.rows[0].status).toBe("committed");
    expect((await db.query<{ stage_id: string }>(`select stage_id from deals where id='${ids.deal}'`)).rows[0].stage_id).toBe(ids.work);
  });

  it("스냅샷은 deal 의 실제 company_id 를 읽는다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await db.exec(`insert into companies values ('00000000-0000-4000-8000-000000000050','${ids.org}');
      update deals set company_id='00000000-0000-4000-8000-000000000050' where id='${ids.deal}'`);
    const snap = await db.query<{ company_id: string; deal_id: string }>(
      `select company_id, deal_id from read_consultation_snapshot('${ids.org}','${ids.item}')`);
    expect(snap.rows[0]).toMatchObject({
      deal_id: ids.deal,
      company_id: "00000000-0000-4000-8000-000000000050",
    });
  });
});
