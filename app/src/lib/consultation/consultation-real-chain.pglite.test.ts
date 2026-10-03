import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGliteWorkerLockBroker, workerWebLocksBootstrapSource } from "../assignment-lineage/pglite-worker-locks.test-support";

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
const full161 = readFileSync(resolve(process.cwd(), "../supabase/migrations/161_consultation_seal_handoff.sql"), "utf8");
const body161 = full161.slice(full161.indexOf("alter table public.consultation_requests"));
const body156 = full156.slice(full156.indexOf("alter table public.consultation_states add column phase"));
// ★ #830: 167 본문(가드 호출 제외). 기본 setup 은 운영과 같이 167 까지 올린다.
const full167 = readFileSync(resolve(process.cwd(), "../supabase/migrations/167_consultation_two_stage_contract.sql"), "utf8");
const body167 = full167.slice(full167.indexOf("alter table public.consultation_states drop constraint consultation_phase_valid"));
const body168 = readFileSync(resolve(process.cwd(), "../supabase/migrations/168_consultation_handoff_safety.sql"), "utf8");

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
const workerDatabases: PGliteWorker[] = [];
const workerLockBroker = new PGliteWorkerLockBroker();
afterAll(async () => {
  await Promise.all(workerDatabases.splice(0).map((db) => db.close()));
  await sharedDb?.close();
});

function asWebWorker(nodeWorker: NodeWorker, isLockMessage: (value: unknown) => boolean): Worker {
  const listeners = new Map<EventListenerOrEventListenerObject, (data: unknown) => void>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      if (type !== "message") return;
      const callback = (data: unknown) => {
        if (isLockMessage(data)) return;
        if (typeof listener === "function") listener({ data } as MessageEvent);
        else listener.handleEvent({ data } as MessageEvent);
        if (typeof options === "object" && options.once) nodeWorker.off("message", callback);
      };
      listeners.set(listener, callback);
      nodeWorker.on("message", callback);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== "message") return;
      const callback = listeners.get(listener);
      if (callback) nodeWorker.off("message", callback);
      listeners.delete(listener);
    },
    postMessage(data: unknown) { nodeWorker.postMessage(data); },
    terminate() { void nodeWorker.terminate(); },
  } as unknown as Worker;
}

async function sharedWorkerClient(databaseId: string) {
  workerLockBroker.installClient();
  const require = createRequire(import.meta.url);
  const pgliteUrl = pathToFileURL(require.resolve("@electric-sql/pglite")).href;
  const workerUrl = pathToFileURL(require.resolve("@electric-sql/pglite/worker")).href;
  const source = `
    const { parentPort } = require("node:worker_threads");
    ${workerWebLocksBootstrapSource()}
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    globalThis.addEventListener = (type, listener, options) => {
      if (type !== "message") return;
      const callback = (data) => {
        listener({ data });
        if (options && options.once) parentPort.off("message", callback);
      };
      parentPort.on("message", callback);
    };
    void (async () => {
      const [{ worker }, { PGlite }] = await Promise.all([
        import(${JSON.stringify(workerUrl)}), import(${JSON.stringify(pgliteUrl)})
      ]);
      await worker({ init: (options) => new PGlite(options.dataDir || "memory://") });
    })();
  `;
  const nodeWorker = new NodeWorker(source, { eval: true, stderr: true });
  nodeWorker.stderr?.resume();
  const lockBridge = workerLockBroker.connectWorker(nodeWorker);
  nodeWorker.once("exit", () => lockBridge.dispose());
  const client = await PGliteWorker.create(asWebWorker(nodeWorker, lockBridge.isProtocolMessage), { id: databaseId });
  workerDatabases.push(client);
  return client;
}

it("work-board audit remains readable through real151 RLS, never writable or visible to another assignee",async()=>{
  const db=await setup(); await asUser(db,ids.owner);
  const version=await readyContract(db,ids.item,"work-feed");
  await db.exec(`update boards set source='core.default-tab/contract-work' where id='${ids.board}';
    update deals set stage_id='${ids.work}' where id='${ids.deal}';
    grant usage on schema auth to authenticated;
    grant select on items to authenticated;
    set role authenticated;`);
  try {
    await asUser(db,ids.assignee);
    expect((await db.query(`select * from consultation_events where org_id='${ids.org}' and item_id='${ids.item}'`)).rows).toHaveLength(1);
    await expect(db.query(`delete from consultation_events where item_id='${ids.item}'`)).rejects.toMatchObject({code:"42501"});
    await expect(check(db,ids.item,"work-feed-edit","deposit_confirmed",false,version)).rejects.toThrow();
    await asUser(db,ids.stranger);
    expect((await db.query(`select * from consultation_events where org_id='${ids.org}' and item_id='${ids.item}'`)).rows).toHaveLength(0);
  } finally { await db.exec("reset role"); }
  expect((await db.query(`select count(*)::int n from consultation_events where item_id='${ids.item}'`)).rows[0]).toEqual({n:1});
});

type DatabaseClient = Pick<PGlite, "exec" | "query">;

async function initialize(db: DatabaseClient, withWorkflow = true, twoStage = withWorkflow): Promise<void> {
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
    create table public.migration_apply_guard(logical_key text primary key);
    create function public.begin_guarded_migration(
      p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
      p_executor text,p_thread_id text,p_foundation boolean
    ) returns void language plpgsql as $$begin
      insert into public.migration_apply_guard values(p_logical_key)
      on conflict(logical_key) do nothing;
    end$$;
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
    create table public.board_columns(
      id uuid primary key default gen_random_uuid(), org_id uuid, board_id uuid,
      key text, archived_at timestamptz, unique(board_id, key)
    );
    create table public.items(id uuid primary key, org_id uuid, board_id uuid, title text,
      assigned_to uuid, deal_id uuid, deleted_at timestamptz, archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, primary key(item_id, column_key));
  `);
  await db.exec(`
    grant select, insert, update, delete on public.orgs, public.users, public.org_members,
      public.pipelines, public.stages, public.companies, public.deals, public.activities,
      public.boards, public.board_columns, public.items, public.item_values, public.departments,
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
  if (withWorkflow) { await db.exec(body156); await db.exec(body161); }
  if (twoStage) { await db.exec(body167); await db.exec(body168); }
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
    insert into board_columns(org_id,board_id,key,archived_at)
      values ('${ids.org}','${ids.board}','contract_fee_status',null);
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
}

async function setup(withWorkflow = true, twoStage = withWorkflow): Promise<PGlite> {
  await initialize(sharedDb, withWorkflow, twoStage);
  return sharedDb;
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

/** 167 계약금 칸 — 일반 보드 칸이라 item_values 에 그대로 쓴다. */
async function setFee(db: PGlite, itemId: string, value: string | null) {
  if (value === null) {
    await db.exec(`delete from item_values where item_id='${itemId}' and column_key='contract_fee_status'`);
    return;
  }
  await db.exec(`insert into item_values values ('${ids.org}','${itemId}','contract_fee_status','"${value}"')
    on conflict (item_id, column_key) do update set value_jsonb = excluded.value_jsonb`);
}

/** 167: 단계 «계약 진행» 저장(상담행 생성) + 1단계 계약금 완. 반환 = 현재 버전. */
async function readyContract(db: PGlite, itemId: string, tag: string): Promise<number> {
  const current = Number((await db.query<{ version: number }>(
    `select version from read_consultation_snapshot('${ids.org}','${itemId}')`)).rows[0]!.version);
  const r = await db.query<{ version: number }>(
    "select version from execute_consultation_workflow($1,$2,$3,$4,'remote','contract',null,null,false)",
    [ids.org, itemId, req(tag), current]);
  await setFee(db, itemId, "계약금 완");
  return Number(r.rows[0]!.version);
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
    await readyContract(db, ids.item, "seal01");
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
    await readyContract(db, ids.item, "seal02");
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
    await readyContract(db, ids.item, "rcpt01");
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
    await readyContract(db, ids.item, "rcpt02");
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
    // 151 check 의미(167 에서 퇴역) — 161 까지의 역사 체인에서 확인한다.
    const db = await setup(true, false);
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
    // 151 check 의미(167 에서 퇴역) — 161 까지의 역사 체인에서 확인한다.
    const db = await setup(true, false);
    await asUser(db, ids.assignee);
    await check(db, ids.item, "ord02", "contract_sent", true, 0);
    await db.exec(`update items set assigned_to = '${ids.stranger}' where id = '${ids.item}'`);
    await expect(check(db, ids.item, "ord02", "contract_sent", true, 0)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("P1-순서: 인증된 replay는 CAS/상태 전제조건보다 먼저 답한다", async () => {
    // 151 check 의미(167 에서 퇴역) — 161 까지의 역사 체인에서 확인한다.
    const db = await setup(true, false);
    await asUser(db, ids.assignee);
    const first = await check(db, ids.item, "ord03", "contract_sent", true, 0);
    expect(first.rows[0]).toMatchObject({ version: 1, replayed: false });
    const replay = await check(db, ids.item, "ord03", "contract_sent", true, 0);
    expect(replay.rows[0]).toMatchObject({ version: 1, replayed: true });
  });

  it("P1-순서: 인계 replay도 권한 뒤에 읽힌다(박탈 후 42501, 쓰기 없음)", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await readyContract(db, ids.item, "ord04");
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
    // 151 check 의미(167 에서 퇴역) — 161 까지의 역사 체인에서 확인한다.
    const db = await setup(true, false);
    await asUser(db, ids.teamLead);
    const r = await check(db, ids.itemDept, "dept01", "contract_sent", true, 0);
    expect(r.rows[0]).toMatchObject({ version: 1, replayed: false });
    const snap = await db.query(
      `select * from read_consultation_snapshot('${ids.org}','${ids.itemDept}')`,
    );
    expect(snap.rows).toHaveLength(1);
  });

  it("P2-부서: 팀리드 인계는 체인 계약으로 거부되고 아무것도 쓰지 않는다", async () => {
    // 151 check 의미(167 에서 퇴역) — 161 까지의 역사 체인에서 확인한다.
    const db = await setup(true, false);
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
    await readyContract(db, ids.item, "edge01");
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
    await readyContract(db, ids.item, "edge02");
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

  it("156 mode transfer/cancel keeps IDs and actual 151 handoff stays blocked until 계약금 완 (167)", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await workflow(db,"156inperson",0,"meeting_scheduled","inperson","2026-10-02T10:00Z");
    await workflow(db,"156cancelinperson",1,"cancelled","inperson",null,true);
    expect((await handoff(db,ids.item,ids.deal,"156blocked")).rows[0].status).toBe("blocked");
    await workflow(db,"156contract",2,"contract","inperson");
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    expect((await handoff(db,ids.item,ids.deal,"156nofee")).rows[0]).toMatchObject({status:"blocked",reason:"인계 조건이 남았습니다: 계약금 입금 확인"});
    await setFee(db,ids.item,"계약금 완");
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


describe("160 explicit pipeline repair retains the real 151→087→069 gate", () => {
  async function brokenLead() {
    const db = await setup();
    await asUser(db, ids.owner);
    await db.exec(`alter table pipelines add column name text default '기본 파이프라인';
      alter table stages add column name text; alter table stages add column sort_order int default 0;
      alter table stages alter column id set default gen_random_uuid();
      create type public.stage_kind as enum ('marketing','meeting','work');
      update boards set source='core.default-tab/new-lead';
      update stages set kind='marketing' where id='${ids.meeting}';
      delete from stages where id='${ids.work}';`);
    const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/160_new_lead_pipeline_structure.sql"), "utf8");
    await db.exec(migration.slice(migration.indexOf("create or replace function public.repair_new_lead_pipeline_structure(")));
    return db;
  }
  const repair = (apply = false, pipeline = ids.pipeline, missing = "array['meeting','work']") =>
    `select * from repair_new_lead_pipeline_structure('${ids.org}','${ids.item}',${apply},'${pipeline}',${missing})`;
  const advance = (request: string) => `select * from execute_contact_pipeline_transition('${ids.org}','${ids.deal}',null,'${req(request)}','lead_to_contact')`;

  it("reproduces blocked marketing-only pipeline; preview is read-only; explicit repair and same request retry preserve IDs", async () => {
    const db = await brokenLead();
    expect((await db.query<Record<string, unknown>>(advance("160-retry"))).rows[0]).toMatchObject({status:"blocked",reason:"현재 단계에서는 이 관문을 넘을 수 없습니다."});
    expect((await db.query<Record<string, unknown>>(repair())).rows[0]).toMatchObject({pipeline_id:ids.pipeline,missing_kinds:["meeting","work"],added_kinds:[]});
    expect((await db.query<Record<string, unknown>>("select count(*)::int n from stages")).rows[0].n).toBe(1);
    expect((await db.query<Record<string, unknown>>(repair(true))).rows[0]).toMatchObject({missing_kinds:[],added_kinds:["meeting","work"]});
    expect((await db.query<Record<string, unknown>>(repair(true))).rows[0]).toMatchObject({added_kinds:[]});
    const result = (await db.query<Record<string, unknown>>(advance("160-retry"))).rows[0];
    expect(result).toMatchObject({status:"committed",deal_id:ids.deal,company_id:null});
    expect((await db.query<Record<string, unknown>>(advance("160-retry"))).rows[0]).toEqual(result);
    expect((await db.query<Record<string, unknown>>(`select pipeline_id,company_id from deals where id='${ids.deal}'`)).rows[0]).toEqual({pipeline_id:ids.pipeline,company_id:null});
    expect((await db.query<Record<string, unknown>>(`select deal_id from items where id='${ids.item}'`)).rows[0].deal_id).toBe(ids.deal);
    expect((await db.query<Record<string, unknown>>("select kind,count(*)::int n from stages group by kind order by kind")).rows).toEqual([{kind:"marketing",n:1},{kind:"meeting",n:1},{kind:"work",n:1}]);
  });
  it("denies member, other tenant and revoked current permission without stage writes", async () => {
    const db = await brokenLead();
    await asUser(db, ids.assignee);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"42501"});
    await asUser(db, ids.owner);
    await expect(db.query<Record<string, unknown>>(repair(true).replace(ids.org, ids.stranger))).rejects.toMatchObject({code:"42501"});
    await db.exec(`insert into test_permission_deny values('${ids.org}','${ids.owner}','work.item_upsert')`);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"42501"});
    expect((await db.query<Record<string, unknown>>("select count(*)::int n from stages")).rows[0].n).toBe(1);
    await expect(db.query<Record<string, unknown>>(advance("160-denied"))).rejects.toMatchObject({code:"42501"});
  });
  it("rejects duplicate kinds and changed preview target or missing set without mutation", async () => {
    const db = await brokenLead();
    await expect(db.query<Record<string, unknown>>(repair(true, ids.work))).rejects.toMatchObject({code:"40001"});
    await expect(db.query<Record<string, unknown>>(repair(true, ids.pipeline, "array['meeting']"))).rejects.toMatchObject({code:"40001"});
    await db.exec(`insert into stages(pipeline_id,kind) values('${ids.pipeline}','marketing')`);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"22023"});
    expect((await db.query<Record<string, unknown>>("select count(*)::int n from stages")).rows[0].n).toBe(2);
    expect((await db.query<Record<string, unknown>>(advance("160-duplicate"))).rows[0].status).toBe("blocked");
  });
  it("adds only the missing kind, preserves custom stage names and blocks archived rows", async () => {
    const db = await brokenLead();
    await db.exec(`insert into stages(pipeline_id,kind,name,sort_order) values('${ids.pipeline}','meeting','맞춤 상담',9)`);
    await db.query<Record<string, unknown>>(repair(true, ids.pipeline, "array['work']"));
    expect((await db.query<Record<string, unknown>>("select name,sort_order from stages where kind='meeting'")).rows[0]).toEqual({name:"맞춤 상담",sort_order:9});
    await db.exec(`update items set archived_at=now() where id='${ids.item}'`);
    await expect(db.query<Record<string, unknown>>(repair())).rejects.toMatchObject({code:"22023"});
  });
  it("inactive org, inactive admin and deleted/mismatched source rows remain denied", async () => {
    const db = await brokenLead();
    await db.exec(`update orgs set status='inactive'`);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"42501"});
    await db.exec(`update orgs set status='active'; update org_members set status='inactive' where user_id='${ids.owner}'`);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"42501"});
    await db.exec(`update org_members set status='active'; update items set deleted_at=now() where id='${ids.item}'`);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"22023"});
    await db.exec(`update items set deleted_at=null; update boards set source='custom'`);
    await expect(db.query<Record<string, unknown>>(repair(true))).rejects.toMatchObject({code:"22023"});
    expect((await db.query<Record<string, unknown>>("select count(*)::int n from stages")).rows[0].n).toBe(1);
  });
  it("RPC is unavailable to anon/service_role and leaves the protected contract handoff enforced", async () => {
    const db = await brokenLead();
    const signature = 'public.repair_new_lead_pipeline_structure(uuid,uuid,boolean,uuid,text[])';
    expect((await db.query<Record<string, unknown>>(`select has_function_privilege('anon','${signature}','execute') a,has_function_privilege('service_role','${signature}','execute') s`)).rows[0]).toEqual({a:false,s:false});
    await db.query<Record<string, unknown>>(repair(true)); await db.query<Record<string, unknown>>(advance("160-to-contact"));
    await db.exec(`update boards set source='core.default-tab/contact'; update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    await db.query("select * from execute_consultation_workflow($1,$2,$3,0,'remote','contract',null,null,false)",[ids.org,ids.item,req("160-partial")]);
    const result = await handoff(db,ids.item,ids.deal,"160-no-bypass");
    expect(result.rows[0].status).toBe("blocked");
    expect(result.rows[0].reason).toMatch(/계약|확인/);
  });
});


describe("161 seal approval and protected handoff", () => {
  async function submit(db: PGlite, operation: string, version: number, tag: string, item = ids.item) {
    return db.query<{version:number;replayed:boolean;deal_id:string;company_id:string}>(
      "select * from execute_consultation_seal_handoff($1,$2,$3,$4,$5,$6)",
      [ids.org,item,req(tag),version,operation,"테스트 회사"]);
  }
  it("owner approves both canonical and mirror once, intent and protected pipeline commit atomically", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.item,"161-ok");
    await db.exec(`delete from item_values where item_id='${ids.item}' and column_key in ('work_move','seal_status');`);
    const controls=await db.query<{can_approve_seal:boolean;ready:boolean}>(`select * from read_consultation_handoff_controls('${ids.org}','${ids.item}')`);
    expect(controls.rows[0]).toMatchObject({can_approve_seal:true,ready:false});
    expect((await submit(db,"seal_approval",version,"161-seal")).rows[0].version).toBe(version+1);
    expect((await submit(db,"seal_approval",version,"161-seal")).rows[0].replayed).toBe(true);
    expect((await db.query<{n:number}>("select count(*)::int n from consultation_events where kind='seal_approved'")).rows[0].n).toBe(1);
    expect((await db.query<{seal:string}>(`select custom->>'seal_approval' seal from deals where id='${ids.deal}'`)).rows[0].seal).toBe("완료");
    expect((await db.query<{ready:boolean}>(`select ready from read_consultation_handoff_controls('${ids.org}','${ids.item}')`)).rows[0].ready).toBe(true);
    const result=await submit(db,"handoff",version+1,"161-handoff");
    expect(result.rows[0].deal_id).toBe(ids.deal); expect(result.rows[0].company_id).toBeTruthy();
    expect((await db.query<{stage_id:string}>(`select stage_id from deals where id='${ids.deal}'`)).rows[0].stage_id).toBe(ids.work);
    expect((await submit(db,"handoff",version+1,"161-handoff")).rows[0].replayed).toBe(true);
  });
  it.each(["member","team_lead"])("%s including all-scope cannot approve, assigned member may handoff only after approval", async (role) => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.item,"161-role-"+role);
    await db.exec(`update org_members set role='${role}',scope='all' where user_id='${ids.assignee}'`);
    await asUser(db,ids.assignee);
    expect((await db.query<{can_approve_seal:boolean}>(`select can_approve_seal from read_consultation_handoff_controls('${ids.org}','${ids.item}')`)).rows[0].can_approve_seal).toBe(false);
    await expect(submit(db,"seal_approval",version,"161-deny-"+role)).rejects.toThrow(/permission denied/);
    await expect(submit(db,"handoff",version,"161-before-"+role)).rejects.toThrow(/직인/);
    await asUser(db,ids.owner); await submit(db,"seal_approval",version,"161-admin-"+role);
    await asUser(db,ids.assignee); expect((await submit(db,"handoff",version+1,"161-member-go-"+role)).rows[0].deal_id).toBe(ids.deal);
  });
  it("blocks revoked role, null auth, org inactive, archived item, feature denial and stale CAS", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.item,"161-denials");
    await expect(submit(db,"seal_approval",version-1,"161-stale")).rejects.toThrow(/version conflict/);
    await db.exec(`select set_config('app.uid','',false)`);
    await expect(submit(db,"seal_approval",version,"161-noauth")).rejects.toThrow(/authentication/);
    await asUser(db,ids.owner);
    for (const perm of ["work.view_tabs","work.item_upsert"]) {
      await db.exec(`insert into test_permission_deny values('${ids.org}','${ids.owner}','${perm}')`);
      await expect(submit(db,"seal_approval",version,"161-feature-"+perm)).rejects.toThrow(/permission/);
      await db.exec("delete from test_permission_deny");
    }
    await db.exec("update orgs set status='inactive'");
    await expect(submit(db,"seal_approval",version,"161-org")).rejects.toThrow(/permission/);
    await db.exec("update orgs set status='active'");
    await db.exec(`update items set archived_at=now() where id='${ids.item}'`);
    await expect(submit(db,"seal_approval",version,"161-archived")).rejects.toThrow(/unavailable/);
    await db.exec(`update items set archived_at=null where id='${ids.item}'`);
    await submit(db,"seal_approval",version,"161-revoked");
    await db.exec(`update org_members set role='member',scope='all' where user_id='${ids.owner}'`);
    await expect(submit(db,"seal_approval",version,"161-revoked")).rejects.toThrow(/permission/);
  });
  it("rejects missing contract fee, foreign tenant/association and request reuse", async () => {
    const db=await setup(); await asUser(db,ids.owner);
    await db.query("select * from execute_consultation_workflow($1,$2,$3,0,'remote','contract',null,null,false)",[ids.org,ids.item,req("161-first")]);
    await expect(submit(db,"seal_approval",1,"161-incomplete")).rejects.toThrow(/contract fee required/);
    await db.exec(`update consultation_states set deal_id='${ids.dealDept}' where item_id='${ids.item}'`);
    await expect(submit(db,"seal_approval",1,"161-link")).rejects.toThrow(/association/);
    await db.exec(`update consultation_states set deal_id='${ids.deal}' where item_id='${ids.item}'`);
    await db.exec(`insert into orgs values('00000000-0000-4000-8000-000000000099'); update items set org_id='00000000-0000-4000-8000-000000000099' where id='${ids.itemNull}'`);
    await expect(submit(db,"seal_approval",1,"161-tenant",ids.itemNull)).rejects.toThrow(/unavailable/);
    await expect(submit(db,"seal_approval",1,"161-first")).rejects.toThrow(/key reuse/);
  });
  it("blocked downstream handoff rolls back intent and receipt; authenticated has RPC only", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.item,"161-rollback");
    await submit(db,"seal_approval",version,"161-rb-seal");
    await db.exec(`delete from item_values where item_id='${ids.item}' and column_key='work_move'; delete from stages where id='${ids.work}'`);
    await expect(submit(db,"handoff",version+1,"161-rb-go")).rejects.toThrow();
    expect((await db.query<{n:number}>(`select count(*)::int n from item_values where item_id='${ids.item}' and column_key='work_move'`)).rows[0].n).toBe(0);
    expect((await db.query<{n:number}>(`select count(*)::int n from consultation_requests where request_id='${req("161-rb-go")}'`)).rows[0].n).toBe(0);
    const acl=await db.query<{anon:boolean;service:boolean;auth:boolean}>(`select has_function_privilege('anon','public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text)','execute') anon,has_function_privilege('service_role','public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text)','execute') service,has_function_privilege('authenticated','public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text)','execute') auth`);
    expect(acl.rows[0]).toEqual({anon:false,service:false,auth:true});
  });
  it("admin uses the existing approver role; handoff replay rechecks current row scope and active membership", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.item,"161-scope");
    await db.exec(`update org_members set role='admin' where user_id='${ids.owner}'`);
    await submit(db,"seal_approval",version,"161-admin-ok");
    await asUser(db,ids.stranger);
    await expect(submit(db,"handoff",version+1,"161-stranger")).rejects.toMatchObject({code:"42501"});
    await expect(db.query(`select * from read_consultation_handoff_controls('${ids.org}','${ids.item}')`)).rejects.toMatchObject({code:"42501"});
    await asUser(db,ids.assignee); await submit(db,"handoff",version+1,"161-assignee-ok");
    await db.exec(`update deals set assigned_to='${ids.stranger}' where id='${ids.deal}'; update items set assigned_to='${ids.stranger}' where id='${ids.item}'`);
    await expect(submit(db,"handoff",version+1,"161-assignee-ok")).rejects.toMatchObject({code:"42501"});
    await db.exec(`update deals set assigned_to='${ids.assignee}' where id='${ids.deal}'; update items set assigned_to='${ids.assignee}' where id='${ids.item}'; update org_members set status='inactive' where user_id='${ids.assignee}'`);
    await expect(submit(db,"handoff",version+1,"161-assignee-ok")).rejects.toMatchObject({code:"42501"});
  });
  it("mismatched pipeline and stage cannot receive a canonical approval", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.item,"161-pipeline");
    await db.exec(`insert into pipelines values('${ids.stranger}','${ids.org}'); update stages set pipeline_id='${ids.stranger}' where id='${ids.meeting}'`);
    await expect(submit(db,"seal_approval",version,"161-bad-pipeline")).rejects.toThrow(/association/);
    expect((await db.query<{n:number}>("select count(*)::int n from consultation_events where kind='seal_approved'")).rows[0].n).toBe(0);
  });

  it("department visibility does not promise handoff permission; current item AND deal assignee must match", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.itemDept,"161-dept-ready");
    await submit(db,"seal_approval",version,"161-dept-seal",ids.itemDept);
    const read=()=>db.query<{ready:boolean;can_approve_seal:boolean;missing:string[]}>(`select * from read_consultation_handoff_controls('${ids.org}','${ids.itemDept}')`);
    await asUser(db,ids.teamLead);
    expect((await read()).rows[0]).toMatchObject({ready:false,can_approve_seal:false,missing:["인계 담당자 권한"]});
    await expect(submit(db,"handoff",version+1,"161-dept-deny",ids.itemDept)).rejects.toMatchObject({code:"42501"});
    await asUser(db,ids.deptMember); expect((await read()).rows[0].ready).toBe(true);
    await db.exec(`update deals set assigned_to='${ids.teamLead}' where id='${ids.dealDept}'`);
    expect((await read()).rows[0].ready).toBe(false);
    await asUser(db,ids.owner); expect((await read()).rows[0].ready).toBe(true);
  });

  it("a prior handoff receipt cannot bypass current write scope through department visibility", async () => {
    const db=await setup(); await asUser(db,ids.owner); const version=await readyContract(db,ids.itemDept,"161-dept-replay");
    await submit(db,"seal_approval",version,"161-dept-replay-seal",ids.itemDept);
    await asUser(db,ids.deptMember); await submit(db,"handoff",version+1,"161-dept-replay-go",ids.itemDept);
    await db.exec(`update org_members set role='team_lead',scope='department' where user_id='${ids.deptMember}'; update deals set assigned_to='${ids.teamLead}' where id='${ids.dealDept}'; update items set assigned_to='${ids.teamLead}' where id='${ids.itemDept}'`);
    expect((await db.query(`select * from read_consultation_snapshot('${ids.org}','${ids.itemDept}')`)).rows).toHaveLength(1);
    await expect(submit(db,"handoff",version+1,"161-dept-replay-go",ids.itemDept)).rejects.toMatchObject({code:"42501"});
  });

});

describe("167 two-stage contract (계약금 입금 확인 → 직인) + absent/deliberating", () => {
  const submit = (db: PGlite, operation: string, version: number, tag: string, item = ids.item) =>
    db.query<{ version: number; replayed: boolean; deal_id: string; company_id: string }>(
      "select * from execute_consultation_seal_handoff($1,$2,$3,$4,$5,$6)",
      [ids.org, item, req(tag), version, operation, "테스트 회사"]);
  const workflow = (db: PGlite, tag: string, version: number, phase: string, mode = "remote", meeting: string | null = null) =>
    db.query<{ version: number }>("select * from execute_consultation_workflow($1,$2,$3,$4,$5,$6,$7,$8,false)",
      [ids.org, ids.item, req(tag), version, mode, phase, meeting, ids.assignee]);
  const state = async (db: PGlite) => (await db.query<{ phase: string; absent_from_phase: string | null; version: number }>(
    `select phase, absent_from_phase, version from consultation_states where item_id='${ids.item}'`)).rows[0]!;
  const count = async (db: PGlite, sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;

  it("seal approval needs 계약금 완 first and writes nothing without it; with it the seal and handoff commit", async () => {
    const db = await setup(); await asUser(db, ids.owner);
    const version = await readyContract(db, ids.item, "167-ok");
    await setFee(db, ids.item, "계약금 미");
    await expect(submit(db, "seal_approval", version, "167-nofee")).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/contract fee required/) });
    expect(await count(db, `select count(*)::int n from consultation_requests where request_id='${req("167-nofee")}'`)).toBe(0);
    expect(await count(db, "select count(*)::int n from consultation_events where kind='seal_approved'")).toBe(0);
    expect((await db.query<{ custom: object }>(`select custom from deals where id='${ids.deal}'`)).rows[0]!.custom).toEqual({});
    expect((await state(db)).version).toBe(version);
    await setFee(db, ids.item, "계약금 완");
    expect((await submit(db, "seal_approval", version, "167-seal")).rows[0]!.version).toBe(version + 1);
    const done = await submit(db, "handoff", version + 1, "167-go");
    expect(done.rows[0]!.deal_id).toBe(ids.deal);
    expect((await db.query<{ stage_id: string }>(`select stage_id from deals where id='${ids.deal}'`)).rows[0]!.stage_id).toBe(ids.work);
  });

  it("handoff still requires the seal even when 계약금 완", async () => {
    const db = await setup(); await asUser(db, ids.owner);
    const version = await readyContract(db, ids.item, "167-noseal");
    await expect(submit(db, "handoff", version, "167-noseal-go")).rejects.toThrow(/직인/);
    expect((await db.query<{ stage_id: string }>(`select stage_id from deals where id='${ids.deal}'`)).rows[0]!.stage_id).toBe(ids.meeting);
    expect(await count(db, "select count(*)::int n from contact_pipeline_transitions")).toBe(0);
  });

  it("fee back to 계약금 미 after the seal blocks both the protected handoff and the 069 work_move path", async () => {
    const db = await setup(); await asUser(db, ids.owner);
    const version = await readyContract(db, ids.item, "167-revert");
    await submit(db, "seal_approval", version, "167-revert-seal");
    await setFee(db, ids.item, "계약금 미");
    const controls = (await db.query<{ ready: boolean }>(`select ready from read_consultation_handoff_controls('${ids.org}','${ids.item}')`)).rows[0]!;
    expect(controls.ready).toBe(false);
    await expect(submit(db, "handoff", version + 1, "167-revert-go")).rejects.toThrow(/contract fee required/);
    const direct = await handoff(db, ids.item, ids.deal, "167-revert-069");
    expect(direct.rows[0]).toMatchObject({ status: "blocked", reason: "인계 조건이 남았습니다: 계약금 입금 확인" });
    expect((await db.query<{ stage_id: string; company_id: string | null }>(`select stage_id, company_id from deals where id='${ids.deal}'`)).rows[0])
      .toEqual({ stage_id: ids.meeting, company_id: null });
  });

  it("an empty checklist is ready once 계약금 완 + seal + work_move; readiness reports only the fee as missing", async () => {
    const db = await setup(); await asUser(db, ids.owner);
    await readyContract(db, ids.item, "167-empty");
    await setFee(db, ids.item, null);
    const before = (await db.query<{ ready: boolean; missing: string[] }>(`select ready, missing from read_consultation_snapshot('${ids.org}','${ids.item}')`)).rows[0];
    expect(before).toEqual({ ready: false, missing: ["계약금 입금 확인"] });
    await setFee(db, ids.item, "계약금 완");
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    const snap = (await db.query<{ ready: boolean; missing: string[]; checklist: Record<string, { confirmed: boolean }> }>(
      `select ready, missing, checklist from read_consultation_snapshot('${ids.org}','${ids.item}')`)).rows[0]!;
    expect(snap).toMatchObject({ ready: true, missing: [] });
    expect(Object.values(snap.checklist).some((step) => step.confirmed)).toBe(false);
    const board = (await db.query<{ ready: boolean; missing: string[] }>(`select ready, missing from read_consultation_board_view('${ids.org}','${ids.board}',array['${ids.item}'::uuid])`)).rows[0];
    expect(board).toEqual({ ready: true, missing: [] });
  });

  it("absent stores, keeps and clears its origin phase without a schedule; deliberating needs no schedule", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await workflow(db, "167-sched", 0, "scheduled", "remote", "2026-10-02T10:00Z");
    await workflow(db, "167-absent", 1, "absent", "remote", "2026-10-02T10:00Z");
    expect(await state(db)).toMatchObject({ phase: "absent", absent_from_phase: "scheduled" });
    // 같은 부재로 다시 저장해도 처음 출발 단계를 유지한다(변화 없음 = 버전 그대로).
    expect((await workflow(db, "167-absent-again", 2, "absent", "remote", "2026-10-02T10:00Z")).rows[0]!.version).toBe(2);
    expect(await state(db)).toMatchObject({ absent_from_phase: "scheduled" });
    const history = (await db.query<{ history: { details: { after: { absentFromPhase?: string } } }[] }>(
      `select history from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`)).rows[0]!.history;
    expect(history[0]!.details.after.absentFromPhase).toBe("scheduled");
    await workflow(db, "167-consulting", 2, "consulting");
    expect(await state(db)).toMatchObject({ phase: "consulting", absent_from_phase: null });
    await workflow(db, "167-absent-noschedule", 3, "absent");
    expect(await state(db)).toMatchObject({ phase: "absent", absent_from_phase: "consulting" });
    // 151 mode 전환처럼 다른 경로로 부재를 떠나도 트리거가 출발 단계를 비운다.
    await db.query(`select * from execute_consultation_transition('${ids.org}','${ids.item}','${req("167-mode")}','mode',null,null,'inperson','2026-10-03T10:00Z','${ids.assignee}',4)`);
    expect(await state(db)).toMatchObject({ absent_from_phase: null });
    expect((await state(db)).phase).not.toBe("absent");
    await workflow(db, "167-deliberating", 5, "deliberating", "inperson");
    expect(await state(db)).toMatchObject({ phase: "deliberating", absent_from_phase: null });
    await expect(workflow(db, "167-absent-inperson", 6, "absent", "inperson")).rejects.toThrow(/phase unsupported/);
    await expect(workflow(db, "167-deliberating-remote", 6, "deliberating", "remote", "2026-10-03T10:00Z")).rejects.toThrow(/phase unsupported/);
  });

  it("CHECK accepts the new phases and rejects an origin outside absent or an unknown origin", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await workflow(db, "167-check", 0, "consulting");
    await db.exec(`alter table consultation_states disable trigger consultation_phase_compat;
      update consultation_states set phase='deliberating' where item_id='${ids.item}'`);
    await expect(db.exec(`update consultation_states set absent_from_phase='consulting' where item_id='${ids.item}'`)).rejects.toThrow(/consultation_absent_from_valid/);
    await expect(db.exec(`update consultation_states set phase='absent', absent_from_phase='absent' where item_id='${ids.item}'`)).rejects.toThrow(/consultation_absent_from_valid/);
    await expect(db.exec(`update consultation_states set phase='bogus' where item_id='${ids.item}'`)).rejects.toThrow(/consultation_phase_valid/);
    await db.exec(`update consultation_states set phase='absent', absent_from_phase='on_hold' where item_id='${ids.item}';
      alter table consultation_states enable trigger consultation_phase_compat;`);
    expect(await state(db)).toMatchObject({ phase: "absent", absent_from_phase: "on_hold" });
  });

  it("old 151 check is retired with 22023 and writes nothing; 151 mode still delegates", async () => {
    const db = await setup(); await asUser(db, ids.assignee);
    await expect(check(db, ids.item, "167-retired", "contract_sent", true, 0)).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/checklist retired/) });
    for (const table of ["consultation_states", "consultation_requests", "consultation_events"]) {
      expect(await count(db, `select count(*)::int n from ${table}`)).toBe(0);
    }
    const moved = await db.query<{ mode: string; version: number }>(`select mode, version from execute_consultation_transition('${ids.org}','${ids.item}','${req("167-mode-ok")}','mode',null,null,'inperson','2026-10-02T10:00Z','${ids.assignee}',0)`);
    expect(moved.rows[0]).toEqual({ mode: "inperson", version: 1 });
  });

  it("v2 readers expose the added columns and board seal_done follows canonical AND board seal", async () => {
    const db = await setup(); await asUser(db, ids.owner);
    await readyContract(db, ids.item, "167-v2");
    const snap = (await db.query<Record<string, unknown>>(`select absent_from_phase, contract_fee_status, contract_fee_ready from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`)).rows[0];
    expect(snap).toEqual({ absent_from_phase: null, contract_fee_status: "계약금 완", contract_fee_ready: true });
    const read = async () => (await db.query<Record<string, unknown>>(`select absent_from_phase, contract_fee_ready, seal_done from read_consultation_board_view_v2('${ids.org}','${ids.board}',array['${ids.item}'::uuid])`)).rows[0]!;
    expect(await read()).toEqual({ absent_from_phase: null, contract_fee_ready: true, seal_done: false });
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    expect((await read()).seal_done).toBe(true);
    // work_move 선택 여부와 무관하다(152 seal_approved 와 다름).
    await db.exec(`delete from item_values where item_id='${ids.item}' and column_key='work_move'`);
    expect((await read()).seal_done).toBe(true);
    await db.exec(`update item_values set value_jsonb='"대기"' where item_id='${ids.item}' and column_key='seal_status'`);
    expect((await read()).seal_done).toBe(false);
  });

  it("internal helpers and the preserved 151 body are not executable by client roles; wrapper keeps its grants", async () => {
    const db = await setup();
    const priv = async (role: string, signature: string) => (await db.query<{ ok: boolean }>(
      `select has_function_privilege('${role}','${signature}','execute') ok`)).rows[0]!.ok;
    for (const signature of [
      "public.consultation_contract_fee_ready(uuid,uuid)",
      "public.consultation_contract_missing(uuid,uuid)",
      "public.execute_consultation_transition_151(uuid,uuid,uuid,text,text,boolean,text,timestamptz,uuid,bigint)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) expect(await priv(role, signature)).toBe(false);
    }
    const wrapper = "public.execute_consultation_transition(uuid,uuid,uuid,text,text,boolean,text,timestamptz,uuid,bigint)";
    expect([await priv("anon", wrapper), await priv("service_role", wrapper), await priv("authenticated", wrapper)]).toEqual([false, false, true]);
    for (const signature of ["public.read_consultation_snapshot_v2(uuid,uuid)", "public.read_consultation_board_view_v2(uuid,uuid,uuid[],integer,integer)"]) {
      expect([await priv("anon", signature), await priv("service_role", signature), await priv("authenticated", signature)]).toEqual([false, false, true]);
    }
  });

  it("carry-over: deposit_confirmed → 계약금 완 once, archived rows skipped, state/events untouched, idempotent", async () => {
    const db = await setup(true, false); await asUser(db, ids.owner);
    await completeChecks(db, ids.item, "167-carry");
    await completeChecks(db, ids.itemNull, "167-carry-archived");
    await check(db, ids.itemDept, "167-carry-partial", "contract_sent", true, 0);
    await setFee(db, ids.item, "계약금 미");
    await db.exec(`update items set archived_at='2026-09-28T00:00:00Z' where id='${ids.itemNull}'`);
    const statesBefore = (await db.query<Record<string, unknown>>("select * from consultation_states order by item_id")).rows;
    const eventsBefore = await count(db, "select count(*)::int n from consultation_events");
    await db.exec(body167);
    const fee = async (item: string) => (await db.query<{ v: string }>(`select value_jsonb #>> '{}' v from item_values where item_id='${item}' and column_key='contract_fee_status'`)).rows[0]?.v ?? null;
    expect([await fee(ids.item), await fee(ids.itemNull), await fee(ids.itemDept)]).toEqual(["계약금 완", null, null]);
    expect((await db.query("select * from consultation_states order by item_id")).rows)
      .toEqual(statesBefore.map((row) => ({ ...row, absent_from_phase: null })));
    expect(await count(db, "select count(*)::int n from consultation_events")).toBe(eventsBefore);
    const carry = body167.slice(body167.indexOf("insert into public.item_values(org_id, item_id, column_key, value_jsonb)"));
    await db.exec(carry);
    expect(await count(db, "select count(*)::int n from item_values where column_key='contract_fee_status'")).toBe(1);
    // 이월된 행은 추가 체크 없이 바로 1단계 완료로 읽힌다.
    expect((await db.query<{ contract_fee_ready: boolean }>(`select contract_fee_ready from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`)).rows[0]!.contract_fee_ready).toBe(true);
  });

  it("carry-over stops before writing when an enabled messaging rule watches 계약금 완", async () => {
    const db = await setup(true, false); await asUser(db, ids.owner);
    await completeChecks(db, ids.item, "167-msg");
    await db.exec(`create table public.messaging_trigger_rules(org_id uuid, board_id uuid, column_key text, trigger_value text, enabled boolean);
      insert into public.messaging_trigger_rules values('${ids.org}','${ids.board}','contract_fee_status','계약금 완',true);`);
    await expect(db.exec(`begin; ${body167} commit;`)).rejects.toThrow(/carry-over blocked/);
    await db.exec("rollback");
    expect(await count(db, "select count(*)::int n from item_values where column_key='contract_fee_status'")).toBe(0);
    expect(await count(db, "select count(*)::int n from pg_proc where proname='consultation_contract_fee_ready'")).toBe(0);
  });
});

describe("168 consultation handoff safety", () => {
  const submit = (db: PGlite, operation: string, version: number, tag: string, item = ids.item) =>
    db.query<{ version: number; replayed: boolean; deal_id: string; company_id: string }>(
      "select * from execute_consultation_seal_handoff($1,$2,$3,$4,$5,$6)",
      [ids.org, item, req(tag), version, operation, "테스트 회사"],
    );

  it("상담 상태행이 없어도 069 인계가 계약금 공통 게이트를 건너뛰지 않는다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);

    const blocked = await handoff(db, ids.item, ids.deal, "168-no-state-blocked");
    expect(blocked.rows[0]).toMatchObject({
      status: "blocked",
      reason: "인계 조건이 남았습니다: 계약금 입금 확인",
    });
    expect((await db.query<{ stage_id: string; company_id: string | null }>(
      `select stage_id,company_id from deals where id='${ids.deal}'`,
    )).rows[0]).toEqual({ stage_id: ids.meeting, company_id: null });

    await setFee(db, ids.item, "계약금 완");
    const committed = await handoff(db, ids.item, ids.deal, "168-no-state-ready");
    expect(committed.rows[0]!.status).toBe("committed");
    expect((await db.query<{ stage_id: string }>(`select stage_id from deals where id='${ids.deal}'`)).rows[0]!.stage_id)
      .toBe(ids.work);
  });

  it("계약금 칸의 active·archived·absent 상태를 구분하고 보관/부재를 fail-closed 처리한다", async () => {
    const db = await setup();
    await asUser(db, ids.owner);
    const version = await readyContract(db, ids.item, "168-column-state");
    expect((await db.query<{ ready: boolean }>(
      `select contract_fee_ready ready from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`,
    )).rows[0]!.ready).toBe(true);

    await db.exec(`update board_columns set archived_at=now() where board_id='${ids.board}' and key='contract_fee_status'`);
    const archived = (await db.query<{ ready: boolean; missing: string[] }>(
      `select contract_fee_ready ready,missing from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`,
    )).rows[0]!;
    expect(archived.ready).toBe(false);
    expect(archived.missing).toContain("계약금 완료여부 칸 보관됨 — 보드 칸 관리에서 복원");
    await expect(submit(db, "seal_approval", version, "168-column-archived"))
      .rejects.toMatchObject({ code: "22023" });

    await db.exec(`delete from board_columns where board_id='${ids.board}' and key='contract_fee_status'`);
    const absent = (await db.query<{ ready: boolean; missing: string[] }>(
      `select contract_fee_ready ready,missing from read_consultation_snapshot_v2('${ids.org}','${ids.item}')`,
    )).rows[0]!;
    expect(absent.ready).toBe(false);
    expect(absent.missing).toContain("계약금 완료여부 칸 없음 — 보드 칸 관리에서 추가");
    await expect(submit(db, "seal_approval", version, "168-column-absent"))
      .rejects.toMatchObject({ code: "22023" });
    expect((await db.query<{ custom: object }>(`select custom from deals where id='${ids.deal}'`)).rows[0]!.custom).toEqual({});
    expect((await db.query<{ n: number }>("select count(*)::int n from consultation_events where kind='seal_approved'")).rows[0]!.n).toBe(0);
  });

  it("잠금 헬퍼는 client role에 공개되지 않고 기존 authenticated wrapper만 유지한다", async () => {
    const db = await setup();
    const signature = "public.consultation_contract_fee_ready_locked(uuid,uuid)";
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query<{ ok: boolean }>(
        `select has_function_privilege('${role}','${signature}','execute') ok`,
      )).rows[0]!.ok).toBe(false);
    }
    expect((await db.query<{ ok: boolean }>(
      "select has_function_privilege('authenticated','public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)','execute') ok",
    )).rows[0]!.ok).toBe(true);
  });

  it("두 client에서 인계와 계약금 되돌리기가 같은 값 잠금으로 직렬화된다", async () => {
    const databaseId = `issue833-${crypto.randomUUID()}`;
    const handoffClient = await sharedWorkerClient(databaseId);
    await initialize(handoffClient);
    const revertClient = await sharedWorkerClient(databaseId);
    await handoffClient.exec(`select set_config('app.uid','${ids.owner}',false)`);
    await revertClient.exec(`select set_config('app.uid','${ids.owner}',false)`);

    const workflow = await handoffClient.query<{ version: number }>(
      "select version from execute_consultation_workflow($1,$2,$3,$4,'remote','contract',null,null,false)",
      [ids.org, ids.item, req("168-race-workflow"), 0],
    );
    const version = Number(workflow.rows[0]!.version);
    await handoffClient.exec(`insert into item_values values ('${ids.org}','${ids.item}','contract_fee_status','"계약금 완"')
      on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb`);
    await handoffClient.query(
      "select * from execute_consultation_seal_handoff($1,$2,$3,$4,'seal_approval',$5)",
      [ids.org, ids.item, req("168-race-seal"), version, "테스트 회사"],
    );

    const definition = (await handoffClient.query<{ body: string }>(
      "select pg_get_functiondef('public.consultation_contract_fee_ready_locked(uuid,uuid)'::regprocedure) body",
    )).rows[0]!.body;
    expect(definition).toMatch(/for update of c/iu);
    expect(definition).toMatch(/for update of iv/iu);

    const [handoffAttempt, revertAttempt] = await Promise.allSettled([
      handoffClient.query<{ deal_id: string }>(
        "select deal_id from execute_consultation_seal_handoff($1,$2,$3,$4,'handoff',$5)",
        [ids.org, ids.item, req("168-race-handoff"), version + 1, "테스트 회사"],
      ),
      revertClient.query(
        "update item_values set value_jsonb='\"계약금 미\"' where item_id=$1 and column_key='contract_fee_status'",
        [ids.item],
      ),
    ]);
    expect(revertAttempt.status).toBe("fulfilled");
    const stage = (await handoffClient.query<{ stage_id: string }>(
      `select stage_id from deals where id='${ids.deal}'`,
    )).rows[0]!.stage_id;
    if (handoffAttempt.status === "fulfilled") {
      expect(handoffAttempt.value.rows[0]!.deal_id).toBe(ids.deal);
      expect(stage).toBe(ids.work);
    } else {
      expect(String(handoffAttempt.reason)).toMatch(/contract fee required/iu);
      expect(stage).toBe(ids.meeting);
    }
    expect((await handoffClient.query<{ fee: string }>(
      `select value_jsonb#>>'{}' fee from item_values where item_id='${ids.item}' and column_key='contract_fee_status'`,
    )).rows[0]!.fee).toBe("계약금 미");
  }, 30_000);
});
