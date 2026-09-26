import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sql150 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/150_issue700_detail_event_edit.sql"),
  "utf8",
);
const ids = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010",
  member: "00000000-0000-4000-8000-000000000011",
  outsider: "00000000-0000-4000-8000-000000000012",
  boardA: "00000000-0000-4000-8000-000000000020",
  groupA: "00000000-0000-4000-8000-000000000030",
  req1: "00000000-0000-4000-8000-000000000101",
  req2: "00000000-0000-4000-8000-000000000102",
  req3: "00000000-0000-4000-8000-000000000103",
  req4: "00000000-0000-4000-8000-000000000104",
};

async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe("150 founded_month atomic wrapper (PGlite actual SQL)", () => {
  let db: PGlite;
  afterEach(async () => { await db?.close(); });
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create type public.stage_kind as enum ('marketing','meeting','contract','work','settle','post');
      create table users(id uuid primary key); create table orgs(id uuid primary key,status text);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
      create table boards(id uuid primary key,org_id uuid,source text,is_system boolean not null default false);
      create table board_groups(id uuid primary key,org_id uuid,board_id uuid);
      create function board_column_policy_allows(uuid,jsonb) returns boolean language sql stable as $$select true$$;
      create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,key text,archived_at timestamptz,is_required boolean not null default false,validation_jsonb jsonb not null default '{}'::jsonb,view_policy_jsonb jsonb not null default '{}'::jsonb);
      create table pipelines(id uuid primary key default gen_random_uuid(),org_id uuid,name text);
      create table stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid,name text,sort_order int,kind stage_kind);
      create table deals(id uuid primary key default gen_random_uuid(),org_id uuid,company_id uuid,pipeline_id uuid,stage_id uuid,assigned_to uuid,title text,applied_on date);
      create table deal_intake(deal_id uuid primary key,org_id uuid,representative_name text,phone_normalized text,phone_display text,email_normalized text,business_registration_type text,industry text,industry_code text,revenue_band text,region_sido text,region_sigungu text,address_detail text,acquisition_source text,source_external_id text);
      create table items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,title text,assigned_to uuid,deal_id uuid,deleted_at timestamptz);
      create table new_lead_requests(org_id uuid,request_id uuid,operation text,deal_id uuid,item_id uuid,actor_id uuid,payload jsonb,primary key(org_id,request_id));
      create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      create table deal_intake_field_audit(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,field_key text,old_value jsonb,new_value jsonb,value_source text,actor_id uuid,request_id uuid,unique(org_id,request_id,field_key));
      create table board_item_detail_events(id uuid primary key default gen_random_uuid(),org_id uuid references orgs(id),board_id uuid references boards(id),item_id uuid references items(id),actor_id uuid references users(id),kind text check (kind in ('memo','call','admin','meeting','field_change')),body text,metadata jsonb default '{}'::jsonb,request_id uuid,created_at timestamptz default now(),deleted_at timestamptz,deleted_by uuid);
      insert into users values('${ids.owner}'),('${ids.member}'),('${ids.outsider}');
      insert into orgs values('${ids.orgA}','active'),('${ids.orgB}','active');
      insert into org_members values ('${ids.orgA}','${ids.owner}','owner','all','active'),('${ids.orgA}','${ids.member}','member','assigned','active');
      insert into boards values('${ids.boardA}','${ids.orgA}','core.default-tab/new-lead',false);
      insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}');
      insert into board_columns(org_id,board_id,key) select '${ids.orgA}','${ids.boardA}',unnest(array['owner','collaborators','applied_on','phone','rep_name','biz_reg_type','industry','revenue_band','sido','sigungu','email','ad_name','business_registration_type','region_sido','region_sigungu','acquisition_source','founded_month','absence_notice','consult1_notice','confirm2_notice','feedback_status','consult_status','contact_move']);
    `);
    const sql120 = readFileSync(resolve(process.cwd(), "../supabase/migrations/120_bbe273_new_lead_full_intake.sql"), "utf8");
    await db.exec(sql120.slice(sql120.indexOf("create function public.create_new_lead("), sql120.indexOf("revoke all on function public.create_new_lead(")));
    await db.exec(sql150);
    const before = (await db.query("select proname,proowner,proacl,prosecdef from pg_proc where proname in ('create_new_lead','create_new_lead_with_founded_month') order by proname")).rows;
    await db.exec(readFileSync(resolve(process.cwd(), "../supabase/migrations/160_new_lead_pipeline_structure.sql"), "utf8"));
    expect((await db.query("select proname,proowner,proacl,prosecdef from pg_proc where proname in ('create_new_lead','create_new_lead_with_founded_month') order by proname")).rows).toEqual(before);
    await actor(db, ids.owner);
  });

  function createCall(request: string, title: string, month: string | null) {
    const monthArg = month === null ? "null" : `'${month}'`;
    return `select * from create_new_lead_with_founded_month('${ids.orgA}','${ids.boardA}','${ids.groupA}','${request}','${title}',null,null,null,null,null,null,null,null,null,null,null,null,null,'{}',${monthArg})`;
  }

  it("new pipeline starts with exactly one ordered marketing/meeting/work and replay adds none", async () => {
    await db.query(createCall(ids.req1, "신규", null));
    await db.query(createCall(ids.req1, "신규", null));
    expect((await db.query("select kind,sort_order from stages order by sort_order")).rows).toEqual([
      { kind: "marketing", sort_order: 0 }, { kind: "meeting", sort_order: 1 }, { kind: "work", sort_order: 2 },
    ]);
  });
  it("existing partial custom pipeline is never automatically supplemented", async () => {
    await db.exec(`insert into pipelines(id,org_id,name) values('${ids.req2}','${ids.orgA}','기본 파이프라인');
      insert into stages(pipeline_id,name,sort_order,kind) values('${ids.req2}','맞춤 신규',8,'marketing')`);
    await db.query(createCall(ids.req1, "신규", null));
    expect((await db.query("select name,kind,sort_order from stages")).rows).toEqual([{name:"맞춤 신규",kind:"marketing",sort_order:8}]);
  });
  it("legacy 120 intake also initializes full structure only on a genuinely new pipeline", async () => {
    await db.query(`select * from create_new_lead('${ids.orgA}','${ids.boardA}','${ids.groupA}','${ids.req1}','신규')`);
    expect((await db.query<{ kind: string }>("select kind from stages order by sort_order")).rows.map((row) => row.kind)).toEqual(["marketing","meeting","work"]);
  });

  it("잘못된 월이면 회사가 생기지 않는다 (validate before mutation)", async () => {
    await expect(db.query(createCall(ids.req1, "나쁜월", "2024-13"))).rejects.toThrow(/founded_month invalid/);
    const deals = (await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n;
    const items = (await db.query<{ n: number }>("select count(*)::int n from items")).rows[0].n;
    expect(deals).toBe(0);
    expect(items).toBe(0);
  });

  it("컬럼이 없으면 성공을 돌려주지 않고 전체를 되돌린다", async () => {
    await db.exec(`delete from board_columns where board_id='${ids.boardA}' and key='founded_month'`);
    await expect(db.query(createCall(ids.req2, "컬럼없음", "2024-03"))).rejects.toThrow(/founded_month column missing/);
    const deals = (await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n;
    expect(deals).toBe(0);
  });

  it("월을 같은 트랜잭션에 한 번에 쓰고 같은 request replay는 중복 없이 돌려준다", async () => {
    const first = await db.query<{ item_id: string; replayed: boolean }>(createCall(ids.req3, "정상", "2024-03"));
    expect(first.rows[0].replayed).toBe(false);
    const stored = (await db.query<{ value_jsonb: string }>(`select value_jsonb#>>'{}' value_jsonb from item_values where item_id='${first.rows[0].item_id}' and column_key='founded_month'`)).rows[0].value_jsonb;
    expect(stored).toBe("2024-03");
    const replay = await db.query<{ item_id: string; replayed: boolean }>(createCall(ids.req3, "정상", "2024-03"));
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    const count = (await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n;
    expect(count).toBe(1);
  });

  it("같은 request로 월이 다르면 거절하고 뒤에 바뀐 월을 옛 replay가 덮지 않는다", async () => {
    const first = await db.query<{ item_id: string }>(createCall(ids.req4, "충돌", "2024-03"));
    await expect(db.query(createCall(ids.req4, "충돌", "2024-04"))).rejects.toThrow(/idempotency key reuse/);
    // 뒤에 월을 직접 고침 (상세 setCells 경로 흉내)
    await db.exec(`select set_config('moawork.new_lead_projection_write','on',true)`);
    await db.exec(`insert into item_values(org_id,item_id,column_key,value_jsonb) values('${ids.orgA}','${first.rows[0].item_id}','founded_month','"2024-05"') on conflict (item_id,column_key) do update set value_jsonb=excluded.value_jsonb`);
    // 옛 요청 replay는 새 값을 덮지 않고 그대로 돌려준다
    const replay = await db.query<{ item_id: string; replayed: boolean }>(createCall(ids.req4, "충돌", "2024-03"));
    expect(replay.rows[0].replayed).toBe(true);
    const cur = (await db.query<{ value_jsonb: string }>(`select value_jsonb#>>'{}' value_jsonb from item_values where item_id='${first.rows[0].item_id}' and column_key='founded_month'`)).rows[0].value_jsonb;
    expect(cur).toBe("2024-05");
  });
});
