import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(dependencyRoot,"node_modules","@electric-sql","pglite","dist","index.js")).href);
const migration = await readFile(path.join(root,"supabase","migrations","089_bbe176_column_metadata_canonical.sql"),"utf8");
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

async function database({ healthy=false }={}) {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create role anon nologin; create role authenticated nologin;
    create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')$$;
    create function public.digest(p text,a text) returns bytea language sql immutable strict as $$select public.digest(convert_to(p,'utf8'),a)$$;
    create type public.member_role as enum('owner','admin','team_lead','member');
    create type public.member_scope as enum('all','department','assigned');
    create type public.field_type as enum('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','people','url','checkbox','money','calc');
    create type public.field_source as enum('auto','in','act','msg','lk','calc');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.orgs(id uuid primary key,status text not null default 'active'); create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,role public.member_role,scope public.member_scope,status text,primary key(org_id,user_id));
    create function public.is_org_member(p uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from org_members where org_id=p and user_id=auth.uid() and status='active')$$;
    create function public.org_role(p uuid) returns public.member_role language sql stable security definer set search_path=public as $$select role from org_members where org_id=p and user_id=auth.uid() and status='active'$$;
    create function public.effective_permission(p uuid,k text) returns boolean language sql stable security definer set search_path=public as $$select public.is_org_member(p) and k in ('work.view_tabs','work.item_upsert')$$;
    create table public.boards(id uuid primary key,org_id uuid references orgs(id));
    create table public.board_columns(id uuid primary key default gen_random_uuid(),org_id uuid references orgs(id),board_id uuid references boards(id),key text,label text,type public.field_type,options_jsonb jsonb,sort_order int default 0,width int,source public.field_source default 'in',right_pinned boolean default false,move_rule_jsonb jsonb,is_readonly boolean default false,unique(board_id,key)
      ${healthy ? ",description text,is_required boolean not null default false,validation_jsonb jsonb not null default '{}',edit_policy_jsonb jsonb not null default '{}',view_policy_jsonb jsonb not null default '{}',summary_hidden boolean not null default false,wrap_mode text not null default 'truncate',archived_at timestamptz,deleted_by uuid" : ""});
    create table public.items(id uuid primary key,org_id uuid references orgs(id),board_id uuid references boards(id),assigned_to uuid references users(id));
    create table public.item_values(org_id uuid references orgs(id),item_id uuid references items(id),column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    alter table board_columns enable row level security; alter table item_values enable row level security;
    create policy bcols_rw on board_columns for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    create policy itemvals_rw on item_values for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    grant usage on schema public,auth to authenticated; grant select,insert,update,delete on board_columns,item_values to authenticated;
    insert into orgs values('${id(1)}','active'),('${id(2)}','active'); insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}');
    insert into org_members values('${id(1)}','${id(10)}','owner','all','active'),('${id(1)}','${id(11)}','member','assigned','active'),('${id(2)}','${id(12)}','owner','all','active');
    insert into boards values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');
    insert into board_columns(id,org_id,board_id,key,label,type,sort_order) values('${id(30)}','${id(1)}','${id(20)}','amount','Amount','text',0);
    insert into items values('${id(40)}','${id(1)}','${id(20)}','${id(11)}'),('${id(41)}','${id(1)}','${id(20)}','${id(10)}');
    insert into item_values values('${id(1)}','${id(40)}','amount','"12.5"'),('${id(1)}','${id(41)}','amount','"bad"');
  `);
  return db;
}
async function auth(db,user) { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`); }
async function resetAuth(db) { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
async function rejectsCode(promise, code) { await assert.rejects(promise,(error) => error?.code===code); }
async function assertContiguous(db) {
  const row=(await db.query("select count(*)::int n,count(distinct sort_order)::int d,coalesce(min(sort_order),0)::int lo,coalesce(max(sort_order),-1)::int hi from board_columns where archived_at is null")).rows[0];
  assert.equal(row.d,row.n); if(row.n>0) assert.deepEqual([row.lo,row.hi],[0,row.n-1]);
}

test("089 installs twice from missing and healthy schemas without customer UPDATE", async () => {
  for (const healthy of [false,true]) {
    const db=await database({healthy});
    const before=(await db.query("select id,key,label,type::text,sort_order from board_columns order by id")).rows;
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual((await db.query("select id,key,label,type::text,sort_order from board_columns order by id")).rows,before);
    assert.equal((await db.query("select count(*)::int n from board_column_audit")).rows[0].n,0);
    await db.close();
  }
});

test("commands are atomic, replay-safe, policy-bound, audited, and preserve archived values", async () => {
  const db=await database(); await db.exec(migration); await auth(db,id(10));
  let dry=(await db.query("select public.board_column_type_dry_run($1,$2,$3,'number') result",[id(1),id(20),id(30)])).rows[0].result;
  assert.equal(dry.safe,false); assert.equal(dry.invalidValues,1);
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'type_commit',$4,$5)",[id(1),id(20),id(30),id(100),{targetType:"number",fingerprint:dry.fingerprint}]),/unsafe column type conversion/);
  await resetAuth(db); await db.exec(`update item_values set value_jsonb='"13"' where item_id='${id(41)}'`); await auth(db,id(10));
  dry=(await db.query("select public.board_column_type_dry_run($1,$2,$3,'number') result",[id(1),id(20),id(30)])).rows[0].result;
  const first=(await db.query("select execute_board_column_command($1,$2,$3,'type_commit',$4,$5) result",[id(1),id(20),id(30),id(101),{targetType:"number",fingerprint:dry.fingerprint}])).rows[0].result;
  const replay=(await db.query("select execute_board_column_command($1,$2,$3,'type_commit',$4,$5) result",[id(1),id(20),id(30),id(101),{targetType:"number",fingerprint:dry.fingerprint}])).rows[0].result;
  assert.equal(first.replayed,false); assert.equal(replay.replayed,true);
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'rename',$4,$5)",[id(1),id(20),id(30),id(101),{label:"Mismatch"}]),/payload mismatch/);
  await db.query("select execute_board_column_command($1,$2,$3,'archive',$4,'{}')",[id(1),id(20),id(30),id(102)]);
  await resetAuth(db);
  assert.equal((await db.query("select count(*)::int n from item_values")).rows[0].n,2);
  await auth(db,id(10));
  await db.query("select execute_board_column_command($1,$2,$3,'restore',$4,'{}')",[id(1),id(20),id(30),id(103)]);
  assert.equal((await db.query("select count(*)::int n from board_column_audit")).rows[0].n,3);
  await resetAuth(db); await db.exec(`update item_values set value_jsonb='14' where item_id='${id(41)}'`); await auth(db,id(10));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'type_commit',$4,$5)",[id(1),id(20),id(30),id(104),{targetType:"money",fingerprint:dry.fingerprint}]),/changed after dry run/);
  await db.exec("reset role"); await auth(db,id(11));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'rename',$4,$5)",[id(1),id(20),id(30),id(105),{label:"No"}]),/permission denied/);
  await db.close();
});

test("create-at, duplicate, settings, rename, and reorder preserve a contiguous structure", async () => {
  const db=await database(); await db.exec(migration); await auth(db,id(10));
  const created=(await db.query("select execute_board_column_command($1,$2,null,'create_at',$3,$4) result",[id(1),id(20),id(110),{position:0,key:"status",label:"Status",type:"select"}])).rows[0].result;
  assert.equal(created.column.key,"status");
  assert.deepEqual((await db.query("select key,sort_order from board_columns order by sort_order")).rows,[{key:"status",sort_order:0},{key:"amount",sort_order:1}]);
  const copied=(await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5) result",[id(1),id(20),id(30),id(111),{position:1,key:"amount_copy",label:"Amount copy"}])).rows[0].result;
  assert.equal((await db.query("select count(*)::int n from item_values where column_key='amount_copy'")).rows[0].n,2);
  await db.query("select execute_board_column_command($1,$2,$3,'settings',$4,$5)",[id(1),id(20),copied.columnId,id(112),{required:true,wrapMode:"wrap",viewPolicy:{roles:["owner"]}}]);
  await db.query("select execute_board_column_command($1,$2,$3,'rename',$4,$5)",[id(1),id(20),copied.columnId,id(113),{label:"Copied"}]);
  await db.query("select execute_board_column_command($1,$2,$3,'reorder',$4,$5)",[id(1),id(20),id(30),id(114),{position:0}]);
  assert.deepEqual((await db.query("select sort_order from board_columns where archived_at is null order by sort_order")).rows,[{sort_order:0},{sort_order:1},{sort_order:2}]);
  await assert.rejects(db.exec("insert into board_columns(org_id,board_id,key,label,type) values('"+id(1)+"','"+id(20)+"','direct','Direct','text')"),/permission denied/);
  await db.exec("reset role"); await auth(db,id(11));
  assert.equal((await db.query("select count(*)::int n from board_columns where key='amount_copy'")).rows[0].n,0);
  await db.close();
});

test("board serialization keeps archive/create/restore, clamped duplicate, and distinct requests contiguous", async () => {
  const db=await database(); await db.exec(migration); await auth(db,id(10));
  await db.query("select execute_board_column_command($1,$2,$3,'archive',$4,'{}')",[id(1),id(20),id(30),id(120)]);
  const created=(await db.query("select execute_board_column_command($1,$2,null,'create_at',$3,$4) result",[id(1),id(20),id(121),{position:0,key:"between",label:"Between",type:"text"}])).rows[0].result;
  await db.query("select execute_board_column_command($1,$2,$3,'restore',$4,$5)",[id(1),id(20),id(30),id(122),{position:0}]);
  assert.deepEqual((await db.query("select key,sort_order from board_columns where archived_at is null order by sort_order")).rows,[{key:"amount",sort_order:0},{key:"between",sort_order:1}]);
  await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5)",[id(1),id(20),id(30),id(123),{position:-20,key:"negative"}]);
  await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5)",[id(1),id(20),id(30),id(124),{position:999,key:"oversized"}]);
  await assertContiguous(db);
  const concurrent=await Promise.all([
    db.query("select execute_board_column_command($1,$2,null,'create_at',$3,$4)",[id(1),id(20),id(125),{position:1,key:"parallel_a",label:"A",type:"text"}]),
    db.query("select execute_board_column_command($1,$2,null,'create_at',$3,$4)",[id(1),id(20),id(126),{position:1,key:"parallel_b",label:"B",type:"text"}]),
  ]);
  assert.equal(concurrent.length,2); await assertContiguous(db);
  await Promise.all([
    db.query("select execute_board_column_command($1,$2,$3,'reorder',$4,$5)",[id(1),id(20),created.columnId,id(127),{position:0}]),
    db.query("select execute_board_column_command($1,$2,$3,'reorder',$4,$5)",[id(1),id(20),id(30),id(128),{position:999}]),
  ]);
  await assertContiguous(db); await db.close();
});

test("invalid metadata allowlists fail atomically with SQLSTATE 22023", async () => {
  const db=await database(); await db.exec(migration); await auth(db,id(10));
  const invalidPayloads=[
    {validation:{unknown:true}},
    {validation:{minLength:-1}},
    {validation:{min:10,max:2}},
    {validation:{allowedValues:[{"nested":true}]}},
    {editPolicy:{roles:["superadmin"]}},
    {editPolicy:{roles:"owner"}},
    {viewPolicy:{scopes:["global"]}},
    {viewPolicy:{userIds:["not-a-uuid"]}},
    {viewPolicy:{unknown:[]}},
  ];
  for (let index=0;index<invalidPayloads.length;index++) {
    await rejectsCode(db.query("select execute_board_column_command($1,$2,$3,'settings',$4,$5)",[id(1),id(20),id(30),id(140+index),invalidPayloads[index]]),"22023");
  }
  assert.deepEqual((await db.query("select validation_jsonb,edit_policy_jsonb,view_policy_jsonb from board_columns where id=$1",[id(30)])).rows,[{validation_jsonb:{},edit_policy_jsonb:{},view_policy_jsonb:{}}]);
  assert.equal((await db.query("select count(*)::int n from board_column_audit where request_id::text like '10000000-0000-4000-8000-00000000014%'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from board_column_command_receipts where request_id::text like '10000000-0000-4000-8000-00000000014%'")).rows[0].n,0);
  await db.close();
});
