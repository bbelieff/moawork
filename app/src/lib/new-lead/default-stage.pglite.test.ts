import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/119_bbe272_new_lead_default_stage.sql"), "utf8");
const functionSql = migration.slice(migration.indexOf("create or replace function public.create_new_lead"));

const id = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010",
  member: "00000000-0000-4000-8000-000000000011",
  inactive: "00000000-0000-4000-8000-000000000012",
  boardA: "00000000-0000-4000-8000-000000000020",
  boardB: "00000000-0000-4000-8000-000000000021",
  groupA: "00000000-0000-4000-8000-000000000030",
  groupB: "00000000-0000-4000-8000-000000000031",
};

async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe("BBE-272 new lead default pipeline/stage repair", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create type public.stage_kind as enum ('marketing','meeting','contract','work','settle','post');
      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key,status text not null);
      create table public.org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create function public.effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$
        select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')
      $$;
      create table public.boards(id uuid primary key,org_id uuid,source text);
      create table public.board_groups(id uuid primary key,org_id uuid,board_id uuid);
      create table public.board_columns(id uuid primary key default gen_random_uuid(),board_id uuid,key text);
      create table public.pipelines(id uuid primary key default gen_random_uuid(),org_id uuid,name text not null default '기본 파이프라인');
      create table public.stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid,name text,sort_order int,kind public.stage_kind);
      create table public.deals(id uuid primary key default gen_random_uuid(),org_id uuid,company_id uuid,pipeline_id uuid,stage_id uuid,assigned_to uuid,title text);
      create table public.deal_intake(deal_id uuid primary key,org_id uuid,representative_name text,phone_normalized text,phone_display text,email_normalized text,business_registration_type text,industry text,industry_code text,revenue_band text,region_sido text,region_sigungu text,acquisition_source text,source_external_id text);
      create table public.items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,title text,assigned_to uuid,deal_id uuid,deleted_at timestamptz);
      create table public.new_lead_requests(org_id uuid,request_id uuid,operation text,deal_id uuid,item_id uuid,actor_id uuid,payload jsonb,primary key(org_id,request_id));
      create table public.item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      insert into public.users values('${id.owner}'),('${id.member}'),('${id.inactive}');
      insert into public.orgs values('${id.orgA}','active'),('${id.orgB}','active');
      insert into public.org_members values
        ('${id.orgA}','${id.owner}','owner','all','active'),
        ('${id.orgA}','${id.member}','member','assigned','active'),
        ('${id.orgA}','${id.inactive}','member','assigned','inactive'),
        ('${id.orgB}','${id.owner}','owner','all','active');
      insert into public.boards values
        ('${id.boardA}','${id.orgA}','core.default-tab/new-lead'),
        ('${id.boardB}','${id.orgB}','core.default-tab/new-lead');
      insert into public.board_groups values
        ('${id.groupA}','${id.orgA}','${id.boardA}'),
        ('${id.groupB}','${id.orgB}','${id.boardB}');
    `);
    await db.exec(functionSql);
    await actor(db, id.owner);
  });

  it("atomically ensures one default structure, saves the projection, and replays", async () => {
    const request = "00000000-0000-4000-8000-000000000100";
    const first = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>(
      `select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}','${request}','첫 리드')`,
    );
    const replay = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>(
      `select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}','${request}','첫 리드')`,
    );
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    expect((await db.query<{ n: number }>("select count(*)::int n from pipelines")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from stages where kind='marketing'")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from deals d join deal_intake i on i.deal_id=d.id join items x on x.deal_id=d.id")).rows[0].n).toBe(1);
    await db.exec("delete from stages; delete from pipelines");
    const replayWithoutStructure = await db.query<{ replayed: boolean }>(
      `select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}','${request}','첫 리드')`,
    );
    expect(replayWithoutStructure.rows[0].replayed).toBe(true);
    expect((await db.query<{ n: number }>("select count(*)::int n from pipelines")).rows[0].n).toBe(0);
  });

  it("serializes two first-lead writers without duplicate pipeline or marketing stage", async () => {
    await Promise.all([
      db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'동시 A')`),
      db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'동시 B')`),
    ]);
    expect((await db.query<{ n: number }>("select count(*)::int n from pipelines")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from stages where kind='marketing'")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n).toBe(2);
  });

  it("adds only the missing marketing stage to a preexisting pipeline", async () => {
    await db.exec(`insert into pipelines(id,org_id,name) values('00000000-0000-4000-8000-000000000200','${id.orgA}','기존');
      insert into stages(id,pipeline_id,name,sort_order,kind) values('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000200','기존 미팅',7,'meeting')`);
    await db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'기존 구조 리드')`);
    expect((await db.query<{ name: string; sort_order: number; kind: string }>("select name,sort_order,kind::text kind from stages where id='00000000-0000-4000-8000-000000000201'")).rows[0]).toEqual({ name: "기존 미팅", sort_order: 7, kind: "meeting" });
    expect((await db.query<{ n: number }>("select count(*)::int n from pipelines")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from stages where kind='marketing'")).rows[0].n).toBe(1);
  });

  it("keeps tenant, member assignment, and inactive-member boundaries", async () => {
    await expect(db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardB}','${id.groupB}',gen_random_uuid(),'교차 조직')`)).rejects.toThrow(/projection target unavailable/);
    await actor(db, id.member);
    await expect(db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'남에게 배정',null,null,null,null,null,null,null,null,null,null,null,'${id.owner}')`)).rejects.toThrow(/assignee denied/);
    await db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'내 리드')`);
    await actor(db, id.inactive);
    await expect(db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'비활성')`)).rejects.toThrow(/permission denied/);
  });

  it("rolls the ensured structure back when a downstream projection fails", async () => {
    await db.exec(`create function reject_projection() returns trigger language plpgsql as $$begin raise exception 'fixture projection failure'; end$$;
      create trigger reject_projection before insert on items for each row when (new.title='ROLLBACK') execute function reject_projection()`);
    await expect(db.query(`select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'ROLLBACK')`)).rejects.toThrow(/fixture projection failure/);
    expect((await db.query<{ n: number }>("select count(*)::int n from pipelines")).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from stages")).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n).toBe(0);
  });

  it("turns red when the missing-stage ensure is mutated back to the old failure", async () => {
    const ensureStart = functionSql.indexOf("  -- One initializer per organization.");
    const ensureEnd = functionSql.indexOf("  insert into public.deals", ensureStart);
    expect(ensureStart).toBeGreaterThan(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    const oldFailure = `  select s.id,s.pipeline_id into v_stage,v_pipeline
    from public.stages s join public.pipelines p on p.id=s.pipeline_id
   where p.org_id=p_org_id and s.kind::text='marketing' order by p.id,s.sort_order,s.id limit 1;
  if v_stage is null then raise exception 'marketing stage unavailable' using errcode='22023'; end if;\n`;
    await db.exec(functionSql.slice(0, ensureStart) + oldFailure + functionSql.slice(ensureEnd));
    await expect(db.query(
      `select * from public.create_new_lead('${id.orgA}','${id.boardA}','${id.groupA}',gen_random_uuid(),'RED')`,
    )).rejects.toThrow(/marketing stage unavailable/);
    expect((await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n).toBe(0);
  });
});
