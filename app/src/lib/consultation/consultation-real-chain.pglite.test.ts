import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * CONSULTATION-REAL-CHAIN — 실제 069/087/065 체인과의 정합 (REAL SQL, stub 없음).
 *
 * 배경: 기존 151 PGlite 테스트는 069 inner 를 "item_values 직인 읽기" stub 으로
 * 대체했다. 실제 069 deal-branch 는 deals.custom.seal_approval/seal_status 를
 * 읽고(069:105-131), committed 영수증에 source_item_id 를 남기지 않으며,
 * owner/admin/all/self 좁은 행 계약(069:109)을 강제한다. 이 파일은 실제
 * 087->069->065 함수 원문을 PGlite 에 그대로 적용하고 4가지 실패를 증명한다.
 *
 * 적용 범위(원문 그대로, 최소 외부 의존):
 *  - 065 전체 파일 (handoff_company_to_work 정본)
 *  - 069 전체 파일 (execute_contact_pipeline_transition 정본)
 *  - 087 중 DO rename 블록 + execute 래퍼 + 해당 revoke/grant 행만 발췌
 *    (create/update_new_lead 등은 인계 경로와 무관해 제외 — stub이 아니라 범위 축소)
 *  - 151 본문(가드 호출 제외), 152 조회 함수(가드 호출 제외)
 */

const full065 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/065_company_master_identity.sql"),
  "utf8",
);
const full069 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/069_contact_pipeline_transitions.sql"),
  "utf8",
);
const full087 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/087_new_lead_canonical.sql"),
  "utf8",
);
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

// 087: DO rename 블록 + contact 래퍼만 원문 발췌한다.
const doStart = full087.indexOf(
  "if to_regprocedure('public.execute_contact_pipeline_transition(uuid",
);
const doBlockStart = full087.lastIndexOf("do $$", doStart);
const doBlockEnd = full087.indexOf("end $$;", doStart) + "end $$;".length;
const wrapperStart = full087.indexOf(
  "create or replace function public.execute_contact_pipeline_transition(",
  doBlockEnd,
);
const wrapperEnd =
  full087.indexOf("end $$;", wrapperStart) + "end $$;".length;
const body087chain =
  full087.slice(doBlockStart, doBlockEnd) + "\n" + full087.slice(wrapperStart, wrapperEnd);
const acl087chain = full087
  .split("\n")
  .filter(
    (line) =>
      line.includes("execute_contact_pipeline_transition(") &&
      (line.startsWith("revoke") || line.startsWith("grant")),
  )
  .join("\n");

// Exact 153 archived-child function + trigger-install block, without unrelated item-operation RPCs.
const full153 = readFileSync(resolve(process.cwd(), "../supabase/migrations/153_item_operations_draft.sql"), "utf8");
const archivedGuard153 = full153.slice(
  full153.indexOf("create or replace function public.guard_archived_item_child_write()"),
  full153.indexOf("create or replace function public.guard_archived_deal_write()"),
);
const full156 = readFileSync(resolve(process.cwd(), "../supabase/migrations/156_consultation_workflow.sql"), "utf8");
const body156 = full156.slice(full156.indexOf("alter table public.consultation_states add column phase"));

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000010",
  assignee: "00000000-0000-4000-8000-000000000011",
  stranger: "00000000-0000-4000-8000-000000000013",
  teamLead: "00000000-0000-4000-8000-000000000014",
  deptMember: "00000000-0000-4000-8000-000000000015",
  pipeline: "00000000-0000-4000-8000-000000000020",
  meeting: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  board: "00000000-0000-4000-8000-000000000030",
  item: "00000000-0000-4000-8000-000000000031",
  deal: "00000000-0000-4000-8000-000000000040",
  itemDept: "00000000-0000-4000-8000-000000000061",
  dealDept: "00000000-0000-4000-8000-000000000062",
  itemNull: "00000000-0000-4000-8000-000000000063",
  dealNull: "00000000-0000-4000-8000-000000000064",
  dept: "00000000-0000-4000-8000-000000000060",
};

let sharedDb: PGlite;
beforeAll(async () => { sharedDb = new PGlite(); await sharedDb.waitReady; });
afterAll(async () => { await sharedDb?.close(); });

async function setup(withWorkflow = true): Promise<PGlite> {
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
    create table public.stages(id uuid primary key, pipeline_id uuid, kind text);
    create table public.companies(id uuid primary key default gen_random_uuid(), org_id uuid,
      name text, biz_no text, business_type text, industry text, biz_type text,
      region_sido text, region_sigungu text, region text, owner_name text, phone text,
      founded_on date, revenue numeric, assigned_to uuid, created_from text not null default 'manual',
      merged_into uuid, created_at timestamptz not null default now());
    create table public.deals(id uuid primary key, org_id uuid references public.orgs,
      company_id uuid, pipeline_id uuid, stage_id uuid, assigned_to uuid,
      title text, custom jsonb not null default '{}', updated_at timestamptz default now());
    create table public.activities(id uuid primary key default gen_random_uuid(), org_id uuid, deal_id uuid, type text, content text, actor uuid);
    create table public.boards(id uuid primary key, org_id uuid, source text);
    create table public.items(id uuid primary key, org_id uuid, board_id uuid, title text,
      assigned_to uuid, deal_id uuid, deleted_at timestamptz, archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, primary key(item_id, column_key));
  `);
  await db.exec(`
    grant select, insert, update, delete on public.orgs, public.users, public.org_members,
      public.pipelines, public.stages, public.companies, public.deals, public.activities,
      public.boards, public.items, public.item_values, public.departments,
      public.department_members, public.test_permission_deny to anon, authenticated, service_role;
  `);
  // 실제 체인 원문 적용: 065 -> 069 -> 087(체인 부분) -> 151 -> 152
  await db.exec(full065);
  await db.exec(full069);
  await db.exec(body087chain);
  await db.exec(acl087chain);
  await db.exec(body151);
  await db.exec(body152);
  await db.exec(archivedGuard153);
  if (withWorkflow) await db.exec(body156);
  await db.exec(`
    insert into orgs values ('${ids.org}');
    insert into users values ('${ids.owner}'), ('${ids.assignee}'), ('${ids.stranger}'),
      ('${ids.teamLead}'), ('${ids.deptMember}');
    insert into org_members values
      ('${ids.org}','${ids.owner}','owner','all','active'),
      ('${ids.org}','${ids.assignee}','member','assigned','active'),
      ('${ids.org}','${ids.stranger}','member','assigned','active'),
      ('${ids.org}','${ids.teamLead}','team_lead','department','active'),
      ('${ids.org}','${ids.deptMember}','member','assigned','active');
    insert into departments values ('${ids.dept}','${ids.org}',null,null);
    insert into department_members values
      ('${ids.org}','${ids.dept}','${ids.teamLead}',true),
      ('${ids.org}','${ids.dept}','${ids.deptMember}',true);
    insert into pipelines values ('${ids.pipeline}','${ids.org}');
    insert into stages values
      ('${ids.meeting}','${ids.pipeline}','meeting'),
      ('${ids.work}','${ids.pipeline}','work');
    insert into boards values ('${ids.board}','${ids.org}','core.default-tab/contact');
    insert into deals (id, org_id, company_id, pipeline_id, stage_id, assigned_to, title, custom) values
      ('${ids.deal}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','테스트 회사','{}'),
      ('${ids.dealDept}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.deptMember}','부서 건','{}'),
      ('${ids.dealNull}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}',null,'무담당 건','{}');
    insert into items (id, org_id, board_id, title, assigned_to, deal_id, deleted_at) values
      ('${ids.item}','${ids.org}','${ids.board}','테스트 회사','${ids.assignee}','${ids.deal}',null),
      ('${ids.itemDept}','${ids.org}','${ids.board}','부서 건','${ids.deptMember}','${ids.dealDept}',null),
      ('${ids.itemNull}','${ids.org}','${ids.board}','무담당 건',null,'${ids.dealNull}',null);
    insert into item_values values
      ('${ids.org}','${ids.item}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.item}','seal_status','"완료"'),
      ('${ids.org}','${ids.itemDept}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.itemDept}','seal_status','"완료"'),
      ('${ids.org}','${ids.itemNull}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.itemNull}','seal_status','"완료"');
  `);
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`select set_config('app.uid','${userId}',false)`);
}

const reqCache = new Map<string, string>();
let reqCounter = 0;
const req = (tag: string) => {
  const hit = reqCache.get(tag);
  if (hit) return hit;
  reqCounter += 1;
  const id = `00000000-0000-4000-8000-${reqCounter.toString(16).padStart(12, "0")}`;
  reqCache.set(tag, id);
  return id;
};
const STEPS = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"];

async function check(
  db: PGlite,
  itemId: string,
  suffix: string,
  step: string,
  confirmed: boolean,
  expectedVersion: number,
) {
  return db.query<{ version: number; replayed: boolean }>(
    `select version, replayed from execute_consultation_transition(
      '${ids.org}','${itemId}','${req(suffix)}','check','${step}',${confirmed},null,null,null,${expectedVersion})`,
  );
}

async function completeChecks(db: PGlite, itemId: string, tag: string): Promise<number> {
  let version = 0;
  for (let i = 0; i < STEPS.length; i += 1) {
    const r = await check(db, itemId, `${tag}${i}`, STEPS[i]!, true, version);
    version = Number(r.rows[0]!.version);
  }
  return version;
}

async function handoff(
  db: PGlite,
  itemId: string,
  dealId: string,
  suffix: string,
  companyName: string | null = "테스트 회사",
) {
  const nameArg = companyName === null ? "null" : `'${companyName}'`;
  return db.query<{ status: string; deal_id: string | null; company_id: string | null; reason: string | null }>(
    `select status, deal_id, company_id, reason from execute_contact_pipeline_transition(
      '${ids.org}','${dealId}','${itemId}','${req(suffix)}','contact_to_work',
      null,${nameArg},null,null,null,null,null,null,null,null,null)`,
  );
}

describe("CONSULTATION-REAL-CHAIN (실제 069/087/065)", () => {

  it("P1-실체인결합: 151 래퍼가 실제 087 래퍼를 거쳐 069 정본으로 위임한다", async () => {
    const db = await setup();
    const def = await db.query<{ proname: string }>(
      `select proname from pg_proc where proname in
        ('execute_contact_pipeline_transition','execute_contact_pipeline_transition_069',
         'execute_contact_pipeline_transition_legacy_069','handoff_company_to_work')
        and pronamespace = 'public'::regnamespace order by 1`,
    );
    expect(def.rows.map((r) => r.proname).sort()).toEqual([
      "execute_contact_pipeline_transition",
      "execute_contact_pipeline_transition_069",
      "execute_contact_pipeline_transition_legacy_069",
      "handoff_company_to_work",
    ]);
  });

  it("P1-직인: 계약-기준 직인 미승인이면 스냅샷이 ready를 주장하지 않는다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "seal01");
    // 보드 거울은 완료, 계약 정본(deals.custom)은 대기 상태 그대로다.
    const snap = await db.query<{ ready: boolean; seal_approved: boolean; seal_detail: string }>(
      `select ready, seal_approved, seal_detail from read_consultation_snapshot('${ids.org}','${ids.item}')`,
    );
    expect(snap.rows[0]!.ready).toBe(false);
    expect(snap.rows[0]!.seal_approved).toBe(false);
    expect(snap.rows[0]!.seal_detail).toMatch(/계약 기준/);
  });

  it("P1-직인: 미승인 인계는 계약-기준 사유로 blocked, 승인 후 실제 065로 committed", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "seal02");
    const blocked = await handoff(db, ids.item, ids.deal, "seal0200");
    expect(blocked.rows[0]!.status).toBe("blocked");
    expect(blocked.rows[0]!.reason ?? "").toMatch(/계약 기준/);
    const stage = await db.query<{ kind: string }>(
      `select s.kind from deals d join stages s on s.id = d.stage_id where d.id = '${ids.deal}'`,
    );
    expect(stage.rows[0]!.kind).toBe("meeting");
    // 정본 직인 승인 후 같은 흐름은 실제 체인으로 커밋된다.
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    const snap = await db.query<{ ready: boolean; seal_approved: boolean }>(
      `select ready, seal_approved from read_consultation_snapshot('${ids.org}','${ids.item}')`,
    );
    expect(snap.rows[0]).toMatchObject({ ready: true, seal_approved: true });
    const done = await handoff(db, ids.item, ids.deal, "seal0201");
    expect(done.rows[0]!.status).toBe("committed");
    expect(done.rows[0]!.deal_id).toBe(ids.deal);
    expect(done.rows[0]!.company_id).not.toBeNull();
    const after = await db.query<{ kind: string; company_id: string | null }>(
      `select s.kind, d.company_id from deals d join stages s on s.id = d.stage_id where d.id = '${ids.deal}'`,
    );
    expect(after.rows[0]!.kind).toBe("work");
    expect(after.rows[0]!.company_id).toBe(done.rows[0]!.company_id);
  });

  it("P1-영수증: committed 영수증이 source_item을 묶고 같은 요청 replay가 성공한다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "rcpt01");
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    const done = await handoff(db, ids.item, ids.deal, "rcpt0100");
    expect(done.rows[0]!.status).toBe("committed");
    const receipt = await db.query<{ source_item_id: string | null; deal_id: string; status: string }>(
      `select source_item_id, deal_id, status from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id = '${req("rcpt0100")}'`,
    );
    expect(receipt.rows[0]).toMatchObject({ status: "committed", deal_id: ids.deal });
    expect(receipt.rows[0]!.source_item_id).toBe(ids.item);
    // 유실 응답 재시도: 같은 요청 그대로 replay 한다.
    const replay = await handoff(db, ids.item, ids.deal, "rcpt0100");
    expect(replay.rows[0]).toMatchObject({
      status: "committed",
      deal_id: ids.deal,
      company_id: done.rows[0]!.company_id,
    });
    const companies = await db.query<{ n: number }>(
      `select count(*)::int n from companies where org_id = '${ids.org}'`,
    );
    expect(companies.rows[0]!.n).toBe(1);
  });

  it("P1-영수증: 위조 item/deal/kind replay는 22023으로 거부된다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "rcpt02");
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    await handoff(db, ids.item, ids.deal, "rcpt0200");
    // 같은 request에 다른 item
    await expect(handoff(db, ids.itemDept, ids.deal, "rcpt0200")).rejects.toThrow(
      /target mismatch/,
    );
    // 같은 request에 다른 deal
    await expect(handoff(db, ids.item, ids.dealDept, "rcpt0200")).rejects.toThrow(
      /target mismatch|canonical association/,
    );
    // 같은 request에 다른 kind
    await expect(
      db.query(
        `select * from execute_contact_pipeline_transition(
          '${ids.org}','${ids.deal}','${ids.item}','${req("rcpt0200")}','lead_to_contact',
          null,null,null,null,null,null,null,null,null,null,null)`,
      ),
    ).rejects.toThrow(/target mismatch/);
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id = '${req("rcpt0200")}'`,
    );
    expect(receipts.rows[0]!.n).toBe(1);
  });

  it("P1-순서: 권한 박탈 후 replay는 42501이며 현재 행을 새지 않는다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await check(db, ids.item, "ord01", "contract_sent", true, 0);
    await db.exec(
      `insert into test_permission_deny values ('${ids.org}','${ids.assignee}','work.item_upsert')`,
    );
    await expect(check(db, ids.item, "ord01", "contract_sent", true, 0)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("P1-순서: 재배정 후 이전 담당자 replay는 42501이다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await check(db, ids.item, "ord02", "contract_sent", true, 0);
    await db.exec(`update items set assigned_to = '${ids.stranger}' where id = '${ids.item}'`);
    await expect(check(db, ids.item, "ord02", "contract_sent", true, 0)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("P1-순서: 인증된 replay는 CAS/상태 전제조건보다 먼저 답한다", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    const first = await check(db, ids.item, "ord03", "contract_sent", true, 0);
    expect(first.rows[0]).toMatchObject({ version: 1, replayed: false });
    const replay = await check(db, ids.item, "ord03", "contract_sent", true, 0);
    expect(replay.rows[0]).toMatchObject({ version: 1, replayed: true });
  });

  it("P1-순서: 인계 replay도 권한 뒤에 읽힌다(박탈 후 42501, 쓰기 없음)", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "ord04");
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    const done = await handoff(db, ids.item, ids.deal, "ord0400");
    expect(done.rows[0]!.status).toBe("committed");
    await db.exec(
      `insert into test_permission_deny values ('${ids.org}','${ids.assignee}','work.item_upsert')`,
    );
    await expect(handoff(db, ids.item, ids.deal, "ord0400")).rejects.toThrow(
      /unavailable|permission denied/,
    );
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id = '${req("ord0400")}'`,
    );
    expect(receipts.rows[0]!.n).toBe(1);
  });

  it("P2-부서: 팀리드는 같은 부서 상담을 확인하고 읽는다(진행·가시성 유지)", async () => {
    const db = await setup();
    await asUser(db, ids.teamLead);
    const r = await check(db, ids.itemDept, "dept01", "contract_sent", true, 0);
    expect(r.rows[0]).toMatchObject({ version: 1, replayed: false });
    const snap = await db.query(
      `select * from read_consultation_snapshot('${ids.org}','${ids.itemDept}')`,
    );
    expect(snap.rows).toHaveLength(1);
  });

  it("P2-부서: 팀리드 인계는 체인 계약으로 거부되고 아무것도 쓰지 않는다", async () => {
    const db = await setup();
    await asUser(db, ids.deptMember);
    await check(db, ids.itemDept, "dept02", "contract_sent", true, 0);
    await asUser(db, ids.teamLead);
    await expect(handoff(db, ids.itemDept, ids.dealDept, "dept0200")).rejects.toThrow(
      /unavailable|permission denied/,
    );
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id = '${req("dept0200")}'`,
    );
    expect(receipts.rows[0]!.n).toBe(0);
    const state = await db.query<{ version: number }>(
      `select version from consultation_states where org_id = '${ids.org}' and item_id = '${ids.itemDept}'`,
    );
    expect(state.rows[0]!.version).toBe(1);
  });

  it("P2-부서: 부서 밖·무담당 건은 fail-closed(거부 + 쓰기 없음)", async () => {
    const db = await setup();
    await asUser(db, ids.teamLead);
    await expect(
      db.query(
        `select * from read_consultation_snapshot('${ids.org}','${ids.item}')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(handoff(db, ids.item, ids.deal, "dept0300")).rejects.toThrow(
      /unavailable|permission denied/,
    );
    await expect(handoff(db, ids.itemNull, ids.dealNull, "dept0301")).rejects.toThrow(
      /unavailable|permission denied/,
    );
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id in ('${req("dept0300")}','${req("dept0301")}')`,
    );
    expect(receipts.rows[0]!.n).toBe(0);
  });

  it("P2-부서: 보드 일괄 조회도 부서 가시성 안에서만 돌려준다", async () => {
    const db = await setup();
    await asUser(db, ids.teamLead);
    const view = await db.query<{ item_id: string }>(
      `select item_id from read_consultation_board_view('${ids.org}','${ids.board}')`,
    );
    const seen = view.rows.map((r) => r.item_id);
    expect(seen).toContain(ids.itemDept);
    expect(seen).not.toContain(ids.item);
  });

  it("P1-엣지: 보드 직인 철회되면 ready=false이며 인계는 보드 사유로 blocked, company/stage 무변경", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "edge01");
    // 정본(계약) 승인은 유지한 채 보드 거울만 대기로 철회한다.
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    await db.exec(
      `update item_values set value_jsonb = '"대기"' where item_id = '${ids.item}' and column_key = 'seal_status'`,
    );
    const snap = await db.query<{ ready: boolean; seal_approved: boolean; seal_detail: string }>(
      `select ready, seal_approved, seal_detail from read_consultation_snapshot('${ids.org}','${ids.item}')`,
    );
    expect(snap.rows[0]!.ready).toBe(false);
    expect(snap.rows[0]!.seal_approved).toBe(false);
    expect(snap.rows[0]!.seal_detail).toMatch(/보드/);
    const companiesBefore = await db.query<{ n: number }>(
      `select count(*)::int n from companies where org_id = '${ids.org}'`,
    );
    // ready=false 에서 첫 변이 RPC 를 타도(유실 응답 replay 경로) 보드 게이트가 막는다.
    const result = await handoff(db, ids.item, ids.deal, "edge0100");
    expect(result.rows[0]!.status).toBe("blocked");
    expect(result.rows[0]!.reason ?? "").toMatch(/보드/);
    // 차단 영수증에도 잠금 확정 target(deal+source)이 묶인다.
    const receipt = await db.query<{ status: string; deal_id: string; source_item_id: string }>(
      `select status, deal_id, source_item_id from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id = '${req("edge0100")}'`,
    );
    expect(receipt.rows[0]).toMatchObject({
      status: "blocked",
      deal_id: ids.deal,
      source_item_id: ids.item,
    });
    // company/stage 무변경.
    const companiesAfter = await db.query<{ n: number }>(
      `select count(*)::int n from companies where org_id = '${ids.org}'`,
    );
    expect(companiesAfter.rows[0]!.n).toBe(companiesBefore.rows[0]!.n);
    const deal = await db.query<{ kind: string; company_id: string | null }>(
      `select s.kind, d.company_id from deals d join stages s on s.id = d.stage_id where d.id = '${ids.deal}'`,
    );
    expect(deal.rows[0]!.kind).toBe("meeting");
    expect(deal.rows[0]!.company_id).toBeNull();
  });

  it("P1-엣지: blocked->승인->같은 요청 재시도는 committed, 다른 target/kind/payload 재시도는 22023", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "edge02");
    // 정본 미승인 → 계약-기준 사유로 blocked (보드 거울은 완료 상태).
    const blocked = await handoff(db, ids.item, ids.deal, "edge0200");
    expect(blocked.rows[0]!.status).toBe("blocked");
    expect(blocked.rows[0]!.reason ?? "").toMatch(/계약 기준/);
    // 정본 승인 후 SAME request 재시도 → committed (069:114 어긋남 없음).
    await db.exec(`update deals set custom = '{"seal_approval":"완료"}' where id = '${ids.deal}'`);
    const done = await handoff(db, ids.item, ids.deal, "edge0200");
    expect(done.rows[0]).toMatchObject({ status: "committed", deal_id: ids.deal });
    expect(done.rows[0]!.company_id).not.toBeNull();
    // 같은 요청에 다른 item/deal/kind/다른 company payload → 22023 으로 거부된다.
    await expect(handoff(db, ids.itemDept, ids.deal, "edge0200")).rejects.toThrow(
      /target mismatch/,
    );
    await expect(handoff(db, ids.item, ids.dealDept, "edge0200")).rejects.toThrow(
      /target mismatch|canonical association/,
    );
    await expect(
      db.query(
        `select * from execute_contact_pipeline_transition(
          '${ids.org}','${ids.deal}','${ids.item}','${req("edge0200")}','lead_to_contact',
          null,null,null,null,null,null,null,null,null,null,null)`,
      ),
    ).rejects.toThrow(/target mismatch/);
    await expect(
      db.query(
        `select * from execute_contact_pipeline_transition(
          '${ids.org}','${ids.deal}','${ids.item}','${req("edge0200")}','contact_to_work',
          '00000000-0000-4000-8000-00000000ff02','다른 회사',null,null,null,null,null,null,null,null,null)`,
      ),
    ).rejects.toThrow(/target mismatch/);
    // 영수증 1행, 회사 1곳 — 재시도가 중복 생성하지 않는다.
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions
        where org_id = '${ids.org}' and request_id = '${req("edge0200")}'`,
    );
    expect(receipts.rows[0]!.n).toBe(1);
    const companies = await db.query<{ n: number }>(
      `select count(*)::int n from companies where org_id = '${ids.org}'`,
    );
    expect(companies.rows[0]!.n).toBe(1);
    const after = await db.query<{ kind: string }>(
      `select s.kind from deals d join stages s on s.id = d.stage_id where d.id = '${ids.deal}'`,
    );
    expect(after.rows[0]!.kind).toBe("work");
  });
  const workflow = (db: PGlite, tag: string, version: number, phase: string, mode = "remote", meeting: string | null = null, cancel = false) => db.query<{ version: number; replayed: boolean }>(
    "select * from execute_consultation_workflow($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [ids.org, ids.item, req(tag), version, mode, phase, meeting, ids.assignee, cancel]);

  it("156 preserves legacy progress on migration and legacy 151 mode/check signatures", async () => {
    const db = await setup(false); await asUser(db, ids.assignee);
    await check(db, ids.item, "156legacy", "contract_sent", true, 0);
    const before = (await db.query<Record<string, unknown>>("select * from consultation_states")).rows[0];
    await db.exec(body156);
    const after = (await db.query("select * from consultation_states")).rows[0];
    expect(after).toEqual({ ...before, phase: "contract" });
    await db.query(`select * from execute_consultation_transition('${ids.org}','${ids.item}','${req("156oldmode")}','mode',null,null,'inperson','2026-10-02T10:00Z','${ids.assignee}',1)`);
    const state = (await db.query<{ mode: string; phase: string; version: number }>("select mode,phase,version from consultation_states")).rows[0];
    expect(state).toMatchObject({ mode: "inperson", phase: "contract", version: 2 });
  });

  it("156 actual phase, same-mode reschedule and cancellation keep IDs/checks with meaningful history", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    const original = (await db.query("select id,deal_id,assigned_to from items order by id")).rows;
    await workflow(db,"156schedule",0,"scheduled","remote","2026-10-02T10:00Z");
    await workflow(db,"156reschedule",1,"scheduled","remote","2026-10-03T11:00Z");
    await workflow(db,"156cancel",2,"on_hold","remote",null,true);
    const snap = (await db.query<{ phase: string; meeting_at: string | null; history: { kind: string; details: { before: { meetingAt: string }; after: { meetingAt: null } } }[] }>(`select * from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`)).rows[0];
    expect(snap.phase).toBe("on_hold"); expect(snap.meeting_at).toBeNull();
    expect(snap.history[0].kind).toBe("appointment_cancelled");
    expect(snap.history[0].details.before.meetingAt).toContain("2026-10-03");
    expect(snap.history[0].details.after.meetingAt).toBeNull();
    expect(snap.history[1].kind).toBe("rescheduled");
    expect((await db.query("select id,deal_id,assigned_to from items order by id")).rows).toEqual(original);
    expect((await db.query<{ n: number }>("select count(*)::int n from companies")).rows[0].n).toBe(0);
  });

  it("156 replay precedes CAS but current permission precedes replay; no duplicate history", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await workflow(db,"156retry",0,"consulting");
    expect((await workflow(db,"156retry",0,"consulting")).rows[0].replayed).toBe(true);
    await expect(workflow(db,"156retry",0,"rejected")).rejects.toThrow(/idempotency key reuse/);
    await expect(workflow(db,"156stale",0,"rejected")).rejects.toThrow(/version conflict/);
    await db.exec(`insert into test_permission_deny values('${ids.org}','${ids.assignee}','work.item_upsert')`);
    await expect(workflow(db,"156retry",0,"consulting")).rejects.toThrow(/permission denied/);
    expect((await db.query<{ n: number }>("select count(*)::int n from consultation_events")).rows[0].n).toBe(1);
    await asUser(db,ids.stranger);
    await expect(workflow(db,"156outsider",1,"rejected")).rejects.toThrow(/permission denied/);
  });

  it("156 mode transfer/cancel preserves contract checks and actual 151 handoff stays blocked until all four", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await workflow(db,"156inperson",0,"meeting_scheduled","inperson","2026-10-02T10:00Z");
    await workflow(db,"156cancelinperson",1,"cancelled","inperson",null,true);
    expect((await handoff(db,ids.item,ids.deal,"156blocked")).rows[0].status).toBe("blocked");
    await workflow(db,"156contract",2,"contract","inperson");
    for (let i=0;i<STEPS.length;i++) await check(db,ids.item,`156checks${i}`,STEPS[i],true,3+i);
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    expect((await handoff(db,ids.item,ids.deal,"156ready")).rows[0].status).toBe("committed");
  });

  it("156 schedule validation and lineage rejection leave no state, receipt or history", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await expect(workflow(db,"156notime",0,"follow_up")).rejects.toThrow(/schedule meeting required/);
    await expect(workflow(db,"156badphase",0,"meeting_done","remote")).rejects.toThrow(/phase unsupported/);
    await expect(db.query(`select * from execute_consultation_workflow('${ids.org}','${ids.item}','${req("156assignee")}',0,'remote','scheduled','2026-10-02T10:00Z','${ids.owner}',false)`)).rejects.toThrow(/lineage/);
    for (const table of ["consultation_states","consultation_requests","consultation_events"]) {
      expect((await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0);
    }
  });

  it("156 board read stays bounded and current-row authorized with legacy default information", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    const rows = (await db.query<{ item_id: string; phase: string }>(`select * from read_consultation_board_view_v2('${ids.org}','${ids.board}',null,1,0)`)).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ item_id: ids.item, phase: "information" });
    await asUser(db,ids.stranger);
    expect((await db.query(`select * from read_consultation_board_view_v2('${ids.org}','${ids.board}',array['${ids.item}'::uuid],200,0)`)).rows).toEqual([]);
  });

  it("156 authenticated boundary denies direct state writes and revoked-view readers", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await db.exec("set role anon");
    await expect(workflow(db,"156anon",0,"consulting")).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role authenticated");
    await workflow(db,"156authenticated",0,"consulting");
    await expect(db.query("update consultation_states set phase='contract'")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.exec(`insert into test_permission_deny values('${ids.org}','${ids.assignee}','work.view_tabs')`);
    await db.exec("set role authenticated");
    await expect(db.query(`select * from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from read_consultation_board_view_v2('${ids.org}','${ids.board}')`)).rejects.toThrow(/permission denied/);
    await expect(workflow(db,"156authenticated",0,"consulting")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    expect((await db.query<{ n: number }>("select count(*)::int n from consultation_events")).rows[0].n).toBe(1);
  });

  it("156 upgrade skips archived state under the actual 153 child guard and derives phase after restore", async () => {
    const db = await setup(false); await asUser(db, ids.owner);
    await check(db,ids.item,"156archivedcheck","contract_sent",true,0);
    await check(db,ids.itemDept,"156activecheck","contract_sent",true,0);
    const before = (await db.query<Record<string, unknown>>(`select * from consultation_states where item_id='${ids.item}'`)).rows[0];
    await db.exec(`update items set archived_at='2026-09-27T00:00:00Z' where id='${ids.item}'`);
    // Original all-row backfill would trip this real 153 guard, even for a no-op write.
    await expect(db.exec("update consultation_states set version=version")).rejects.toThrow(/archived item must be restored/);
    await db.exec(body156);
    const archived = (await db.query<Record<string, unknown>>(`select * from consultation_states where item_id='${ids.item}'`)).rows[0];
    expect(archived).toEqual({ ...before, phase: null });
    expect((await db.query<{ phase: string }>(`select phase from consultation_states where item_id='${ids.itemDept}'`)).rows[0].phase).toBe("contract");
    await db.exec(`update items set archived_at=null where id='${ids.item}'`);
    expect((await db.query<{ phase: string }>(`select phase from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`)).rows[0].phase).toBe("contract");
    expect((await db.query<{ phase: string }>(`select phase from read_consultation_board_view_v2('${ids.org}','${ids.board}',array['${ids.item}'::uuid])`)).rows[0].phase).toBe("contract");
    expect((await db.query<Record<string, unknown>>(`select * from consultation_states where item_id='${ids.item}'`)).rows[0]).toEqual(archived);
  });

});
