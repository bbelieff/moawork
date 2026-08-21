import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const actor = "00000000-0000-4000-8000-000000000001";
const org = "00000000-0000-4000-8000-000000000010";
const otherOrg = "00000000-0000-4000-8000-000000000011";
const company = "00000000-0000-4000-8000-000000000020";

describe("BBE-237 company start work migration", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key,status text not null default 'active');
      create table public.org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table public.companies(id uuid primary key,org_id uuid not null references orgs,name text not null,assigned_to uuid,merged_into uuid);
      create table public.pipelines(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs);
      create table public.stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid not null references pipelines,sort_order int not null default 0);
      create table public.deals(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs,company_id uuid references companies,pipeline_id uuid references pipelines,stage_id uuid references stages,assigned_to uuid,title text not null);
      create table public.boards(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs,source text);
      create table public.board_groups(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs,board_id uuid not null references boards,sort_order int not null default 0);
      create table public.items(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs,board_id uuid not null references boards,group_id uuid references board_groups,title text not null,assigned_to uuid,deal_id uuid references deals);
      create table public.audit_logs(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs,actor uuid,action text,target_type text,target_id uuid,meta jsonb,at timestamptz default now());
      create function public.is_org_member(candidate uuid) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=candidate and user_id=auth.uid() and status='active')$$;
      create function public.effective_permission(candidate uuid, permission_key text) returns boolean language sql stable as $$select public.is_org_member(candidate) and permission_key='work.item_upsert'$$;
      create function public.begin_guarded_migration(
        p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
        p_executor text,p_thread_id text,p_foundation boolean default false
      ) returns void language sql as $$select$$;
      insert into users values ('${actor}');
      insert into orgs(id) values ('${org}'),('${otherOrg}');
      insert into org_members values ('${org}','${actor}','member','assigned','active');
      insert into companies(id,org_id,name,assigned_to) values ('${company}','${org}','테스트 회사','${actor}');
      insert into pipelines(org_id) values ('${org}');
      insert into stages(pipeline_id) select id from pipelines where org_id='${org}';
      insert into boards(org_id,source) values ('${org}','core.default-tab/contract-work');
      insert into board_groups(org_id,board_id) select org_id,id from boards;
      select set_config('request.jwt.claim.sub','${actor}',false);
    `);
    const sql = await readFile(resolve(process.cwd(), "../supabase/migrations/117_bbe237_company_start_work.sql"), "utf8");
    await db.exec(sql);
  });
  afterEach(async () => db.close());

  it("creates one linked deal/item/audit and replays the same result without duplicates", async () => {
    const request = "00000000-0000-4000-8000-000000000030";
    const first = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>("select * from start_company_work($1,$2,$3)", [org, company, request]);
    const replay = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>("select * from start_company_work($1,$2,$3)", [org, company, request]);
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    const counts = await db.query<{ deals: number; items: number; audits: number; requests: number }>(`select
      (select count(*)::int from deals) deals,(select count(*)::int from items) items,
      (select count(*)::int from audit_logs where action='company.work_started' and meta->>'request_id'=$1) audits,
      (select count(*)::int from company_work_start_requests) requests`, [request]);
    expect(counts.rows[0]).toEqual({ deals: 1, items: 1, audits: 1, requests: 1 });
  });

  it("denies a cross-org company without leaving a shell deal", async () => {
    await expect(db.query("select * from start_company_work($1,$2,$3)", [otherOrg, company, "00000000-0000-4000-8000-000000000031"])).rejects.toThrow();
    expect((await db.query<{ count: number }>("select count(*)::int count from deals")).rows[0].count).toBe(0);
  });

  it("rolls back the deal when projection cannot complete", async () => {
    await db.exec("delete from board_groups; delete from boards");
    await expect(db.query("select * from start_company_work($1,$2,$3)", [org, company, "00000000-0000-4000-8000-000000000032"])).rejects.toThrow("contract work board unavailable");
    expect((await db.query<{ count: number }>("select count(*)::int count from deals")).rows[0].count).toBe(0);
  });
});
