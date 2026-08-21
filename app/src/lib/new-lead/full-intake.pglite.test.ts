import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/120_bbe273_new_lead_full_intake.sql"), "utf8");
const validationMigration = readFileSync(resolve(process.cwd(), "../supabase/migrations/118_bbe178_column_value_and_schedule_dispatch.sql"), "utf8");
const legacyValidationSql = validationMigration.slice(
  validationMigration.indexOf("create or replace function public.board_column_value_is_valid"),
  validationMigration.indexOf("create or replace function public.enforce_required_values_on_item_create"),
);
const hiddenProjectionValidationSql = migration.slice(
  migration.indexOf("create or replace function public.board_column_value_is_valid"),
  migration.indexOf("create or replace function public.guard_new_lead_projection_write"),
);
const functionSql = migration.slice(migration.indexOf("create function public.create_new_lead"), migration.indexOf("revoke all on function public.create_new_lead"));
const projectionSql = migration.slice(
  migration.indexOf("create or replace function public.guard_new_lead_projection_write"),
  migration.indexOf("drop function if exists public.create_new_lead"),
);
const metaFunctionSql = migration.slice(
  migration.indexOf("create or replace function public.update_new_lead_intake_meta"),
  migration.indexOf("revoke all on function public.update_new_lead_intake_meta"),
);
const ids = {
  orgA: "00000000-0000-4000-8000-000000000001", orgB: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010", member: "00000000-0000-4000-8000-000000000011",
  outsider: "00000000-0000-4000-8000-000000000012", boardA: "00000000-0000-4000-8000-000000000020",
  boardB: "00000000-0000-4000-8000-000000000021", groupA: "00000000-0000-4000-8000-000000000030",
  boardLegacy: "00000000-0000-4000-8000-000000000022", groupB: "00000000-0000-4000-8000-000000000031",
  groupLegacy: "00000000-0000-4000-8000-000000000032", request: "00000000-0000-4000-8000-000000000100",
};

async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe("BBE-273 atomic full new-lead intake", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create type public.stage_kind as enum ('marketing','meeting','contract','work','settle','post');
      create table users(id uuid primary key); create table orgs(id uuid primary key,status text);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$
        select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create table boards(id uuid primary key,org_id uuid,source text);
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
      insert into users values('${ids.owner}'),('${ids.member}'),('${ids.outsider}');
      insert into orgs values('${ids.orgA}','active'),('${ids.orgB}','active');
      insert into org_members values ('${ids.orgA}','${ids.owner}','owner','all','active'),('${ids.orgA}','${ids.member}','member','assigned','active'),('${ids.orgB}','${ids.outsider}','owner','all','active');
      insert into boards values('${ids.boardA}','${ids.orgA}','core.default-tab/new-lead'),('${ids.boardB}','${ids.orgB}','core.default-tab/new-lead'),('${ids.boardLegacy}','${ids.orgA}','core.default-tab/new-lead');
      insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}'),('${ids.groupB}','${ids.orgB}','${ids.boardB}'),('${ids.groupLegacy}','${ids.orgA}','${ids.boardLegacy}');
      insert into board_columns(org_id,board_id,key) select '${ids.orgA}','${ids.boardA}',unnest(array[
        'owner','collaborators','applied_on','phone','rep_name','biz_reg_type','industry','revenue_band','sido','sigungu','email','ad_name',
        'absence_notice','consult1_notice','confirm2_notice','feedback_status','recall_at','meeting_at','recontact_on','contract_fee','consult_status','contact_move']);
      insert into board_columns(org_id,board_id,key) select '${ids.orgA}','${ids.boardLegacy}',unnest(array[
        'owner','collaborators','applied_on','phone','rep_name','business_registration_type','industry','revenue_band','region_sido','region_sigungu','email','acquisition_source',
        'absence_notice','consult1_notice','confirm2_notice','feedback_status','recall_at','meeting_at','recontact_on','contract_fee','consult_status','contact_move']);
    `);
    await db.exec(legacyValidationSql);
    await db.exec(hiddenProjectionValidationSql);
    await db.exec(projectionSql);
    await db.exec(functionSql);
    await db.exec(metaFunctionSql);
    await actor(db, ids.owner);
  });

  it("projects and reloads the hosted legacy long-key structural variant", async () => {
    const result = await db.query<{ item_id: string }>(
      `select * from create_new_lead('${ids.orgA}','${ids.boardLegacy}','${ids.groupLegacy}',gen_random_uuid(),'레거시','대표',null,null,'법인',null,null,null,'서울','강남구','소개')`,
    );
    const values = Object.fromEntries((await db.query<{ column_key: string; value_jsonb: unknown }>(
      `select column_key,value_jsonb from item_values where item_id='${result.rows[0].item_id}' and column_key in ('business_registration_type','region_sido','region_sigungu','acquisition_source')`,
    )).rows.map((row) => [row.column_key,row.value_jsonb]));
    expect(values).toEqual({ acquisition_source: "소개", business_registration_type: "법인", region_sigungu: "강남구", region_sido: "서울" });
    expect((await db.query<{ value_source: string }>("select value_source from deal_intake_field_audit where field_key='owner'")).rows[0].value_source).toBe("system");
  });

  it("writes canonical facts, all immediate projections, exact audit sources, and stable replay", async () => {
    const call = `select * from create_new_lead('${ids.orgA}','${ids.boardA}','${ids.groupA}','${ids.request}','테스트 회사','대표','01012345678','A@EXAMPLE.COM','법인','제조업',null,'10억','서울','강남구','검색광고',null,'${ids.member}','테헤란로',array['${ids.owner}']::uuid[])`;
    const first = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>(call);
    const replay = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>(call);
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    const deal = (await db.query<{ assigned_to: string; applied_on: string }>("select assigned_to,applied_on::text from deals")).rows[0];
    expect(deal.assigned_to).toBe(ids.member); expect(deal.applied_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const intake = (await db.query<{ region_sido: string; region_sigungu: string; address_detail: string; acquisition_source: string }>("select region_sido,region_sigungu,address_detail,acquisition_source from deal_intake")).rows[0];
    expect(intake).toEqual({ region_sido: "서울", region_sigungu: "강남구", address_detail: "테헤란로", acquisition_source: "검색광고" });
    const values = Object.fromEntries((await db.query<{ column_key: string; value_jsonb: unknown }>("select column_key,value_jsonb from item_values")).rows.map((row) => [row.column_key,row.value_jsonb]));
    expect(values).toMatchObject({ biz_reg_type: "법인", sido: "서울", sigungu: "강남구", ad_name: "검색광고", consult_status: "상담 전", contact_move: "컨택 대기", absence_notice: "해당 없음" });
    expect(Object.keys(values)).toHaveLength(19);
    const sources = (await db.query<{ field_key: string; value_source: string }>("select field_key,value_source from deal_intake_field_audit")).rows;
    expect(sources.find((row) => row.field_key === "title")?.value_source).toBe("manual");
    expect(sources.find((row) => row.field_key === "applied_on")?.value_source).toBe("system");
    expect(sources.find((row) => row.field_key === "owner")?.value_source).toBe("manual");
    await db.exec("update deal_intake set region_sido='부산',region_sigungu='해운대구',acquisition_source='소개' where true");
    const refreshed = Object.fromEntries((await db.query<{ column_key: string; value_jsonb: unknown }>("select column_key,value_jsonb from item_values where column_key in ('sido','sigungu','ad_name')")).rows.map((row) => [row.column_key,row.value_jsonb]));
    expect(refreshed).toEqual({ ad_name: "소개", sido: "부산", sigungu: "해운대구" });
    await expect(db.exec(`update item_values set value_jsonb='"조작"'::jsonb where column_key='sido'`)).rejects.toThrow(/require update_new_lead_fields/);
    await expect(db.exec(`update item_values set value_jsonb='"${ids.owner}"'::jsonb where column_key='owner'`)).rejects.toThrow(/require update_new_lead_fields/);

    const customBoard = "00000000-0000-4000-8000-000000000023";
    const customGroup = "00000000-0000-4000-8000-000000000033";
    const customItem = "00000000-0000-4000-8000-000000000043";
    await db.exec(`
      insert into boards values('${customBoard}','${ids.orgA}','customer.custom');
      insert into board_groups values('${customGroup}','${ids.orgA}','${customBoard}');
      insert into board_columns(org_id,board_id,key) values('${ids.orgA}','${customBoard}','rep_name');
      insert into items(id,org_id,board_id,group_id,title,deal_id) values('${customItem}','${ids.orgA}','${customBoard}','${customGroup}','사용자 보드','${first.rows[0].deal_id}');
      insert into item_values(org_id,item_id,column_key,value_jsonb) values('${ids.orgA}','${customItem}','rep_name','"독립 값"'::jsonb);
    `);
    expect((await db.query<{ value_jsonb: string }>(`select value_jsonb#>>'{}' value_jsonb from item_values where item_id='${customItem}'`)).rows[0].value_jsonb).toBe("독립 값");
  });

  it("fails closed for cross-org targets, unauthorized assignment, and collaborator membership", async () => {
    await expect(db.query(`select * from create_new_lead('${ids.orgA}','${ids.boardB}','${ids.groupB}',gen_random_uuid(),'교차')`)).rejects.toThrow(/projection target unavailable/);
    await actor(db, ids.member);
    await expect(db.query(`select * from create_new_lead('${ids.orgA}','${ids.boardA}','${ids.groupA}',gen_random_uuid(),'배정',null,null,null,null,null,null,null,null,null,null,null,'${ids.owner}')`)).rejects.toThrow(/assignee denied/);
    await actor(db, ids.owner);
    await expect(db.query(`select * from create_new_lead('${ids.orgA}','${ids.boardA}','${ids.groupA}',gen_random_uuid(),'협업',null,null,null,null,null,null,null,null,null,null,null,null,null,array['${ids.outsider}']::uuid[])`)).rejects.toThrow(/collaborator unavailable/);
    expect((await db.query<{ n: number }>("select count(*)::int n from deals")).rows[0].n).toBe(0);
  });

  it("audits and replays post-create owner, collaborator, date, and address corrections", async () => {
    const created = (await db.query<{ deal_id: string; item_id: string }>(`select * from create_new_lead('${ids.orgA}','${ids.boardA}','${ids.groupA}',gen_random_uuid(),'수정 리드')`)).rows[0];
    const request = "00000000-0000-4000-8000-000000000199";
    const call = `select * from update_new_lead_intake_meta('${ids.orgA}','${created.deal_id}','${request}',jsonb_build_object('owner','${ids.member}','collaborators',jsonb_build_array('${ids.owner}'),'applied_on','2026-08-22','address_detail','수정 주소'))`;
    const first = await db.query<{ changed_fields: string[]; replayed: boolean }>(call);
    const replay = await db.query<{ changed_fields: string[]; replayed: boolean }>(call);
    expect(first.rows[0].changed_fields.sort()).toEqual(["address_detail","applied_on","collaborators","owner"]);
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    expect((await db.query<{ assigned_to: string; applied_on: string }>(`select assigned_to,applied_on::text from deals where id='${created.deal_id}'`)).rows[0]).toEqual({ assigned_to: ids.member, applied_on: "2026-08-22" });
    expect((await db.query<{ address_detail: string }>(`select address_detail from deal_intake where deal_id='${created.deal_id}'`)).rows[0].address_detail).toBe("수정 주소");
    expect((await db.query<{ n: number }>(`select count(*)::int n from deal_intake_field_audit where request_id='${request}'`)).rows[0].n).toBe(4);
  });

  it("turns red when the board-key projection guard is removed", async () => {
    const mutated = functionSql
      .replace("create function public.create_new_lead", "create or replace function public.create_new_lead")
      .replace("'biz_reg_type',to_jsonb", "'business_registration_type',to_jsonb");
    await db.exec(mutated);
    await db.query(`select * from create_new_lead('${ids.orgA}','${ids.boardA}','${ids.groupA}',gen_random_uuid(),'RED',null,null,null,'법인')`);
    await expect(async () => {
      expect((await db.query<{ n: number }>("select count(*)::int n from item_values where column_key='biz_reg_type'")).rows[0].n).toBe(1);
    }).rejects.toThrow();
  });
});
