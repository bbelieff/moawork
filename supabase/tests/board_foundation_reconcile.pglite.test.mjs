import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);
const migrationPath = path.join(root, "supabase", "migrations", "059_board_foundation_reconcile.sql");
const rollbackPath = path.join(root, "supabase", "rollbacks", "059_board_foundation_reconcile.rollback.sql");

async function bootstrapPartialDrift(db) {
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create type public.field_type as enum
      ('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','url','checkbox','status');
    create type public.member_role as enum ('owner','admin','member');
    create type public.member_scope as enum ('all','assigned');
    create table public.board_columns(id uuid primary key, org_id uuid, type public.field_type not null);
    create table public.orgs(id uuid primary key, status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(
      org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
      role public.member_role not null, scope public.member_scope not null, status text not null,
      primary key(org_id,user_id)
    );
    create table public.member_scoped_permission_bindings(
      org_id uuid not null, subject_user_id uuid not null, scope_key text not null,
      decision text not null, access_level text not null, updated_by uuid not null,
      updated_at timestamptz not null default now(), primary key(org_id,subject_user_id,scope_key)
    );
    create table public.departments(id uuid primary key, org_id uuid not null, parent_id uuid, archived_at timestamptz);
    create table public.department_members(org_id uuid not null, dept_id uuid not null, user_id uuid not null, is_primary boolean not null);
    create table public.items(id uuid primary key, org_id uuid not null, assigned_to uuid);
    create function public.member_hierarchy_authz_require_owner(p_org_id uuid) returns uuid
      language sql as $$ select null::uuid $$;
    create function public.member_hierarchy_authz_require_active_nonowner(p_org_id uuid,p_target uuid,p_actor uuid) returns void
      language plpgsql as $$ begin return; end $$;
    grant usage on schema public, auth to authenticated;
  `);
}

test("BBE-146 reconciliation is safe on partial drift and on a second run", async () => {
  const db = new PGlite();
  try {
    await bootstrapPartialDrift(db);
    const sql = await readFile(migrationPath, "utf8");
    await db.exec(sql);
    await db.exec(sql);

    const fieldTypes = await db.query(`
      select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid
      where t.typname='field_type' order by enumsortorder
    `);
    assert.equal(fieldTypes.rows.length, 17);
    for (const value of ["status", "people", "money", "calc", "multiselect", "url"]) {
      assert.equal(fieldTypes.rows.some((row) => row.enumlabel === value), true);
    }

    const columns = await db.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='board_columns'
    `);
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const name of ["move_rule_jsonb", "is_readonly", "source", "right_pinned"]) {
      assert.equal(names.has(name), true);
    }
    assert.equal((await db.query("select count(*)::integer as count from public.perm_baseline()")).rows[0].count, 24);
    assert.equal((await db.query("select count(*)::integer as count from pg_type where typname='field_source'")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::integer as count from pg_class where relname in ('org_role_permission_overrides','org_permission_audit')")).rows[0].count, 2);

    await db.exec(await readFile(rollbackPath, "utf8"));
    const rolledBackColumns = await db.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='board_columns'
    `);
    const rolledBackNames = new Set(rolledBackColumns.rows.map((row) => row.column_name));
    for (const name of ["move_rule_jsonb", "is_readonly", "source", "right_pinned"]) {
      assert.equal(rolledBackNames.has(name), false);
    }
    assert.equal((await db.query("select count(*)::integer as count from pg_type where typname='field_source'")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::integer as count from pg_class where relname in ('org_role_permission_overrides','org_permission_audit')")).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer as count from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='field_type'`)).rows[0].count, 17);
  } finally {
    await db.close();
  }
});
