import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../migrations/137_issue601_other_info_consumer.sql", import.meta.url);
const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000001";
const boardA = "30000000-0000-4000-8000-000000000001";
const boardB = "30000000-0000-4000-8000-000000000002";
const itemA = "40000000-0000-4000-8000-000000000001";
const itemB = "40000000-0000-4000-8000-000000000002";

const valid = {
  version: 1,
  closedHistory: { checked: false, text: "이력 메모" },
  export: { checked: true, text: "수출 예정" },
  intellectualProperty: { checked: false, text: "" },
  certifications: { checked: true, text: "벤처기업" },
  otherBusinesses: { checked: false, text: "보존" },
};

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create type public.field_type as enum ('text','select');
    create table public.migration_apply_guard(
      logical_key text primary key, file_name text not null, file_digest text not null,
      predecessor_logical_key text, executor text, thread_id text
    );
    insert into public.migration_apply_guard values
      ('136_issue620_app_meta_internal','136_issue620_app_meta_internal.sql','digest-136','135_issue619_item_assignment_lineage','DG-00','baseline');
    create function public.begin_guarded_migration(
      p_logical_key text, p_file_name text, p_file_digest text, p_expected_predecessor text,
      p_executor text, p_thread_id text, p_foundation boolean
    ) returns void language plpgsql as $$
    declare latest text;
    begin
      select logical_key into latest from public.migration_apply_guard order by logical_key desc limit 1;
      if latest is distinct from p_expected_predecessor then raise exception 'predecessor mismatch'; end if;
      insert into public.migration_apply_guard values
        (p_logical_key,p_file_name,p_file_digest,p_expected_predecessor,p_executor,p_thread_id);
    end $$;
    create table public.boards(id uuid primary key, org_id uuid not null, source text);
    create table public.items(id uuid primary key, org_id uuid not null, board_id uuid not null references public.boards(id));
    create table public.board_columns(
      id uuid primary key default gen_random_uuid(), org_id uuid not null, board_id uuid not null,
      key text not null, type public.field_type not null, archived_at timestamptz,
      is_required boolean not null default false, validation_jsonb jsonb not null default '{}'::jsonb
    );
    create table public.item_values(
      org_id uuid not null, item_id uuid not null references public.items(id), column_key text not null,
      value_jsonb jsonb, primary key(item_id,column_key)
    );
    alter table public.item_values enable row level security;
    alter table public.item_values force row level security;
    grant select,insert,update,delete on public.item_values to authenticated;
    create policy item_values_org on public.item_values to authenticated
      using (org_id=current_setting('app.org_id',true)::uuid)
      with check (org_id=current_setting('app.org_id',true)::uuid);
    insert into public.boards values
      ('${boardA}','${orgA}','core.default-tab/new-lead'),
      ('${boardB}','${orgB}','core.default-tab/new-lead');
    insert into public.items values ('${itemA}','${orgA}','${boardA}'),('${itemB}','${orgB}','${boardB}');
  `);
  return db;
}

test("137 adds only strict other_info validation and preserves item_values RLS/ACL", async () => {
  const db = await setup();
  const before = await db.query(`
    select c.relrowsecurity, c.relforcerowsecurity,
      coalesce((select string_agg(policyname||':'||cmd||':'||roles::text,'|' order by policyname) from pg_policies where schemaname='public' and tablename='item_values'),'') policies,
      has_table_privilege('authenticated','public.item_values','SELECT,INSERT,UPDATE,DELETE') authenticated_acl,
      has_table_privilege('anon','public.item_values','SELECT,INSERT,UPDATE,DELETE') anon_acl
    from pg_class c where c.oid='public.item_values'::regclass
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  const after = await db.query(`
    select c.relrowsecurity, c.relforcerowsecurity,
      coalesce((select string_agg(policyname||':'||cmd||':'||roles::text,'|' order by policyname) from pg_policies where schemaname='public' and tablename='item_values'),'') policies,
      has_table_privilege('authenticated','public.item_values','SELECT,INSERT,UPDATE,DELETE') authenticated_acl,
      has_table_privilege('anon','public.item_values','SELECT,INSERT,UPDATE,DELETE') anon_acl
    from pg_class c where c.oid='public.item_values'::regclass
  `);
  assert.deepEqual(after.rows, before.rows);
  assert.equal((await db.query("select count(*)::int n from public.migration_apply_guard where logical_key='137_issue601_other_info_consumer'")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from pg_enum where enumtypid='public.field_type'::regtype and enumlabel='other_info'")).rows[0].n, 1);
  await db.close();
});

test("strict exact-five JSON accepts valid input and rejects partial/future/type mutations", async () => {
  const db = await setup();
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(`insert into public.board_columns(org_id,board_id,key,type) values ('${orgA}','${boardA}','other_info','other_info')`);
  assert.equal((await db.query("select public.board_column_value_is_valid($1,$2,'other_info',$3::jsonb) ok", [orgA,itemA,JSON.stringify(valid)])).rows[0].ok, true);
  const { certifications: _removed, ...partial } = valid;
  for (const invalid of [partial, { ...valid, future: true }, { ...valid, export: { checked: "true", text: "수출" } }]) {
    assert.equal((await db.query("select public.board_column_value_is_valid($1,$2,'other_info',$3::jsonb) ok", [orgA,itemA,JSON.stringify(invalid)])).rows[0].ok, false);
  }
  const fn = (await db.query("select prosecdef,proconfig,proacl from pg_proc where oid='public.board_column_value_is_valid(uuid,uuid,text,jsonb)'::regprocedure")).rows[0];
  assert.equal(fn.prosecdef, true);
  assert.deepEqual(fn.proconfig, ["search_path=public, pg_temp"]);
  assert.match(String(fn.proacl), /postgres=X\/postgres/);
  assert.doesNotMatch(String(fn.proacl), /authenticated|anon|service_role|PUBLIC/i);
  await db.close();
});

test("existing item_values RLS keeps same-org write and rejects cross-org with zero partial rows", async () => {
  const db = await setup();
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(`
    insert into public.board_columns(org_id,board_id,key,type) values
      ('${orgA}','${boardA}','other_info','other_info'),
      ('${orgA}','${boardA}','custom_other_info','other_info'),
      ('${orgB}','${boardB}','other_info','other_info');
    create function public.enforce_board_column_value()
      returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
    begin
      if not public.board_column_value_is_valid(new.org_id,new.item_id,new.column_key,new.value_jsonb) then
        raise exception 'column value validation failed' using errcode='23514';
      end if;
      return new;
    end $$;
    create trigger enforce_value before insert or update on public.item_values
      for each row execute function public.enforce_board_column_value();
    set role authenticated;
    set app.org_id='${orgA}';
  `);
  await db.query("insert into public.item_values values ($1,$2,'other_info',$3::jsonb)", [orgA,itemA,JSON.stringify(valid)]);
  const { certifications: _removed, ...partial } = valid;
  await assert.rejects(
    db.query("insert into public.item_values values ($1,$2,'custom_other_info',$3::jsonb)", [orgA,itemA,JSON.stringify(partial)]),
    (error) => error?.code === "23514",
  );
  await assert.rejects(
    db.query("update public.item_values set value_jsonb=$1::jsonb where item_id=$2 and column_key='other_info'", [JSON.stringify(partial),itemA]),
    (error) => error?.code === "23514",
  );
  await assert.rejects(
    db.query("insert into public.item_values values ($1,$2,'other_info',$3::jsonb)", [orgB,itemB,JSON.stringify(valid)]),
    /row-level security policy/u,
  );
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from public.item_values")).rows[0].n, 1);
  assert.deepEqual(
    (await db.query("select value_jsonb from public.item_values where item_id=$1 and column_key='other_info'", [itemA])).rows[0].value_jsonb,
    valid,
  );
  for (const role of ["authenticated", "service_role", "anon"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.board_column_value_is_valid($1,$2,'other_info',$3::jsonb)", [orgA,itemA,JSON.stringify(valid)]),
      /permission denied/u,
    );
    await db.exec("reset role");
  }
  await db.close();
});
