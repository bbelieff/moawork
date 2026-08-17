import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const recovery = await readFile(path.join(root, "supabase", "migrations", "091_bbe176_hosted_order_drift_recovery.sql"), "utf8");
const canonical = await readFile(path.join(root, "supabase", "migrations", "089_bbe176_column_metadata_canonical.sql"), "utf8");
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function database({ corrupted = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')$$;
    create function public.digest(p text,a text) returns bytea language sql immutable strict as $$select public.digest(convert_to(p,'utf8'),a)$$;
    create type public.member_role as enum('owner','admin','team_lead','member');
    create type public.member_scope as enum('all','department','assigned');
    create type public.field_type as enum('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','people','url','checkbox','money','calc');
    create type public.field_source as enum('auto','in','act','msg','lk','calc');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.orgs(id uuid primary key,status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid references orgs(id) on delete cascade,user_id uuid,role public.member_role,scope public.member_scope,status text,primary key(org_id,user_id));
    create function public.is_org_member(p uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from org_members where org_id=p and user_id=auth.uid() and status='active')$$;
    create function public.org_role(p uuid) returns public.member_role language sql stable security definer set search_path=public as $$select role from org_members where org_id=p and user_id=auth.uid() and status='active'$$;
    create function public.effective_permission(p uuid,k text) returns boolean language sql stable security definer set search_path=public as $$select public.is_org_member(p)$$;
    create table public.boards(id uuid primary key,org_id uuid references orgs(id) on delete cascade);
    create table public.board_columns(
      id uuid primary key, org_id uuid references orgs(id) on delete cascade,
      board_id uuid references boards(id) on delete cascade, key text, label text,
      type public.field_type, options_jsonb jsonb, sort_order int not null default 0,
      width int, source public.field_source default 'in', right_pinned boolean default false,
      move_rule_jsonb jsonb, is_readonly boolean default false, unique(board_id,key)
    );
    create table public.items(id uuid primary key,org_id uuid references orgs(id) on delete cascade,board_id uuid references boards(id) on delete cascade,assigned_to uuid references users(id));
    create table public.item_values(org_id uuid references orgs(id) on delete cascade,item_id uuid references items(id) on delete cascade,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    alter table board_columns enable row level security; alter table item_values enable row level security;
    create policy bcols_rw on board_columns for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    create policy itemvals_rw on item_values for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    grant usage on schema public,auth to authenticated; grant select,insert,update,delete on board_columns,item_values to authenticated;
    insert into orgs values('${id(1)}','active'),('${id(2)}','active'); insert into users values('${id(10)}');
    insert into org_members values('${id(1)}','${id(10)}','owner','all','active');
    insert into boards values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');
    insert into board_columns(id,org_id,board_id,key,label,type,sort_order) values
      ('${id(32)}','${id(1)}','${id(20)}','c','C','text',${corrupted ? 0 : 2}),
      ('${id(30)}','${id(1)}','${id(20)}','a','A','text',0),
      ('${id(31)}','${id(1)}','${id(20)}','b','B','text',${corrupted ? 0 : 1}),
      ('${id(34)}','${id(2)}','${id(21)}','other','Other','text',0);
    insert into items values('${id(40)}','${id(1)}','${id(20)}','${id(10)}');
    insert into item_values values('${id(1)}','${id(40)}','a','{"preserved":true}');
  `);
  return db;
}

async function customerSnapshot(db) {
  return (await db.query(`select c.id,c.org_id,c.board_id,c.key,c.label,c.type::text,c.options_jsonb,c.sort_order,c.width,c.source::text,c.right_pinned,c.move_rule_jsonb,c.is_readonly,v.value_jsonb from board_columns c left join item_values v on v.org_id=c.org_id and v.column_key=c.key order by c.id`)).rows;
}

test("hosted 088 drift replays 091 twice, audits exactly, then exact 089 installs", async () => {
  const db = await database();
  const before = await customerSnapshot(db);
  await db.exec(recovery); await db.exec(recovery);
  assert.deepEqual((await db.query(`select key,sort_order from board_columns where board_id='${id(20)}' order by sort_order`)).rows,
    [{key:"a",sort_order:0},{key:"b",sort_order:1},{key:"c",sort_order:2}]);
  assert.deepEqual((await db.query("select column_id,old_sort_order,new_sort_order,order_basis from board_column_order_repair_audit order by new_sort_order")).rows, [
    {column_id:id(30),old_sort_order:0,new_sort_order:0,order_basis:"row_number(sort_order,id)-1"},
    {column_id:id(31),old_sort_order:0,new_sort_order:1,order_basis:"row_number(sort_order,id)-1"},
    {column_id:id(32),old_sort_order:0,new_sort_order:2,order_basis:"row_number(sort_order,id)-1"},
  ]);
  assert.deepEqual((await db.query(`select key,sort_order from board_columns where board_id='${id(21)}'`)).rows,[{key:"other",sort_order:0}]);
  await db.exec(canonical);
  assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname='board_columns_active_order_idx'")).rows[0].n,1);
  const after=await customerSnapshot(db);
  assert.deepEqual(after.map(({sort_order:_s,...r})=>r),before.map(({sort_order:_s,...r})=>r));
  assert.equal((await db.query(`select count(*)::int n from item_values where value_jsonb='{"preserved":true}'::jsonb`)).rows[0].n,1);
  await db.close();
});

test("healthy canonical 089 followed by 091 twice is a no-op", async () => {
  const db=await database({corrupted:false});
  await db.exec(canonical);
  const before=await customerSnapshot(db);
  await db.exec(recovery); await db.exec(recovery);
  assert.deepEqual(await customerSnapshot(db),before);
  assert.equal((await db.query("select count(*)::int n from board_column_order_repair_audit")).rows[0].n,0);
  await db.close();
});

test("audit snapshots survive board deletion, while org deletion performs privacy cleanup", async () => {
  const db=await database(); await db.exec(recovery);
  const mapping=(await db.query(`select board_id,column_id,old_sort_order,new_sort_order,order_basis,repaired_at from board_column_order_repair_audit where org_id='${id(1)}' order by column_id`)).rows;
  await db.exec(`delete from boards where id='${id(20)}'`); await db.exec(recovery);
  assert.deepEqual((await db.query(`select board_id,column_id,old_sort_order,new_sort_order,order_basis,repaired_at from board_column_order_repair_audit where org_id='${id(1)}' order by column_id`)).rows,mapping);
  await db.exec(`delete from orgs where id='${id(1)}'`);
  assert.equal((await db.query(`select count(*)::int n from board_column_order_repair_audit where org_id='${id(1)}'`)).rows[0].n,0);
  await db.close();
});

test("091 keeps audit private and limits customer mutation to sort_order", async () => {
  const db=await database(); await db.exec(recovery);
  assert.deepEqual((await db.query(`select c.relrowsecurity,has_table_privilege('anon','public.board_column_order_repair_audit','select') anon_select,has_table_privilege('authenticated','public.board_column_order_repair_audit','select') auth_select,has_table_privilege('service_role','public.board_column_order_repair_audit','select') service_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='board_column_order_repair_audit'`)).rows,[{relrowsecurity:true,anon_select:false,auth_select:false,service_select:false}]);
  const updates=[...recovery.matchAll(/update\s+public\.([a-z_]+)\s+c\s+set\s+([a-z_]+)/gi)].map(m=>`${m[1]}.${m[2]}`);
  assert.deepEqual(updates,["board_columns.sort_order","board_columns.sort_order"]);
  assert.doesNotMatch(recovery,/delete\s+from\s+public\./i);
  assert.doesNotMatch(recovery,/update\s+public\.(items|item_values|boards|orgs)\b/i);
  await db.close();
});

test("invalid 090 artifacts are absent from the recovery tree", async () => {
  await assert.rejects(readFile(path.join(root,"supabase","migrations","090_bbe176_hosted_order_drift_repair.sql"),"utf8"),/ENOENT/);
  await assert.rejects(readFile(path.join(root,"supabase","tests","bbe176_hosted_order_drift_repair.pglite.test.mjs"),"utf8"),/ENOENT/);
});
