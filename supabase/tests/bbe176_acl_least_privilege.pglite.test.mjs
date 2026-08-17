import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const canonical = await readFile(path.join(root, "supabase", "migrations", "089_bbe176_column_metadata_canonical.sql"), "utf8");
const recovery = await readFile(path.join(root, "supabase", "migrations", "091_bbe176_hosted_order_drift_recovery.sql"), "utf8");
const acl = await readFile(path.join(root, "supabase", "migrations", "092_bbe176_acl_least_privilege.sql"), "utf8");

const signatures = [
  "public.board_column_access_policy_is_valid(jsonb)",
  "public.board_column_validation_is_valid(jsonb)",
  "public.board_column_metadata_is_valid(jsonb,jsonb,jsonb)",
  "public.board_column_policy_allows(uuid,jsonb)",
  "public.board_column_value_visible(uuid,uuid,text)",
  "public.board_column_value_editable(uuid,uuid,text)",
  "public.board_column_type_dry_run(uuid,uuid,uuid,public.field_type)",
  "public.execute_board_column_command(uuid,uuid,uuid,text,uuid,jsonb)",
];
const authenticatedApis = new Set(signatures.slice(3));

async function database() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
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
    create table public.board_columns(id uuid primary key,org_id uuid references orgs(id) on delete cascade,board_id uuid references boards(id) on delete cascade,key text,label text,type public.field_type,options_jsonb jsonb,sort_order int not null default 0,width int,source public.field_source default 'in',right_pinned boolean default false,move_rule_jsonb jsonb,is_readonly boolean default false,unique(board_id,key));
    create table public.items(id uuid primary key,org_id uuid references orgs(id) on delete cascade,board_id uuid references boards(id) on delete cascade,assigned_to uuid references users(id));
    create table public.item_values(org_id uuid references orgs(id) on delete cascade,item_id uuid references items(id) on delete cascade,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    alter table board_columns enable row level security; alter table item_values enable row level security;
    create policy bcols_rw on board_columns for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    create policy itemvals_rw on item_values for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    insert into orgs values('10000000-0000-4000-8000-000000000001','active');
    insert into boards values('10000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000001');
    insert into board_columns values('10000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000020','name','Name','text',null,0,null,'in',false,null,false);
  `);
  return db;
}

async function functionState(db) {
  const rows = [];
  for (const signature of signatures) {
    const result = await db.query(`select
      has_function_privilege('public',$1,'execute') public_exec,
      has_function_privilege('anon',$1,'execute') anon_exec,
      has_function_privilege('service_role',$1,'execute') service_exec,
      has_function_privilege('authenticated',$1,'execute') authenticated_exec,
      has_function_privilege('postgres',$1,'execute') postgres_exec`, [signature]);
    rows.push({ signature, ...result.rows[0] });
  }
  return rows;
}

test("089 to 091 to 092 enforces the exact privilege matrix and replays idempotently", async () => {
  const db = await database();
  await db.exec(canonical); await db.exec(recovery);
  const definitionsBefore = (await db.query(`select p.oid::regprocedure::text signature,p.prosrc,p.prosecdef,p.proconfig,r.rolname owner from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=any($1::regprocedure[]) order by 1`, [signatures])).rows;
  const customerBefore = (await db.query("select row_to_json(c) row from board_columns c order by id")).rows;
  await db.exec(acl); await db.exec(acl);
  const matrix = await functionState(db);
  for (const row of matrix) {
    assert.equal(row.public_exec, false, `${row.signature} PUBLIC`);
    assert.equal(row.anon_exec, false, `${row.signature} anon`);
    assert.equal(row.service_exec, false, `${row.signature} service_role`);
    assert.equal(row.authenticated_exec, authenticatedApis.has(row.signature), `${row.signature} authenticated`);
    assert.equal(row.postgres_exec, true, `${row.signature} postgres owner`);
  }
  const definitionsAfter = (await db.query(`select p.oid::regprocedure::text signature,p.prosrc,p.prosecdef,p.proconfig,r.rolname owner from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=any($1::regprocedure[]) order by 1`, [signatures])).rows;
  assert.deepEqual(definitionsAfter, definitionsBefore);
  assert.deepEqual((await db.query("select row_to_json(c) row from board_columns c order by id")).rows, customerBefore);
  await db.close();
});

test("092 contains ACL statements only", () => {
  assert.doesNotMatch(acl, /\b(create|alter|drop|insert|update|delete|truncate)\b/i);
  assert.match(acl, /revoke execute/i);
  assert.match(acl, /grant execute/i);
});
