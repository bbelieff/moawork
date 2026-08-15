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
    create function org_role(p_org uuid) returns text language sql stable as $$select 'member'::text$$;
    create table boards(id uuid primary key default gen_random_uuid(),org_id uuid,name text,description text,icon text,is_system boolean default false,source text,sort_order int,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create table board_groups(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,name text,color text,sort_order int);
    create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,key text,label text,type field_type,source field_source,options_jsonb jsonb,sort_order int,width int,right_pinned boolean,move_rule_jsonb jsonb,is_readonly boolean,unique(board_id,key));
    create table items(id uuid primary key,org_id uuid,board_id uuid,group_id uuid references board_groups(id) on delete set null,title text);
    create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    create function read_permission_scoped_work_items(p_org uuid,p_view uuid default null) returns jsonb language sql stable as $$select jsonb_build_object('itemIds',coalesce(jsonb_agg(id),'[]'::jsonb)) from items where org_id=p_org and title<>'scope-hidden'$$;`);
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
    assert.equal((await db.query("select count(*)::int n from board_groups where board_id=$1",[board])).rows[0].n,5);
    assert.equal((await db.query("select count(*)::int n from board_columns where board_id=$1",[board])).rows[0].n,10);
    const status=(await db.query("select label,options_jsonb,move_rule_jsonb from board_columns where board_id=$1 and key='status'",[board])).rows[0];
    assert.notEqual(status.label,"hostile");
    assert.ok(Array.isArray(status.options_jsonb?.options) && status.options_jsonb.options.length>0);
    assert.ok(status.move_rule_jsonb && Object.keys(status.move_rule_jsonb).length>0);
  });
test("hostile full-count and extra structure converge exactly without losing item values", async () => {
    const db=await database(),org=u(13),actor=u(14),board=u(15),item=u(16);
    await db.exec(`insert into orgs values('${org}');insert into users values('${actor}');insert into org_members values('${org}','${actor}','active');select set_config('request.jwt.claim.sub','${actor}',false);
      insert into boards(id,org_id,name,description,icon,source) values('${board}','${org}','hostile','hostile','X','core.default-tab/notice');
      insert into board_groups(org_id,board_id,name,color,sort_order) select '${org}','${board}','hostile-'||n,'#000',n from generate_series(1,6) n;
      insert into board_columns(org_id,board_id,key,label,type,source,sort_order,width,right_pinned,is_readonly) select '${org}','${board}','hostile_'||n,'hostile','text','in',n,1,false,false from generate_series(1,11) n;`);
    const hostileGroup=(await db.query("select id from board_groups where board_id=$1 order by sort_order limit 1",[board])).rows[0].id;
    await db.query("insert into items(id,org_id,board_id,group_id,title) values($1,$2,$3,$4,'preserve')",[item,org,board,hostileGroup]);
    await db.query("insert into item_values(org_id,item_id,column_key,value_jsonb) values($1,$2,'hostile_1',$3)",[org,item,{kept:true}]);
    await db.query("select * from bbe151_ensure_notice_tab($1)",[org]);
    const metadata=(await db.query("select name,description,icon,is_system from boards where id=$1",[board])).rows[0];
    assert.deepEqual(metadata,{name:"공지사항",description:"공문과 지원사업 공지를 그룹별로 관리합니다.",icon:"📢",is_system:true});
    assert.equal((await db.query("select count(*)::int n from board_groups where board_id=$1",[board])).rows[0].n,5);
    assert.equal((await db.query("select count(*)::int n from board_columns where board_id=$1",[board])).rows[0].n,10);
    assert.ok((await db.query("select group_id from items where id=$1",[item])).rows[0].group_id);
    assert.deepEqual((await db.query("select value_jsonb from item_values where item_id=$1 and column_key='hostile_1'",[item])).rows[0].value_jsonb,{kept:true});
  });
test("only D24-visible, targeted, currently published notices gain receipts", async () => {
    const db=await database(),org=u(20),actor=u(21),other=u(22),board=u(23);
    const ids=[u(24),u(25),u(26),u(27),u(28),u(29)];
    await db.exec(`insert into orgs values('${org}');insert into users values('${actor}'),('${other}');insert into org_members values('${org}','${actor}','active'),('${org}','${other}','active');select set_config('request.jwt.claim.sub','${actor}',false);insert into boards(id,org_id,name,source) values('${board}','${org}','notice','core.default-tab/notice');`);
    await db.query("insert into items(id,org_id,board_id,title) values($1,$7,$8,'visible'),($2,$7,$8,'target-hidden'),($3,$7,$8,'manager-hidden'),($4,$7,$8,'scheduled-hidden'),($5,$7,$8,'ended-hidden'),($6,$7,$8,'scope-hidden')",[...ids,org,board]);
    const values=[
      [ids[0],'audience',[actor]],[ids[1],'audience',[other]],[ids[2],'audience','notice-audience-managers'],
      [ids[3],'audience',[actor]],[ids[3],'published_at','2999-01-01'],[ids[4],'audience',[actor]],[ids[4],'ended_at','2000-01-01'],[ids[5],'audience',[actor]],
    ];
    for (const [item,key,value] of values) await db.query("insert into item_values(org_id,item_id,column_key,value_jsonb) values($1,$2,$3,$4)",[org,item,key,JSON.stringify(value)]);
    for (const id of ids) await db.query("select bbe151_mark_notice_read($1,$2)",[org,id]);
    const receipts=await db.query("select item_id,column_key,value_jsonb from item_values where column_key in ('__notice_reader_ids','read_count') order by item_id,column_key");
    assert.equal(receipts.rows.length,2);
    assert.ok(receipts.rows.every((row)=>row.item_id===ids[0]));
    assert.equal(receipts.rows.find((row)=>row.column_key==='read_count').value_jsonb,1);
  });
test("two first readers are both retained and read_count becomes two", async () => {
    const db=await database(),org=u(3),a=u(4),b=u(5),board=u(6),item=u(7);
    await db.exec(`insert into orgs values('${org}');insert into users values('${a}'),('${b}');insert into org_members values('${org}','${a}','active'),('${org}','${b}','active');insert into boards(id,org_id,name,source) values('${board}','${org}','공지','core.default-tab/notice');insert into items(id,org_id,board_id,title) values('${item}','${org}','${board}','공지');insert into item_values values('${org}','${item}','audience','["${a}","${b}"]');`);
    await db.exec(`select set_config('request.jwt.claim.sub','${a}',false);select bbe151_mark_notice_read('${org}','${item}');select set_config('request.jwt.claim.sub','${b}',false);select bbe151_mark_notice_read('${org}','${item}');`);
    const values=await db.query("select column_key,value_jsonb from item_values where item_id=$1",[item]);
    assert.deepEqual(values.rows.find((r)=>r.column_key==='__notice_reader_ids').value_jsonb,[a,b]);
    assert.equal(values.rows.find((r)=>r.column_key==='read_count').value_jsonb,2);
  });
