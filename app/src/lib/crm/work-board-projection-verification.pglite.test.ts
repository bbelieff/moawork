import { PGlite } from "@electric-sql/pglite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const transitionSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/069_contact_pipeline_transitions.sql"), "utf8");
const projectionSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/100_bbe235_work_board_projection.sql"), "utf8");
const calculationSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/062_board_calculated_values.sql"), "utf8");
const dashboardSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/099_bbe215_today_kpi_definitions.sql"), "utf8");

const id = {
  org: "00000000-0000-4000-8000-000000000001",
  otherOrg: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010",
  member: "00000000-0000-4000-8000-000000000011",
  pipeline: "00000000-0000-4000-8000-000000000020",
  meeting: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  workBoard: "00000000-0000-4000-8000-000000000030",
  workGroup: "00000000-0000-4000-8000-000000000031",
  deal: "00000000-0000-4000-8000-000000000040",
} as const;

const schema = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create table public.orgs(id uuid primary key,status text not null default 'active');
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid,user_id uuid,role text,scope text,status text not null default 'active',primary key(org_id,user_id));
  create table public.pipelines(id uuid primary key,org_id uuid,created_at timestamptz default now());
  create table public.stages(id uuid primary key,pipeline_id uuid references pipelines,kind text);
  create table public.companies(id uuid primary key default gen_random_uuid(),org_id uuid);
  create table public.deals(
    id uuid primary key default gen_random_uuid(),org_id uuid references orgs,assigned_to uuid,
    pipeline_id uuid,stage_id uuid,company_id uuid,custom jsonb default '{}',title text,updated_at timestamptz default now()
  );
  create table public.activities(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,type text,content text,actor uuid);
  create table public.boards(id uuid primary key,org_id uuid,source text);
  create table public.board_groups(id uuid primary key,org_id uuid,board_id uuid,name text,sort_order int default 0);
  create table public.board_columns(board_id uuid,key text,label text,source text,is_readonly boolean default false,primary key(board_id,key));
  create table public.items(
    id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,assigned_to uuid,
    title text check(title <> 'FAIL'),deal_id uuid,deleted_at timestamptz
  );
  create table public.item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
  create table public.work_item_versions(org_id uuid,item_id uuid primary key,due_date date,workflow_status text);
  create table public.notifications(id uuid primary key,org_id uuid,user_id uuid,type text,title text,body text,target_type text,target_id uuid,is_action boolean,read_at timestamptz,resolved_at timestamptz,created_at timestamptz);
  create table public.onboarding_quest_defs(quest_key text primary key,sort_order int default 0);
  create table public.onboarding_quest_progress(org_id uuid,quest_key text,completed_at timestamptz default now(),primary key(org_id,quest_key));
  create unique index items_active_deal_projection_uq on public.items(org_id,deal_id) where deal_id is not null and deleted_at is null;
  create function public.begin_guarded_migration(
    p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
    p_executor text,p_thread_id text,p_foundation boolean
  ) returns void language sql as $$select$$;
  create function public.effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$
    select p_key='work.view_tabs' and exists(
      select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active'
    )
  $$;
  create function public.handoff_company_to_work(uuid,uuid,text,text,text,text,text,text,text,text,date,numeric,uuid,uuid)
  returns table(deal_id uuid,company_id uuid,mode text,duplicate_candidate_ids uuid[]) language plpgsql as $$
  declare c uuid:=gen_random_uuid(); d uuid:=coalesce($2,gen_random_uuid()); begin
    insert into public.companies values(c,$1);
    if $2 is null then insert into public.deals(id,org_id,assigned_to,title) values(d,$1,auth.uid(),$3); end if;
    update public.deals set company_id=c where id=d and org_id=$1;
    return query select d,c,'created'::text,'{}'::uuid[];
  end$$;
`;

async function boot(dataDir = "memory://") {
  const db = new PGlite(dataDir);
  await db.exec(schema);
  await db.exec(transitionSql);
  await db.exec(projectionSql);
  await db.exec(calculationSql);
  await db.exec(dashboardSql);
  await db.exec(`
    insert into orgs values('${id.org}'),('${id.otherOrg}');
    insert into users values('${id.owner}'),('${id.member}');
    insert into org_members values
      ('${id.org}','${id.owner}','owner','all'),
      ('${id.org}','${id.member}','member','assigned');
    insert into pipelines(id,org_id) values('${id.pipeline}','${id.org}');
    insert into stages values('${id.meeting}','${id.pipeline}','meeting'),('${id.work}','${id.pipeline}','work');
    insert into boards values('${id.workBoard}','${id.org}','core.default-tab/contract-work');
    insert into board_groups values('${id.workGroup}','${id.org}','${id.workBoard}','진행중',0);
    insert into board_columns values
      ('${id.workBoard}','execution_amount','실행액','manual',false),
      ('${id.workBoard}','fee_percent','수수료(%)','manual',false),
      ('${id.workBoard}','fee_amount','수수료(원)','calc',true),
      ('${id.workBoard}','fee_paid_on','수수료_입금일','manual',false);
    insert into deals(id,org_id,assigned_to,pipeline_id,stage_id,custom,title)
      values('${id.deal}','${id.org}','${id.member}','${id.pipeline}','${id.meeting}','{"seal_approval":"완료"}','검색 가능한 계약사');
  `);
  return db;
}

async function move(db: PGlite, requestId: string, dealId = id.deal) {
  return db.query<{ status: string; deal_id: string }>(`
    select status,deal_id from execute_contact_pipeline_transition(
      '${id.org}','${dealId}',null,'${requestId}','contact_to_work',null,'검색 가능한 계약사'
    )
  `);
}

describe("BBE-235 canonical work-board projection verification", () => {
  const opened: PGlite[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((db) => db.close()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("projects the existing-deal call path once and preserves role/scope/org boundaries", async () => {
    const db = await boot(); opened.push(db);
    await db.exec(`select set_config('app.uid','${id.member}',false)`);
    const request = "00000000-0000-4000-8000-000000000090";
    expect((await move(db, request)).rows[0]).toMatchObject({ status: "committed", deal_id: id.deal });
    await move(db, request);

    const rows = await db.query<{ org_id: string; deal_id: string; assigned_to: string; title: string }>(
      `select org_id,deal_id,assigned_to,title from items where deal_id='${id.deal}' and deleted_at is null`,
    );
    expect(rows.rows).toEqual([{ org_id: id.org, deal_id: id.deal, assigned_to: id.member, title: "검색 가능한 계약사" }]);
    const companyLink = await db.query<{ company_id: string; linked_company_id: string }>(`
      select deal.company_id,company.id linked_company_id
      from deals deal
      join companies company on company.id=deal.company_id and company.org_id=deal.org_id
      where deal.id='${id.deal}' and deal.org_id='${id.org}'
    `);
    expect(companyLink.rows).toHaveLength(1);
    expect(companyLink.rows[0].company_id).toBe(companyLink.rows[0].linked_company_id);

    await db.exec(`select set_config('app.uid','${id.owner}',false)`);
    await expect(db.query(`select * from execute_contact_pipeline_transition('${id.otherOrg}','${id.deal}',null,gen_random_uuid(),'contact_to_work')`))
      .rejects.toThrow(/transition unavailable/u);
    await db.exec(`update org_members set scope='assigned',role='member' where user_id='${id.owner}'`);
    await expect(move(db, "00000000-0000-4000-8000-000000000091"))
      .rejects.toThrow(/transition unavailable/u);
    expect((await db.query<{ n: number }>("select count(*)::int n from items where deleted_at is null")).rows[0].n).toBe(1);
  });

  it("rolls the transition back when projection fails, leaving partial writes at zero", async () => {
    const db = await boot(); opened.push(db);
    await db.exec(`select set_config('app.uid','${id.owner}',false); update deals set title='FAIL' where id='${id.deal}'`);
    await expect(move(db, "00000000-0000-4000-8000-000000000092")).rejects.toThrow();
    expect((await db.query<{ kind: string }>(`select s.kind from deals d join stages s on s.id=d.stage_id where d.id='${id.deal}'`)).rows[0].kind).toBe("meeting");
    expect((await db.query<{ n: number }>("select count(*)::int n from contact_pipeline_transitions")).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from companies")).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from items")).rows[0].n).toBe(0);
  });

  it("survives reload/search and feeds the canonical fee calculation and monthly aggregate keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bbe235-")); dirs.push(dir);
    let db = await boot(dir); opened.push(db);
    await db.exec(`select set_config('app.uid','${id.owner}',false)`);
    await move(db, "00000000-0000-4000-8000-000000000093");
    const item = (await db.query<{ id: string }>(`select id from items where deal_id='${id.deal}'`)).rows[0].id;
    await db.exec(`
      insert into item_values(org_id,item_id,column_key,value_jsonb) values
        ('${id.org}','${item}','execution_amount','1000000'),
        ('${id.org}','${item}','fee_percent','10'),
        ('${id.org}','${item}','fee_paid_on','"2026-08-21"');
    `);
    expect((await db.query<{ amount: number }>(`select (value_jsonb #>> '{}')::int amount from item_values where item_id='${item}' and column_key='fee_amount'`)).rows[0].amount).toBe(100000);
    await db.close(); opened.pop();

    db = new PGlite(dir); opened.push(db);
    const searched = await db.query<{ deal_id: string }>("select deal_id from items where lower(title) like '%검색 가능%' and deleted_at is null");
    expect(searched.rows).toEqual([{ deal_id: id.deal }]);
    await db.exec(`select set_config('app.uid','${id.owner}',false)`);
    const snapshot = await db.query<{ snapshot: { kpis: { fees: number }; period: { monthStart: string; monthEndExclusive: string } } }>(
      `select public.read_today_dashboard('${id.org}','2026-08-21T04:00:00Z') snapshot`,
    );
    expect(snapshot.rows[0].snapshot.kpis.fees).toBe(100000);
    expect(snapshot.rows[0].snapshot.period).toMatchObject({ monthStart: "2026-08-01", monthEndExclusive: "2026-09-01" });
    expect(projectionSql).toContain("core.default-tab/contract-work");
    expect(projectionSql).toContain("new.deal_id");
  });
});
