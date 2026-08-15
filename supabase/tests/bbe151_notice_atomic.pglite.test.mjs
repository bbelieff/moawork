import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path, { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..");
const { PGlite }=await import(pathToFileURL(path.join(root,"node_modules","@electric-sql","pglite","dist","index.js")).href);

const migration = readFileSync(join(root, "supabase/migrations/066_notice_atomic_contract.sql"), "utf8");
const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create type field_type as enum('text','number','date','datetime','select','multiselect','phone','email','file','person','url','checkbox','longtext','people','calc','status','money');
    create type field_source as enum('in','lk','act','auto','calc');
    create table orgs(id uuid primary key); create table users(id uuid primary key);
    create table org_members(org_id uuid,user_id uuid,status text,primary key(org_id,user_id));
    create function is_org_member(p_org uuid) returns boolean language sql stable as $$select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
    create table boards(id uuid primary key default gen_random_uuid(),org_id uuid,name text,description text,icon text,is_system boolean default false,source text,sort_order int,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create table board_groups(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,name text,color text,sort_order int);
    create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,key text,label text,type field_type,source field_source,options_jsonb jsonb,sort_order int,width int,right_pinned boolean,move_rule_jsonb jsonb,is_readonly boolean,unique(board_id,key));
    create table items(id uuid primary key,org_id uuid,board_id uuid,title text);
    create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));`);
  await db.exec(migration);
  return db;
}

test("concurrent first ensure converges on one complete board", async () => {
    const db=await database(), org=u(1), actor=u(2);
    await db.exec(`insert into orgs values('${org}');insert into users values('${actor}');insert into org_members values('${org}','${actor}','active');select set_config('request.jwt.claim.sub','${actor}',false);`);
    const definition={source:"core.default-tab/notice",name:"공지",description:"",icon:"N",groups:[{name:"g",color:"#fff",order:0}],columns:[{key:"status",label:"상태",type:"status",source:"act",order:0,options:[],moveTo:{done:"g"}}]};
    await Promise.all([db.query("select * from bbe151_ensure_notice_tab($1)",[org]),db.query("select * from bbe151_ensure_notice_tab($1)",[org])]);
    assert.equal((await db.query("select count(*)::int n from boards where org_id=$1 and source='core.default-tab/notice'",[org])).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from board_groups",[])).rows[0].n,5);
    assert.equal((await db.query("select count(*)::int n from board_columns",[])).rows[0].n,10);
  });
test("member cannot inject a hostile canonical definition", async () => {
    const db=await database(),org=u(8),actor=u(9);
    await db.exec(`insert into orgs values('${org}');insert into users values('${actor}');insert into org_members values('${org}','${actor}','active');select set_config('request.jwt.claim.sub','${actor}',false);`);
    await assert.rejects(db.query("select * from bbe151_ensure_notice_tab($1,$2)",[org,{source:"core.default-tab/notice",name:"hostile"}]),/bbe151_ensure_notice_tab/);
    assert.equal((await db.query("select count(*)::int n from boards where org_id=$1",[org])).rows[0].n,0);
  });
test("incomplete canonical board is reconciled from the database-owned definition", async () => {
    const db=await database(),org=u(10),actor=u(11),board=u(12);
    await db.exec(`insert into orgs values('${org}');insert into users values('${actor}');insert into org_members values('${org}','${actor}','active');select set_config('request.jwt.claim.sub','${actor}',false);
      insert into boards(id,org_id,name,source) values('${board}','${org}','hostile','core.default-tab/notice');
      insert into board_groups(org_id,board_id,name,color,sort_order) values('${org}','${board}','incomplete','#000',99);
      insert into board_columns(org_id,board_id,key,label,type,source,options_jsonb,sort_order,width,right_pinned,move_rule_jsonb,is_readonly) values('${org}','${board}','status','hostile','status','act','[]',99,1,false,'{}',false);`);
    await db.query("select * from bbe151_ensure_notice_tab($1)",[org]);
    assert.equal((await db.query("select count(*)::int n from board_groups where board_id=$1",[board])).rows[0].n,6);
    assert.equal((await db.query("select count(*)::int n from board_columns where board_id=$1",[board])).rows[0].n,10);
    const status=(await db.query("select label,options_jsonb,move_rule_jsonb from board_columns where board_id=$1 and key='status'",[board])).rows[0];
    assert.notEqual(status.label,"hostile");
    assert.ok(Array.isArray(status.options_jsonb?.options) && status.options_jsonb.options.length>0);
    assert.ok(status.move_rule_jsonb && Object.keys(status.move_rule_jsonb).length>0);
  });
test("two first readers are both retained and read_count becomes two", async () => {
    const db=await database(),org=u(3),a=u(4),b=u(5),board=u(6),item=u(7);
    await db.exec(`insert into orgs values('${org}');insert into users values('${a}'),('${b}');insert into org_members values('${org}','${a}','active'),('${org}','${b}','active');insert into boards(id,org_id,name,source) values('${board}','${org}','공지','core.default-tab/notice');insert into items values('${item}','${org}','${board}','공지');insert into item_values values('${org}','${item}','audience','["${a}","${b}"]');`);
    await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);select bbe151_mark_notice_read('${org}','${item}');select set_config('request.jwt.claim.sub','${b}',false);select bbe151_mark_notice_read('${org}','${item}');`);
    const values=await db.query("select column_key,value_jsonb from item_values where item_id=$1",[item]);
    assert.deepEqual(values.rows.find((r)=>r.column_key==='__notice_reader_ids').value_jsonb,[a,b]);
    assert.equal(values.rows.find((r)=>r.column_key==='read_count').value_jsonb,2);
  });
