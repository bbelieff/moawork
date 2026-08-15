import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { WorkManagementSource } from "@/lib/repo/supabase/workManagementSource";

const actor = "00000000-0000-4000-8000-000000000001";
const org = "00000000-0000-4000-8000-000000000002";
const otherOrg = "00000000-0000-4000-8000-000000000003";
const board = "00000000-0000-4000-8000-000000000004";
const item = "00000000-0000-4000-8000-000000000005";
const group = "00000000-0000-4000-8000-000000000006";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create type public.member_role as enum ('owner','admin','member');
    create type public.member_scope as enum ('all','assigned');
    create type public.field_type as enum ('title','person','text','url','select','multiselect','number','file','money','email','phone','date','datetime','date_range','longtext','percent','status','checkbox','people','calc');
    create table orgs(id uuid primary key);
    create table users(id uuid primary key,name text);
    create table org_members(org_id uuid,user_id uuid,role member_role,scope member_scope,status text,created_at timestamptz default now(),primary key(org_id,user_id));
    create table boards(id uuid primary key,org_id uuid,name text,description text,icon text,source text,sort_order int default 0,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create table board_groups(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,name text,color text,sort_order int default 0);
    create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,key text,label text,type field_type,source text,sort_order int default 0,is_readonly boolean default false,unique(board_id,key));
    create table items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,title text,assigned_to uuid,sort_order int default 0,created_at timestamptz default now(),updated_at timestamptz default now());
    create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    create table board_views(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,user_id uuid,name text,kind text,filters_jsonb jsonb default '{}',shared boolean default false);
    create table audit_logs(id uuid primary key default gen_random_uuid(),org_id uuid,actor uuid,action text,target_type text,target_id uuid,meta jsonb,at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select '${actor}'::uuid $$;
    create function public.is_org_member(candidate uuid) returns boolean language sql stable as $$ select candidate='${org}'::uuid $$;
    create function public.org_role(candidate uuid) returns member_role language sql stable as $$ select role from org_members where org_id=candidate and user_id=auth.uid() $$;
    insert into orgs values('${org}'),('${otherOrg}'); insert into users values('${actor}','Owner');
    insert into org_members values('${org}','${actor}','owner','all','active',now());
    insert into boards(id,org_id,name,source) values('${board}','${org}','Work','core.default-tab/contract-work');
    insert into board_groups(id,org_id,board_id,name,color) values('${group}','${org}','${board}','Ready','#fff');
    insert into items(id,org_id,board_id,group_id,title,assigned_to) values('${item}','${org}','${board}','${group}','Task','${actor}');
  `);
  const sql = await readFile(resolve(process.cwd(), "../supabase/migrations/068_work_management_commands.sql"), "utf8");
  await db.exec(sql);
  return db;
}

describe("068 work-management database boundary", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  it("commits mutation, receipt, audit and outbox atomically and replays once", async () => {
    const db = await database(); opened.push(db);
    const request = "00000000-0000-4000-8000-000000000007";
    const call = `select execute_work_management_command('${org}','${board}','${item}','set_due_date',0,'${request}','{"due_date":"2026-08-20"}') result`;
    const first = await db.query<{ result: { replayed: boolean; version: number } }>(call);
    const replay = await db.query<{ result: { replayed: boolean; version: number } }>(call);
    expect(first.rows[0].result).toMatchObject({ replayed: false, version: 1 });
    expect(replay.rows[0].result).toMatchObject({ replayed: true, version: 1 });
    const counts = await db.query<{ receipts: number; outbox: number; audit: number }>("select (select count(*)::int from work_command_receipts) receipts,(select count(*)::int from work_command_outbox) outbox,(select count(*)::int from audit_logs) audit");
    expect(counts.rows[0]).toEqual({ receipts: 1, outbox: 1, audit: 1 });
    const source = new WorkManagementSource({
      rpc: async () => {
        const result = await db.query<{ value: unknown }>(`select read_work_management_board('${org}') value`);
        return { data: result.rows[0].value, error: null };
      },
    });
    const snapshot = await source.load(org);
    expect(snapshot.board.id).toBe(board);
    expect(snapshot.items[0]).toMatchObject({ id: item, dueDate: "2026-08-20", version: 1 });
  }, 15_000);

  it("fails closed across tenants without partial outbox", async () => {
    const db = await database(); opened.push(db);
    await expect(db.query(`select execute_work_management_command('${otherOrg}','${board}',null,'create_group',0,'00000000-0000-4000-8000-000000000008','{"name":"No"}')`)).rejects.toThrow("membership");
    const count = await db.query<{ count: number }>("select count(*)::int count from work_command_outbox");
    expect(count.rows[0].count).toBe(0);
  }, 15_000);
});
