import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const guard = await readFile(path.join(root, "supabase", "migrations", "094_migration_apply_guard.sql"), "utf8");
const migration = await readFile(path.join(root, "supabase", "migrations", "121_bbe236_board_column_date_validator_execute.sql"), "utf8");

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin; create role public_probe nologin;
    create function public.board_column_access_policy_is_valid(jsonb) returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$ select true $$;
    create function public.board_column_validation_is_valid(jsonb) returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$ select true $$;
    create function public.board_column_metadata_is_valid(jsonb,jsonb,jsonb) returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$ select true $$;
    create function public.board_column_date_settings_is_valid(p jsonb) returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$ select jsonb_typeof(p)='object' $$;
    revoke all on function public.board_column_access_policy_is_valid(jsonb), public.board_column_validation_is_valid(jsonb), public.board_column_metadata_is_valid(jsonb,jsonb,jsonb), public.board_column_date_settings_is_valid(jsonb) from public,anon,authenticated,service_role;
    grant execute on function public.board_column_access_policy_is_valid(jsonb), public.board_column_validation_is_valid(jsonb), public.board_column_metadata_is_valid(jsonb,jsonb,jsonb) to authenticated;
    create table public.board_columns(id int generated always as identity primary key, org_id uuid not null, date_settings_jsonb jsonb not null default '{}', constraint board_columns_date_settings_valid check(public.board_column_date_settings_is_valid(date_settings_jsonb)));
    grant select,insert on public.board_columns to authenticated;
    create table public.items(id uuid primary key); create table public.item_values(id uuid primary key); create table public.companies(id uuid primary key); create table public.deals(id uuid primary key);
  `);
  await db.exec(guard);
  await db.exec(`insert into public.migration_apply_guard(logical_key,file_name,file_digest,expected_predecessor,executor,thread_id) values('120_bbe273_new_lead_full_intake','120_bbe273_new_lead_full_intake.sql',repeat('a',64),'119_bbe272_new_lead_default_stage_ensure','test','bbe236')`);
  return db;
}

async function denied(db, role) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.exec("select public.board_column_date_settings_is_valid('{}')"), (error) => error?.code === "42501");
  await db.exec("reset role");
}

test("121 restores only authenticated validator execution and changes no customer rows", async () => {
  const db = await database();
  const before = (await db.query("select (select count(*) from items) items,(select count(*) from item_values) item_values,(select count(*) from companies) companies,(select count(*) from deals) deals")).rows[0];
  await db.exec(migration);
  await db.exec("set role authenticated; select public.board_column_date_settings_is_valid('{}'); insert into public.board_columns(org_id) values('10000000-0000-4000-8000-000000000001'); reset role");
  await denied(db, "anon"); await denied(db, "service_role"); await denied(db, "public_probe");
  const after = (await db.query("select (select count(*) from items) items,(select count(*) from item_values) item_values,(select count(*) from companies) companies,(select count(*) from deals) deals")).rows[0];
  assert.deepEqual(after, before);
  assert.equal((await db.query("select count(*)::int n from board_columns")).rows[0].n, 1);
  await db.close();
});

test("revoking authenticated date validator execution reproduces the 42501 write failure", async () => {
  const db = await database(); await db.exec(migration);
  await db.exec("revoke execute on function public.board_column_date_settings_is_valid(jsonb) from authenticated; set role authenticated");
  await assert.rejects(db.exec("insert into public.board_columns(org_id) values('10000000-0000-4000-8000-000000000001')"), (error) => error?.code === "42501");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from board_columns")).rows[0].n, 0);
  await db.close();
});
