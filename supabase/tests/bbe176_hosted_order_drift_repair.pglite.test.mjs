import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);
const repair = await readFile(path.join(root, "supabase", "migrations", "090_bbe176_hosted_order_drift_repair.sql"), "utf8");
const canonical = await readFile(path.join(root, "supabase", "migrations", "089_bbe176_column_metadata_canonical.sql"), "utf8");
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function database({ corrupted = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')$$;
    create function public.digest(p text,a text) returns bytea language sql immutable strict as $$select public.digest(convert_to(p,'utf8'),a)$$;
    create type public.member_role as enum('owner','admin','team_lead','member');
    create type public.member_scope as enum('all','department','assigned');
    create type public.field_type as enum('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','people','url','checkbox','money','calc');
    create type public.field_source as enum('auto','in','act','msg','lk','calc');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.orgs(id uuid primary key,status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,role public.member_role,scope public.member_scope,status text,primary key(org_id,user_id));
    create function public.is_org_member(p uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from org_members where org_id=p and user_id=auth.uid() and status='active')$$;
    create function public.org_role(p uuid) returns public.member_role language sql stable security definer set search_path=public as $$select role from org_members where org_id=p and user_id=auth.uid() and status='active'$$;
    create function public.effective_permission(p uuid,k text) returns boolean language sql stable security definer set search_path=public as $$select public.is_org_member(p)$$;
    create table public.boards(id uuid primary key,org_id uuid references orgs(id));
    create table public.board_columns(
      id uuid primary key,
      org_id uuid references orgs(id),
      board_id uuid references boards(id),
      key text,
      label text,
      type public.field_type,
      options_jsonb jsonb,
      sort_order int not null default 0,
      width int,
      source public.field_source default 'in',
      right_pinned boolean default false,
      move_rule_jsonb jsonb,
      is_readonly boolean default false,
      created_at timestamptz not null default now(),
      archived_at timestamptz,
      unique(board_id,key)
    );
    create table public.items(id uuid primary key,org_id uuid references orgs(id),board_id uuid references boards(id),assigned_to uuid references users(id));
    create table public.item_values(org_id uuid references orgs(id),item_id uuid references items(id),column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    alter table board_columns enable row level security;
    alter table item_values enable row level security;
    create policy bcols_rw on board_columns for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    create policy itemvals_rw on item_values for all using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
    grant usage on schema public,auth to authenticated;
    grant select,insert,update,delete on board_columns,item_values to authenticated;
    insert into orgs values('${id(1)}','active'),('${id(2)}','active');
    insert into users values('${id(10)}');
    insert into org_members values('${id(1)}','${id(10)}','owner','all','active');
    insert into boards values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');
    insert into board_columns(id,org_id,board_id,key,label,type,sort_order,created_at) values
      ('${id(30)}','${id(1)}','${id(20)}','a','A','text',${corrupted ? 0 : 0},'2026-01-03'),
      ('${id(31)}','${id(1)}','${id(20)}','b','B','text',${corrupted ? 0 : 1},'2026-01-01'),
      ('${id(32)}','${id(1)}','${id(20)}','c','C','text',${corrupted ? 0 : 2},'2026-01-02'),
      ('${id(33)}','${id(1)}','${id(20)}','archived','Archived','text',9,'2026-01-01'),
      ('${id(34)}','${id(2)}','${id(21)}','other','Other','text',0,'2026-01-01');
    update board_columns set archived_at='2026-02-01' where id='${id(33)}';
    insert into items values('${id(40)}','${id(1)}','${id(20)}','${id(10)}');
    insert into item_values values('${id(1)}','${id(40)}','a','{"preserved":true}');
  `);
  return db;
}

async function snapshot(db) {
  return (await db.query(`
    select c.id,c.org_id,c.board_id,c.key,c.label,c.type::text,c.width,c.source::text,
           c.right_pinned,c.move_rule_jsonb,c.is_readonly,c.created_at,c.archived_at,
           v.value_jsonb
      from board_columns c
      left join item_values v on v.org_id=c.org_id and v.column_key=c.key
     order by c.id
  `)).rows;
}

test("corrupted pre-089 order repairs once, audits reversibly, then exact 089 installs", async () => {
  const db = await database({ corrupted: true });
  const before = await snapshot(db);
  await db.exec(repair);
  await db.exec(repair);

  assert.deepEqual(
    (await db.query(`select key,sort_order from board_columns where board_id='${id(20)}' and archived_at is null order by sort_order`)).rows,
    [{ key: "b", sort_order: 0 }, { key: "c", sort_order: 1 }, { key: "a", sort_order: 2 }],
  );
  const audit = (await db.query("select column_id,old_sort_order,new_sort_order,order_basis from board_column_order_repair_audit order by new_sort_order")).rows;
  assert.deepEqual(audit, [
    { column_id: id(31), old_sort_order: 0, new_sort_order: 0, order_basis: "row_number(sort_order,created_at,id)-1" },
    { column_id: id(32), old_sort_order: 0, new_sort_order: 1, order_basis: "row_number(sort_order,created_at,id)-1" },
    { column_id: id(30), old_sort_order: 0, new_sort_order: 2, order_basis: "row_number(sort_order,created_at,id)-1" },
  ]);
  assert.equal((await db.query("select count(*)::int n from board_column_order_repair_audit")).rows[0].n, 3);
  assert.deepEqual((await db.query(`
    select c.relrowsecurity,
           has_table_privilege('anon','public.board_column_order_repair_audit','select') anon_select,
           has_table_privilege('authenticated','public.board_column_order_repair_audit','select') authenticated_select,
           has_table_privilege('service_role','public.board_column_order_repair_audit','select') service_select
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='board_column_order_repair_audit'
  `)).rows, [{ relrowsecurity: true, anon_select: false, authenticated_select: false, service_select: false }]);

  const after = await snapshot(db);
  for (const row of after) {
    const old = before.find((candidate) => candidate.id === row.id);
    if ([id(30), id(31), id(32)].includes(row.id)) {
      assert.deepEqual({ ...row, sort_order: undefined }, { ...old, sort_order: undefined });
    } else {
      assert.deepEqual(row, old);
    }
  }
  await db.exec(canonical);
  assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname='board_columns_active_order_idx'")).rows[0].n, 1);
  await assert.rejects(async () => {
    await db.exec("set role authenticated");
    await db.query("select * from board_column_order_repair_audit");
  }, /permission denied/);
  await db.close();
});

test("090 source limits persistent customer mutation to board column sort_order", () => {
  const updates = [...repair.matchAll(/update\s+public\.([a-z_]+)\s+c\s+set\s+([a-z_]+)/gi)]
    .map((match) => `${match[1]}.${match[2]}`);
  assert.deepEqual(updates, ["board_columns.sort_order", "board_columns.sort_order"]);
  assert.doesNotMatch(repair, /update\s+public\.(item_values|items|boards)\b/i);
  assert.doesNotMatch(repair, /delete\s+from\s+public\./i);
});

test("healthy 089 environment replays 090 twice with zero layout or customer change", async () => {
  const db = await database();
  await db.exec(canonical);
  const before = await snapshot(db);
  await db.exec(repair);
  await db.exec(repair);
  assert.deepEqual(await snapshot(db), before);
  assert.equal((await db.query("select count(*)::int n from board_column_order_repair_audit")).rows[0].n, 0);
  await db.close();
});
