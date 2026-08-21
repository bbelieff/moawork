import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root=path.resolve(import.meta.dirname,"..","..");
const dependencyRoot=process.env.PGLITE_MODULE_ROOT??root;
const {PGlite}=await import(pathToFileURL(path.join(dependencyRoot,"node_modules","@electric-sql","pglite","dist","index.js")).href);
const guard=await readFile(path.join(root,"supabase/migrations/094_migration_apply_guard.sql"),"utf8");
const m118=await readFile(path.join(root,"supabase/migrations/118_bbe178_column_value_and_schedule_dispatch.sql"),"utf8");
const migration=await readFile(path.join(root,"supabase/migrations/122_bbe236_notice_reader_system_value.sql"),"utf8");
const validator118=m118.slice(m118.indexOf("create or replace function public.board_column_validation_is_valid"),m118.indexOf("create table if not exists public.board_item_create_receipts"));
const u=(n)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

async function database(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table orgs(id uuid primary key);create table boards(id uuid primary key,org_id uuid not null,source text not null);
  create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null,key text not null,archived_at timestamptz,is_required boolean not null default false,validation_jsonb jsonb not null default '{}');
  create table items(id uuid primary key,org_id uuid not null,board_id uuid not null);
  create table item_values(org_id uuid not null,item_id uuid not null,column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));`);
 await db.exec(validator118); await db.exec(guard);
 await db.exec(`insert into migration_apply_guard(logical_key,file_name,file_digest,expected_predecessor,executor,thread_id) values('121_bbe236_board_column_date_validator_execute','121_bbe236_board_column_date_validator_execute.sql',repeat('a',64),'120_bbe273_new_lead_full_intake','test','bbe236')`);
 await db.exec(migration); return db;
}

test("notice reader system value is narrow, tenant-bound, and leaves user rows unchanged",async()=>{
 const db=await database(),oa=u(1),ob=u(2),notice=u(3),custom=u(4),foreign=u(5),ni=u(6),ci=u(7),fi=u(8),actor=u(9);
 await db.exec(`insert into orgs values('${oa}'),('${ob}');insert into boards values('${notice}','${oa}','core.default-tab/notice'),('${custom}','${oa}','user'),('${foreign}','${ob}','core.default-tab/notice');insert into items values('${ni}','${oa}','${notice}'),('${ci}','${oa}','${custom}'),('${fi}','${ob}','${foreign}');insert into board_columns(org_id,board_id,key) values('${oa}','${custom}','title');insert into item_values values('${oa}','${ci}','title','"preserve"')`);
 const before=(await db.query("select count(*)::int n,md5(string_agg(item_id::text||':'||column_key||':'||value_jsonb::text,',' order by item_id,column_key)) d from item_values")).rows[0];
 await db.query("insert into item_values values($1,$2,'__notice_reader_ids',$3)",[oa,ni,[actor]]);
 await assert.rejects(db.query("insert into item_values values($1,$2,'__notice_reader_ids',$3)",[oa,ci,[actor]]),/column value validation failed/);
 await assert.rejects(db.query("insert into item_values values($1,$2,'__notice_reader_ids',$3)",[oa,fi,[actor]]),/column value validation failed/);
 await assert.rejects(db.query("insert into item_values values($1,$2,'__notice_reader_ids',$3)",[ob,fi,["not-a-uuid"]]),/column value validation failed/);
 assert.deepEqual((await db.query("select value_jsonb from item_values where item_id=$1 and column_key='title'",[ci])).rows[0].value_jsonb,"preserve");
 assert.equal((await db.query("select count(*)::int n from item_values")).rows[0].n,before.n+1);
 await db.close();
});

test("removing the exact system-key branch makes the production receipt write RED",async()=>{
 const db=await database(),org=u(20),board=u(21),item=u(22),actor=u(23);
 await db.exec(`insert into orgs values('${org}');insert into boards values('${board}','${org}','core.default-tab/notice');insert into items values('${item}','${org}','${board}');`);
 await db.query("insert into item_values values($1,$2,'__notice_reader_ids',$3)",[org,item,[actor]]);
 await db.exec("delete from item_values;"+validator118);
 await assert.rejects(db.query("insert into item_values values($1,$2,'__notice_reader_ids',$3)",[org,item,[actor]]),/column value validation failed/);
 assert.equal((await db.query("select count(*)::int n from item_values")).rows[0].n,0);
 await db.close();
});
