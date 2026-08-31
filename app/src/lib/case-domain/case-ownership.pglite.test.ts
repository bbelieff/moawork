import { PGlite } from "@electric-sql/pglite";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { PGliteWorkerLockBroker, workerWebLocksBootstrapSource } from "@/lib/assignment-lineage/pglite-worker-locks.test-support";

const migration144 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/144_issue645_case_ownership_registry.sql"),
  "utf8",
);

const id = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  ownerA: "10000000-0000-4000-8000-000000000001",
  memberA: "10000000-0000-4000-8000-000000000002",
  otherA: "10000000-0000-4000-8000-000000000003",
  ownerB: "10000000-0000-4000-8000-000000000004",
  companyA: "20000000-0000-4000-8000-000000000001",
  mergedA: "20000000-0000-4000-8000-000000000002",
  companyB: "20000000-0000-4000-8000-000000000003",
  pipelineA: "30000000-0000-4000-8000-000000000001",
  pipelineB: "30000000-0000-4000-8000-000000000002",
  stageA: "40000000-0000-4000-8000-000000000001",
  stageA2: "40000000-0000-4000-8000-000000000002",
  stageB: "40000000-0000-4000-8000-000000000003",
  boardA: "50000000-0000-4000-8000-000000000001",
  groupA: "60000000-0000-4000-8000-000000000001",
  caseA: "70000000-0000-4000-8000-000000000001",
  caseOther: "70000000-0000-4000-8000-000000000002",
  caseLegacy: "70000000-0000-4000-8000-000000000003",
  caseCrossOrgCompany: "70000000-0000-4000-8000-000000000004",
  itemA: "80000000-0000-4000-8000-000000000001",
  itemOther: "80000000-0000-4000-8000-000000000002",
  itemCrossOrgCompany: "80000000-0000-4000-8000-000000000003",
} as const;

const request = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const schema = `
create schema extensions;
create function extensions.digest(p_value bytea,p_algorithm text) returns bytea language sql immutable
  as $$select decode(md5(convert_from(p_value,'utf8'))||md5(convert_from(p_value,'utf8')),'hex')$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable
  as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
create table public.migration_apply_guard(logical_key text primary key,file_name text,digest text,predecessor text);
create function public.begin_guarded_migration(
  p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
  p_executor text,p_thread_id text,p_foundation boolean
) returns void language plpgsql as $$begin
  insert into public.migration_apply_guard values(p_logical_key,p_file_name,p_file_digest,p_expected_predecessor);
end$$;
create table public.orgs(id uuid primary key,status text not null default 'active');
create table public.users(id uuid primary key,name text);
create table public.org_members(
  org_id uuid not null references public.orgs(id),user_id uuid not null references public.users(id),
  role text not null,scope text not null,status text not null default 'active',primary key(org_id,user_id)
);
create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer
  set search_path='' as $$select exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=auth.uid() and m.status='active')$$;
create function public.org_role(p_org uuid) returns text language sql stable security definer
  set search_path='' as $$select m.role from public.org_members m where m.org_id=p_org and m.user_id=auth.uid() and m.status='active'$$;
create function public.org_scope(p_org uuid) returns text language sql stable security definer
  set search_path='' as $$select m.scope from public.org_members m where m.org_id=p_org and m.user_id=auth.uid() and m.status='active'$$;
create function public.effective_permission(p_org uuid,p_key text) returns boolean language sql stable security definer
  set search_path='' as $$
    select exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id
      where m.org_id=p_org and m.user_id=auth.uid() and m.status='active' and o.status='active'
        and case
          when p_key='finance.ledger_manage' then m.role in ('owner','admin')
          when p_key='finance.ledger_read' then m.role in ('owner','admin','team_lead')
          else true
        end)
  $$;
create function public.perm_baseline() returns table(
  perm_group text,scope_key text,label text,is_danger boolean,
  allowed_owner boolean,allowed_admin boolean,allowed_team_lead boolean,allowed_member boolean
) language sql immutable as $$values('업무','work.view_tabs','탭 보기',false,true,true,true,true)$$;
create table public.companies(
  id uuid primary key,org_id uuid not null references public.orgs(id),name text not null,
  assigned_to uuid references public.users(id),merged_into uuid
);
create table public.pipelines(id uuid primary key,org_id uuid not null references public.orgs(id),name text not null);
create table public.stages(id uuid primary key,pipeline_id uuid not null references public.pipelines(id),name text not null,sort_order int not null default 0,kind text not null default 'lead');
create table public.deals(
  id uuid primary key,org_id uuid not null references public.orgs(id),company_id uuid references public.companies(id),
  pipeline_id uuid references public.pipelines(id),stage_id uuid references public.stages(id),assigned_to uuid references public.users(id),
  title text not null,amount numeric,status_note text,applied_on date,custom jsonb not null default '{}',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.activities(
  id uuid primary key default gen_random_uuid(),org_id uuid not null references public.orgs(id),
  deal_id uuid references public.deals(id),type text not null,content text,actor uuid references public.users(id),at timestamptz not null default now()
);
create table public.boards(id uuid primary key,org_id uuid not null,source text not null);
create table public.board_groups(id uuid primary key,org_id uuid not null,board_id uuid not null,sort_order int not null default 0);
create table public.items(
  id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null,group_id uuid,
  title text not null,assigned_to uuid,deal_id uuid,deleted_at timestamptz
);
create unique index items_active_deal_projection_uq on public.items(org_id,deal_id) where deal_id is not null and deleted_at is null;
create table public.company_work_start_requests(
  org_id uuid not null,request_id uuid not null,company_id uuid not null,actor_id uuid not null,
  deal_id uuid not null,item_id uuid not null,payload jsonb not null,created_at timestamptz default now(),
  primary key(org_id,request_id),unique(org_id,deal_id),unique(org_id,item_id)
);
create table public.audit_logs(id bigint generated always as identity,org_id uuid,actor uuid,action text,target_type text,target_id uuid,meta jsonb);
create table public.deal_document_checklists(
  org_id uuid not null references public.orgs(id),deal_id uuid not null references public.deals(id),
  product_id text,items_jsonb jsonb not null default '[]',updated_at timestamptz not null default now(),primary key(org_id,deal_id)
);
create table public.deal_ledger_entries(
  id uuid primary key default gen_random_uuid(),org_id uuid not null references public.orgs(id),
  deal_id uuid not null references public.deals(id),kind text not null,amount numeric not null default 1,
  received_amount numeric not null default 0,occurred_on date not null default current_date,paid_on date,
  attribution_month date not null default date_trunc('month',current_date)::date,created_by uuid not null references public.users(id),created_at timestamptz default now()
  ,vat_included boolean not null default false,tax_invoice_issued boolean not null default false
);
create function public.can_access_deal_ledger(p_deal_id uuid) returns boolean language sql stable security definer set search_path=''
  as $$select exists(select 1 from public.deals d where d.id=p_deal_id and public.is_org_member(d.org_id))$$;
create function public.start_company_work_v2(p_org_id uuid,p_company_id uuid,p_request_id uuid,p_group_id uuid default null)
returns table(deal_id uuid,item_id uuid,replayed boolean) language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_prior public.company_work_start_requests%rowtype;v_deal uuid;v_item uuid;v_company public.companies%rowtype;
begin
  select * into v_prior from public.company_work_start_requests where org_id=p_org_id and request_id=p_request_id;
  if found then return query select v_prior.deal_id,v_prior.item_id,true;return;end if;
  select * into v_company from public.companies where org_id=p_org_id and id=p_company_id and merged_into is null;
  if not found or not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'unavailable' using errcode='42501';end if;
  insert into public.deals(id,org_id,company_id,pipeline_id,stage_id,assigned_to,title)
    values(gen_random_uuid(),p_org_id,p_company_id,'${id.pipelineA}','${id.stageA}',coalesce(v_company.assigned_to,v_actor),v_company.name) returning id into v_deal;
  insert into public.items(org_id,board_id,group_id,title,assigned_to,deal_id)
    values(p_org_id,'${id.boardA}',coalesce(p_group_id,'${id.groupA}'),v_company.name,coalesce(v_company.assigned_to,v_actor),v_deal) returning id into v_item;
  insert into public.company_work_start_requests values(p_org_id,p_request_id,p_company_id,v_actor,v_deal,v_item,jsonb_build_object('company_id',p_company_id),now());
  return query select v_deal,v_item,false;
end$$;
alter table public.deals enable row level security;
alter table public.activities enable row level security;
alter table public.deal_document_checklists enable row level security;
alter table public.deal_ledger_entries enable row level security;
create policy deals_rw on public.deals for all to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create policy activities_rw on public.activities for all to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create policy deal_checklists_org on public.deal_document_checklists for all to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create policy deal_ledger_entries_select on public.deal_ledger_entries for select to authenticated using(public.can_access_deal_ledger(deal_id));
grant usage on schema public,auth to authenticated,anon,service_role;
grant execute on function auth.uid(),public.is_org_member(uuid),public.org_role(uuid),public.org_scope(uuid),public.effective_permission(uuid,text) to authenticated;
grant select,insert,update,delete on public.deals,public.activities,public.deal_document_checklists to authenticated;
grant select on public.items,public.companies,public.pipelines,public.stages,public.deal_ledger_entries to authenticated;
insert into public.orgs values('${id.orgA}','active'),('${id.orgB}','active');
insert into public.users(id,name) values
 ('${id.ownerA}','Owner A'),('${id.memberA}','Member A'),
 ('${id.otherA}','Other A'),('${id.ownerB}','Owner B');
insert into public.org_members values
 ('${id.orgA}','${id.ownerA}','owner','all','active'),
 ('${id.orgA}','${id.memberA}','member','assigned','active'),
 ('${id.orgA}','${id.otherA}','team_lead','all','active'),
 ('${id.orgB}','${id.ownerB}','owner','all','active');
insert into public.companies values
 ('${id.companyA}','${id.orgA}','A','${id.memberA}',null),
 ('${id.mergedA}','${id.orgA}','Merged','${id.memberA}','${id.companyA}'),
 ('${id.companyB}','${id.orgB}','B','${id.ownerB}',null);
insert into public.pipelines values('${id.pipelineA}','${id.orgA}','A'),('${id.pipelineB}','${id.orgB}','B');
insert into public.stages values('${id.stageA}','${id.pipelineA}','A1',0,'lead'),('${id.stageA2}','${id.pipelineA}','A2',1,'work'),('${id.stageB}','${id.pipelineB}','B1',0,'lead');
insert into public.boards values('${id.boardA}','${id.orgA}','core.default-tab/contract-work');
insert into public.board_groups values('${id.groupA}','${id.orgA}','${id.boardA}',0);
insert into public.deals(id,org_id,company_id,pipeline_id,stage_id,assigned_to,title) values
 ('${id.caseA}','${id.orgA}','${id.companyA}','${id.pipelineA}','${id.stageA}','${id.memberA}','Case A'),
 ('${id.caseOther}','${id.orgA}','${id.companyA}','${id.pipelineA}','${id.stageA}','${id.otherA}','Other'),
 ('${id.caseLegacy}','${id.orgA}',null,'${id.pipelineA}','${id.stageA}','${id.memberA}','Legacy null'),
 ('${id.caseCrossOrgCompany}','${id.orgA}','${id.companyB}','${id.pipelineA}','${id.stageA}','${id.memberA}','Legacy cross-org company');
insert into public.items(id,org_id,board_id,group_id,title,assigned_to,deal_id) values
 ('${id.itemA}','${id.orgA}','${id.boardA}','${id.groupA}','Case A','${id.memberA}','${id.caseA}'),
 ('${id.itemOther}','${id.orgA}','${id.boardA}','${id.groupA}','Other','${id.otherA}','${id.caseOther}'),
 ('${id.itemCrossOrgCompany}','${id.orgA}','${id.boardA}','${id.groupA}','Legacy cross-org company','${id.memberA}','${id.caseCrossOrgCompany}');
`;

let db: PGlite;
const workerDatabases: PGliteWorker[] = [];
const workerLockBroker = new PGliteWorkerLockBroker();

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
      const callback = (data) => { listener({ data }); if (options && options.once) parentPort.off("message", callback); };
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

async function asUser(userId: string, sql: string) {
  await db.exec(`reset role; select set_config('app.uid','${userId}',false); set role authenticated;`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

async function scalar<T>(sql: string): Promise<T> {
  const result = await db.query<Record<string, T>>(sql);
  return Object.values(result.rows[0])[0];
}

describe("Issue #646 canonical Case ownership migration", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(schema);
    await db.exec(migration144);
  });
  afterEach(async () => {
    await Promise.all(workerDatabases.splice(0).map((client) => client.close()));
    await db.close();
  });

  it("applies guarded frontier 144 without rewriting seeded customer rows", async () => {
    expect(await scalar<number>("select count(*)::int from migration_apply_guard where logical_key='144_issue645_case_ownership_registry' and predecessor='143_issue662_detail_event_kinds'")) .toBe(1);
    expect(await scalar<number>("select count(*)::int from companies")).toBe(3);
    expect(await scalar<number>("select count(*)::int from deals")).toBe(4);
    expect(await scalar<number>("select count(*)::int from items")).toBe(3);
    expect(await scalar<number>("select count(*)::int from case_option_registry")).toBe(13);
  });

  it("keeps the deployed legacy consumers alive after predeploy 144", async () => {
    const predeploy = new PGlite();
    try {
      await predeploy.exec(schema);
      await predeploy.exec(migration144);
      await predeploy.exec(`select set_config('app.uid','${id.memberA}',false); set role authenticated;`);
      await predeploy.exec(`update deals set stage_id='${id.stageA2}',pipeline_id='${id.pipelineA}' where id='${id.caseA}';`);
      await predeploy.exec(`insert into activities(org_id,deal_id,type,content,actor) values('${id.orgA}','${id.caseA}','memo','legacy','${id.memberA}');`);
      await predeploy.exec(`insert into deal_document_checklists(org_id,deal_id,items_jsonb) values('${id.orgA}','${id.caseA}','[]') on conflict(org_id,deal_id) do update set items_jsonb=excluded.items_jsonb;`);
      expect((await predeploy.query<{ case_version: number; checklist_version: number }>(`select
        (select case_version::int from deals where id='${id.caseA}') case_version,
        (select version::int from deal_document_checklists where deal_id='${id.caseA}') checklist_version`)).rows[0]).toEqual({ case_version: 1, checklist_version: 1 });
      await expect(predeploy.exec(`update deals set case_version=99 where id='${id.caseA}'`)).rejects.toThrow(/server managed/);
      await expect(predeploy.exec(`insert into deals(id,org_id,company_id,pipeline_id,stage_id,assigned_to,title,case_version) values('${request(42)}','${id.orgA}','${id.companyA}','${id.pipelineA}','${id.stageA}','${id.memberA}','Bad version',99)`)).rejects.toThrow(/must start at zero/);
      await expect(predeploy.exec(`update deal_document_checklists set version=99 where deal_id='${id.caseA}'`)).rejects.toThrow(/server managed/);
      const insertedCase = request(41);
      await predeploy.exec(`insert into deals(id,org_id,company_id,pipeline_id,stage_id,assigned_to,title) values('${insertedCase}','${id.orgA}','${id.companyA}','${id.pipelineA}','${id.stageA}','${id.memberA}','Version fixture')`);
      await expect(predeploy.exec(`insert into deal_document_checklists(org_id,deal_id,version,items_jsonb) values('${id.orgA}','${insertedCase}',99,'[]')`)).rejects.toThrow(/must start at one/);
      expect((await predeploy.query<{ n: number }>(`select count(*)::int n from deal_document_checklists where deal_id='${insertedCase}'`)).rows[0].n).toBe(0);
      expect((await predeploy.query<{ case_version: number; checklist_version: number }>(`select
        (select case_version::int from deals where id='${id.caseA}') case_version,
        (select version::int from deal_document_checklists where deal_id='${id.caseA}') checklist_version`)).rows[0]).toEqual({ case_version: 1, checklist_version: 1 });
      expect((await predeploy.query<{ replayed: boolean }>(`select replayed from append_case_activity('${id.orgA}','${id.caseA}','${request(40)}','activity.memo','activity.category.note','canonical')`)).rows[0].replayed).toBe(false);
      expect((await predeploy.query<{ n: number }>(`select count(*)::int n from activities where deal_id='${id.caseA}'`)).rows[0].n).toBe(2);
    } finally {
      await predeploy.close();
    }
  });

  it("enforces composite org/company/pipeline/stage and child Case ownership on new rows", async () => {
    await expect(db.exec(`insert into deals(id,org_id,company_id,pipeline_id,stage_id,assigned_to,title) values(gen_random_uuid(),'${id.orgA}','${id.companyB}','${id.pipelineA}','${id.stageA}','${id.memberA}','cross')`)).rejects.toThrow();
    await expect(db.exec(`insert into deals(id,org_id,company_id,pipeline_id,stage_id,assigned_to,title) values(gen_random_uuid(),'${id.orgA}','${id.companyA}','${id.pipelineA}','${id.stageB}','${id.memberA}','cross-stage')`)).rejects.toThrow();
    await expect(db.exec(`insert into activities(org_id,deal_id,company_id,type) values('${id.orgA}','${id.caseA}','${id.companyB}','memo')`)).rejects.toThrow();
    await expect(asUser(id.memberA, `insert into activities(org_id,deal_id,company_id,type,actor) values('${id.orgA}','${id.caseOther}',null,'memo','${id.memberA}')`)).rejects.toThrow();
    await expect(asUser(id.ownerB, `insert into activities(org_id,deal_id,company_id,type,actor) values('${id.orgB}','${id.caseA}',null,'memo','${id.ownerB}')`)).rejects.toThrow();
    await expect(asUser(id.memberA, `insert into deal_document_checklists(org_id,deal_id,company_id,items_jsonb) values('${id.orgA}','${id.caseOther}',null,'[]')`)).rejects.toThrow();
  });

  it("inherits assigned Case visibility and fails closed for foreign and legacy-null Cases", async () => {
    expect((await asUser(id.memberA, `select (read_case('${id.orgA}','${id.caseA}')->>'case_id')::text as id`)).rows[0]).toEqual({ id: id.caseA });
    await expect(asUser(id.memberA, `select read_case('${id.orgA}','${id.caseOther}')`)).rejects.toThrow(/unavailable/);
    await expect(asUser(id.memberA, `select * from append_case_activity('${id.orgA}','${id.caseLegacy}','${request(1)}','activity.memo','activity.category.note','x')`)).rejects.toThrow(/unavailable/);
    await expect(asUser(id.memberA, `select * from append_case_activity('${id.orgA}','${id.caseCrossOrgCompany}','${request(24)}','activity.memo','activity.category.note','x')`)).rejects.toThrow(/unavailable/);
    await expect(asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseCrossOrgCompany}','${id.stageA2}',0,'${request(25)}','x')`)).rejects.toThrow(/unavailable/);
    await expect(asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseCrossOrgCompany}',0,'${request(26)}',null,'[]')`)).rejects.toThrow(/unavailable/);
    await expect(asUser(id.memberA, `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseCrossOrgCompany}','${request(27)}','{"task_status":"done"}'::jsonb)`)).rejects.toThrow(/unavailable/);
    expect(await scalar<number>(`select count(*)::int from activities where deal_id='${id.caseCrossOrgCompany}'`)).toBe(0);
    expect(await scalar<number>(`select count(*)::int from deal_document_checklists where deal_id='${id.caseCrossOrgCompany}'`)).toBe(0);
    await expect(asUser(id.ownerB, `select read_case('${id.orgA}','${id.caseA}')`)).rejects.toThrow(/unavailable/);
  });

  it("hardens the legacy reassignment RPC without breaking valid old-app calls", async () => {
    expect((await asUser(id.ownerA, `select assigned_to::text from reassign_deal_with_activity('${id.orgA}','${id.caseA}','${id.otherA}')`)).rows[0])
      .toEqual({ assigned_to: id.otherA });
    expect(await scalar<number>(`select count(*)::int from activities where deal_id='${id.caseA}' and type_key='activity.assignment'`)).toBe(1);

    await expect(asUser(id.ownerA, `select * from reassign_deal_with_activity('${id.orgA}','${id.caseCrossOrgCompany}','${id.otherA}')`))
      .rejects.toThrow(/case unavailable/);
    await expect(asUser(id.ownerA, `select * from reassign_deal_with_activity('${id.orgA}','${id.caseA}','${id.ownerB}')`))
      .rejects.toThrow(/active member/);
    await expect(asUser(id.memberA, `select * from reassign_deal_with_activity('${id.orgA}','${id.caseA}','${id.memberA}')`))
      .rejects.toThrow(/not allowed/);

    await db.exec(`update items set deleted_at=now() where id='${id.itemA}'`);
    await expect(asUser(id.ownerA, `select * from reassign_deal_with_activity('${id.orgA}','${id.caseA}','${id.memberA}')`))
      .rejects.toThrow(/case unavailable/);
    expect(await scalar<string>(`select assigned_to::text from deals where id='${id.caseA}'`)).toBe(id.otherA);
    expect(await scalar<number>(`select count(*)::int from activities where deal_id='${id.caseA}' and type_key='activity.assignment'`)).toBe(1);
  });

  it("creates Company 1:N Cases with one active projection and exact request replay", async () => {
    await db.exec(`update org_members set scope='assigned' where org_id='${id.orgA}' and user_id='${id.otherA}'`);
    await expect(asUser(id.otherA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(29)}','${id.groupA}')`)).rejects.toThrow(/company unavailable/);
    expect(await scalar<number>(`select count(*)::int from case_operation_receipts where request_id='${request(29)}'`)).toBe(0);
    const first = await asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}','${id.groupA}')`);
    const firstRow = first.rows[0] as { case_id: string; item_id: string; replayed: boolean };
    expect(firstRow.replayed).toBe(false);
    expect((await asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}','${id.groupA}')`)).rows[0]).toMatchObject({
      case_id: firstRow.case_id,
      item_id: firstRow.item_id,
      replayed: true,
    });
    expect(await scalar<number>(`select count(*)::int from items where deal_id='${firstRow.case_id}' and deleted_at is null`)).toBe(1);
    await db.exec(`update org_members set status='suspended' where org_id='${id.orgA}' and user_id='${id.memberA}'`);
    await expect(asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}','${id.groupA}')`)).rejects.toThrow(/permission denied/);
    await db.exec(`update org_members set status='active' where org_id='${id.orgA}' and user_id='${id.memberA}'; update companies set merged_into='${id.mergedA}' where id='${id.companyA}'`);
    await expect(asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}','${id.groupA}')`)).rejects.toThrow(/company unavailable/);
    await db.exec(`update companies set merged_into=null where id='${id.companyA}'`);
    await expect(db.exec(`update deals set company_id='${id.mergedA}' where id='${firstRow.case_id}'`)).rejects.toThrow(/case_operation_receipts_org_id_case_id_company_id_fkey/);
    const replacementItem = request(44);
    const beforeReplacement = {
      deals: await scalar<number>("select count(*)::int from deals"),
      receipts: await scalar<number>("select count(*)::int from case_operation_receipts"),
    };
    await db.exec(`update items set deleted_at=now() where id='${firstRow.item_id}'; insert into items(id,org_id,board_id,group_id,title,assigned_to,deal_id) values('${replacementItem}','${id.orgA}','${id.boardA}','${id.groupA}','replacement','${id.memberA}','${firstRow.case_id}')`);
    await expect(asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}','${id.groupA}')`)).rejects.toThrow(/replay unavailable/);
    expect(await scalar<number>("select count(*)::int from deals")).toBe(beforeReplacement.deals);
    expect(await scalar<number>("select count(*)::int from case_operation_receipts")).toBe(beforeReplacement.receipts);
    await db.exec(`delete from items where id='${replacementItem}'; update items set deleted_at=null where id='${firstRow.item_id}'`);
    expect((await asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}','${id.groupA}')`)).rows[0]).toMatchObject({ replayed: true });
    const legacyRequest = request(32);
    const legacyReplacement = request(45);
    await db.exec(`insert into company_work_start_requests(org_id,request_id,company_id,actor_id,deal_id,item_id,payload) values('${id.orgA}','${legacyRequest}','${id.companyA}','${id.ownerA}','${id.caseOther}','${id.itemOther}',jsonb_build_object('company_id','${id.companyA}'::uuid)); update items set deleted_at=now() where id='${id.itemOther}'; insert into items(id,org_id,board_id,group_id,title,assigned_to,deal_id) values('${legacyReplacement}','${id.orgA}','${id.boardA}','${id.groupA}','legacy replacement','${id.otherA}','${id.caseOther}')`);
    const beforeLegacyReplay = {
      deals: await scalar<number>("select count(*)::int from deals"),
      receipts: await scalar<number>("select count(*)::int from case_operation_receipts"),
    };
    await expect(asUser(id.ownerA, `select * from create_company_case('${id.orgA}','${id.companyA}','${legacyRequest}',null)`)).rejects.toThrow(/legacy replay unavailable/);
    expect(await scalar<number>("select count(*)::int from deals")).toBe(beforeLegacyReplay.deals);
    expect(await scalar<number>("select count(*)::int from case_operation_receipts")).toBe(beforeLegacyReplay.receipts);
    expect(await scalar<number>(`select count(*)::int from case_operation_receipts where request_id='${legacyRequest}'`)).toBe(0);
    const next = (await asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(31)}','${id.groupA}')`)).rows[0] as { case_id: string };
    expect(next.case_id).not.toBe(firstRow.case_id);
    await expect(asUser(id.memberA, `select * from create_company_case('${id.orgA}','${id.companyA}','${request(30)}',null)`)).rejects.toThrow(/mismatch/);
  });

  it("provides canonical Activity append with exact replay and mismatch rejection", async () => {
    const sql = `select * from append_case_activity('${id.orgA}','${id.caseA}','${request(2)}','activity.memo','activity.category.note','memo')`;
    expect((await asUser(id.memberA, sql)).rows[0]).toMatchObject({ replayed: false });
    expect((await asUser(id.memberA, sql)).rows[0]).toMatchObject({ replayed: true });
    await expect(asUser(id.memberA, `select * from append_case_activity('${id.orgA}','${id.caseA}','${request(2)}','activity.memo','activity.category.note','changed')`)).rejects.toThrow(/mismatch/);
    expect(await scalar<number>(`select count(*)::int from activities where request_id='${request(2)}'`)).toBe(1);
  });

  it("atomically mutates whitelisted task custom + Activity with exact replay and mismatch0", async () => {
    const completePatch = `{"task_status":"done"}`;
    const postponePatch = `{"due_date":"2026-09-02","task_status":null,"task_completed_at":null}`;
    const complete = `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseA}','${request(50)}','${completePatch}'::jsonb)`;
    expect((await asUser(id.memberA, complete)).rows[0]).toMatchObject({ replayed: false });
    expect((await asUser(id.memberA, complete)).rows[0]).toMatchObject({ replayed: true });
    expect(await scalar<string>(`select custom->>'task_status' from deals where id='${id.caseA}'`)).toBe("done");
    expect(await scalar<string>(`select custom->>'task_completed_at' from deals where id='${id.caseA}'`)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(await scalar<number>(`select count(*)::int from activities where request_id='${request(50)}' and type_key='activity.status'`)).toBe(1);
    expect(await scalar<number>(`select count(*)::int from case_operation_receipts where request_id='${request(50)}' and operation='case.task.mutate'`)).toBe(1);

    await expect(asUser(id.memberA,
      `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseA}','${request(50)}','${postponePatch}'::jsonb)`,
    )).rejects.toThrow(/mismatch/);
    await expect(asUser(id.memberA,
      `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseOther}','${request(51)}','${postponePatch}'::jsonb)`,
    )).rejects.toThrow(/unavailable/);
    await expect(asUser(id.memberA,
      `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseA}','${request(52)}','{"task_status":"done","task_completed_at":"2026-08-31T01:02:03.000Z","foreign":"x"}'::jsonb)`,
    )).rejects.toThrow(/patch invalid/);
    await expect(asUser(id.memberA,
      `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseA}',null,'{"task_status":"done"}'::jsonb)`,
    )).rejects.toThrow(/input required/);
    expect(await scalar<number>(`select count(*)::int from case_operation_receipts where request_id in ('${request(51)}','${request(52)}')`)).toBe(0);
  });

  it("rolls back task custom, Activity, and receipt together on a receipt failure", async () => {
    const beforeCustom = await scalar<string>(`select custom::text from deals where id='${id.caseA}'`);
    await db.exec(`
      create function fail_case_task_receipt() returns trigger language plpgsql as $$
      begin
        if new.operation='case.task.mutate' then raise exception 'injected task receipt failure'; end if;
        return new;
      end$$;
      create trigger fail_case_task_receipt before insert on case_operation_receipts
        for each row execute function fail_case_task_receipt();
    `);
    await expect(asUser(id.memberA,
      `select * from mutate_case_task_with_activity('${id.orgA}','${id.caseA}','${request(53)}','{"due_date":"2026-09-03","task_status":null,"task_completed_at":null}'::jsonb)`,
    )).rejects.toThrow(/injected task receipt failure/);
    expect(await scalar<string>(`select custom::text from deals where id='${id.caseA}'`)).toBe(beforeCustom);
    expect(await scalar<number>(`select count(*)::int from activities where request_id='${request(53)}'`)).toBe(0);
    expect(await scalar<number>(`select count(*)::int from case_operation_receipts where request_id='${request(53)}'`)).toBe(0);
  });

  it("commits stage transition and Activity atomically, then rejects stale concurrency", async () => {
    const first = asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${request(3)}','move')`);
    const second = asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${request(4)}','move-other')`);
    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winningRequest = settled[0].status === "fulfilled" ? request(3) : request(4);
    expect((await asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${winningRequest}','caller recomputed content')`)).rows[0]).toMatchObject({
      replayed: true, version: 1, stage_id: id.stageA2, pipeline_id: id.pipelineA,
    });
    expect(await scalar<number>(`select case_version::int from deals where id='${id.caseA}'`)).toBe(1);
    expect(await scalar<number>(`select count(*)::int from activities where deal_id='${id.caseA}' and type_key='activity.status'`)).toBe(1);
    await db.exec(`reset role; update deals set stage_id='${id.stageA}',pipeline_id='${id.pipelineA}' where id='${id.caseA}'; delete from stages where id='${id.stageA2}';`);
    expect((await asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${winningRequest}','replay after target deletion')`)).rows[0]).toMatchObject({
      replayed: true, version: 1, stage_id: id.stageA2, pipeline_id: id.pipelineA,
    });
    await db.exec(`update org_members set status='suspended' where org_id='${id.orgA}' and user_id='${id.memberA}'`);
    await expect(asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${winningRequest}','denied replay')`)).rejects.toThrow(/unavailable/);
    await db.exec(`update org_members set status='active' where org_id='${id.orgA}' and user_id='${id.memberA}'; update items set deleted_at=now() where id='${id.itemA}'`);
    await expect(asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${winningRequest}','denied replay')`)).rejects.toThrow(/unavailable/);
  });

  it("rolls back a transition if its Activity/receipt path fails", async () => {
    await db.exec(`create function fail_case_activity() returns trigger language plpgsql as $$begin if new.operation='case.activity.append' then raise exception 'injected';end if;return new;end$$; create trigger fail_case_activity before insert on case_operation_receipts for each row execute function fail_case_activity();`);
    await expect(asUser(id.memberA, `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${request(5)}','fail')`)).rejects.toThrow(/injected/);
    expect(await scalar<number>(`select case_version::int from deals where id='${id.caseA}'`)).toBe(0);
    expect(await scalar<string>(`select stage_id::text from deals where id='${id.caseA}'`)).toBe(id.stageA);
    expect(await scalar<number>(`select count(*)::int from activities where deal_id='${id.caseA}'`)).toBe(0);
  });

  it("uses server CAS for checklist replay, mismatch, and same-version contention", async () => {
    const first = asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',0,'${request(6)}','policy','[{"id":"a","label":"A","checked":false,"order":0}]')`);
    const second = asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',0,'${request(7)}','policy','[{"id":"b","label":"B","checked":false,"order":0}]')`);
    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winningRequest = settled[0].status === "fulfilled" ? request(6) : request(7);
    const winningItems = settled[0].status === "fulfilled" ? `[{"id":"a","label":"A","checked":false,"order":0}]` : `[{"id":"b","label":"B","checked":false,"order":0}]`;
    expect((await asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',0,'${winningRequest}','policy','${winningItems}')`)).rows[0]).toMatchObject({ replayed: true });
    await expect(asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',0,'${winningRequest}','policy','[]')`)).rejects.toThrow(/mismatch/);
    expect(await scalar<number>(`select version::int from deal_document_checklists where deal_id='${id.caseA}'`)).toBe(1);
    expect((await asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',1,'${request(17)}','policy','${winningItems}')`)).rows[0]).toMatchObject({ replayed: false, version: 1 });
    expect((await asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',1,'${request(19)}','policy','[{"id":"next","label":"Next","checked":true,"order":0}]')`)).rows[0]).toMatchObject({ replayed: false, version: 2 });
    await expect(asUser(id.memberA, `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',2,'${request(18)}','policy','[{"id":"x","label":"X","checked":"no","order":0}]')`)).rejects.toThrow(/schema invalid/);
    expect(await scalar<number>(`select count(*)::int from case_operation_receipts where request_id='${request(18)}'`)).toBe(0);
  });

  it("serializes independent connections for stage and checklist expected-version writes", async () => {
    const databaseId = `issue646-${crypto.randomUUID()}`;
    const first = await sharedWorkerClient(databaseId);
    await first.exec(schema);
    await first.exec(migration144);
    const second = await sharedWorkerClient(databaseId);
    await first.exec(`select set_config('app.uid','${id.memberA}',false); set role authenticated;`);
    await second.exec(`select set_config('app.uid','${id.memberA}',false); set role authenticated;`);
    const move = (client: PGliteWorker, requestId: string, content: string) => client.query(
      `select * from move_case_stage_with_activity('${id.orgA}','${id.caseA}','${id.stageA2}',0,'${requestId}','${content}')`,
    );
    const moves = await Promise.allSettled([
      move(first, request(20), "first"),
      move(second, request(21), "second"),
    ]);
    expect(moves.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(moves.filter((result) => result.status === "rejected")).toHaveLength(1);

    const checklist = (client: PGliteWorker, requestId: string, item: string) => client.query(
      `select * from mutate_case_checklist('${id.orgA}','${id.caseA}',0,'${requestId}','policy','[{"id":"${item}","label":"${item}","checked":false,"order":0}]')`,
    );
    const checklists = await Promise.allSettled([
      checklist(first, request(22), "first"),
      checklist(second, request(23), "second"),
    ]);
    expect(checklists.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(checklists.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await first.query<{ activities: number; checklist_version: number }>(`
      select (select count(*) from activities where deal_id='${id.caseA}')::int activities,
        (select version from deal_document_checklists where deal_id='${id.caseA}')::int checklist_version
    `)).rows[0]).toEqual({ activities: 1, checklist_version: 1 });
  });

  it("keeps retired registry values readable, rejects unknown writes, and splits finance ACLs", async () => {
    const exactActivity = `select * from append_case_activity('${id.orgA}','${id.caseA}','${request(8)}','activity.memo','activity.category.note','x')`;
    expect((await asUser(id.memberA, exactActivity)).rows[0]).toMatchObject({ replayed: false });
    await db.exec(`update case_option_registry set retired=true,label='과거 메모' where option_id='activity.memo'`);
    expect(await scalar<string>(`select label from case_option_registry where option_id='activity.memo'`)).toBe("과거 메모");
    expect((await asUser(id.memberA, exactActivity)).rows[0]).toMatchObject({ replayed: true });
    await expect(asUser(id.memberA, `select * from append_case_activity('${id.orgA}','${id.caseA}','${request(10)}','activity.memo','activity.category.note','x')`)).rejects.toThrow(/option unavailable/);
    await expect(asUser(id.memberA, `select * from append_case_activity('${id.orgA}','${id.caseA}','${request(9)}','activity.unknown','activity.category.note','x')`)).rejects.toThrow(/option unavailable/);
    expect((await asUser(id.ownerA, `select can_read_case_ledger('${id.orgA}','${id.caseA}') as allowed,can_manage_case_ledger('${id.orgA}','${id.caseA}') as manage`)).rows[0]).toEqual({ allowed: true, manage: true });
    expect((await asUser(id.memberA, `select can_read_case_ledger('${id.orgA}','${id.caseA}') as allowed,can_manage_case_ledger('${id.orgA}','${id.caseA}') as manage`)).rows[0]).toEqual({ allowed: false, manage: false });
    expect((await asUser(id.otherA, `select can_read_case_ledger('${id.orgA}','${id.caseA}') as allowed,can_manage_case_ledger('${id.orgA}','${id.caseA}') as manage`)).rows[0]).toEqual({ allowed: true, manage: false });
    await expect(asUser(id.otherA, `select add_deal_ledger_entry('${id.caseA}','fee',100,0,current_date,null,current_date,false,false)`)).rejects.toThrow(/manage denied/);
    const entryId = ((await asUser(id.ownerA, `select add_deal_ledger_entry('${id.caseA}','ledger.fee',100,0,current_date,null,current_date,false,false) as id`)).rows[0] as { id: string }).id;
    expect(await scalar<string>(`select kind_key from deal_ledger_entries where id='${entryId}'`)).toBe("ledger.fee");
    await db.exec(`update case_option_registry set label='수수료(개정)',retired=true where option_id='ledger.fee'`);
    expect(await scalar<string>(`select kind_key from deal_ledger_entries where id='${entryId}'`)).toBe("ledger.fee");
    await expect(asUser(id.ownerA, `select add_deal_ledger_entry('${id.caseA}','fee',100,0,current_date,null,current_date,false,false)`)).rejects.toThrow(/kind unavailable/);
  });

  it("locks new receipt/registry objects and canonical RPC execution while preserving predeploy compatibility", async () => {
    expect(await scalar<boolean>("select has_table_privilege('authenticated','public.activities','insert')")).toBe(true);
    expect(await scalar<boolean>("select has_table_privilege('authenticated','public.deal_document_checklists','update')")).toBe(true);
    expect(await scalar<boolean>("select has_table_privilege('authenticated','public.case_operation_receipts','select')")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('anon','public.append_case_activity(uuid,uuid,uuid,text,text,text)','execute')")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('service_role','public.append_case_activity(uuid,uuid,uuid,text,text,text)','execute')")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('authenticated','public.append_case_activity(uuid,uuid,uuid,text,text,text)','execute')")).toBe(true);
    expect(await scalar<boolean>("select has_function_privilege('anon','public.mutate_case_task_with_activity(uuid,uuid,uuid,jsonb)','execute')")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('service_role','public.mutate_case_task_with_activity(uuid,uuid,uuid,jsonb)','execute')")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('authenticated','public.mutate_case_task_with_activity(uuid,uuid,uuid,jsonb)','execute')")).toBe(true);
    expect(await scalar<boolean>("select relrowsecurity and relforcerowsecurity from pg_class where oid='public.case_operation_receipts'::regclass")).toBe(true);
    expect(await scalar<string>("select proconfig[1] from pg_proc where oid='public.append_case_activity(uuid,uuid,uuid,text,text,text)'::regprocedure")).toBe("search_path=\"\"");
    expect(await scalar<string>("select proconfig[1] from pg_proc where oid='public.mutate_case_task_with_activity(uuid,uuid,uuid,jsonb)'::regprocedure")).toBe("search_path=\"\"");
  });
});
