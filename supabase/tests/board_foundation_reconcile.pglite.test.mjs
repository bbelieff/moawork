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
const migrationPath = path.join(root, "supabase", "migrations", "060_board_foundation_reconcile.sql");
const rollbackPath = path.join(root, "supabase", "rollbacks", "060_board_foundation_reconcile.rollback.sql");

async function bootstrapPartialDrift(db, { existingLayoutColumns = false } = {}) {
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create type public.field_type as enum
      ('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','url','checkbox','status');
    create type public.member_role as enum ('owner','admin','member');
    create type public.member_scope as enum ('all','assigned');
    ${existingLayoutColumns ? "create type public.field_source as enum ('auto','in','act','msg','lk','calc');" : ""}
    create table public.boards(
      id uuid primary key
      ${existingLayoutColumns ? ", detail_layout_jsonb jsonb not null default '[]'::jsonb" : ""}
    );
    create table public.board_groups(
      id uuid primary key,
      board_id uuid not null references public.boards(id)
      ${existingLayoutColumns ? ", detail_layout_jsonb jsonb not null default '[]'::jsonb" : ""}
    );
    create table public.board_columns(
      id uuid primary key, org_id uuid, type public.field_type not null,
      sort_order integer not null default 17
      ${existingLayoutColumns ? ", source public.field_source not null default 'in', right_pinned boolean not null default false, move_rule_jsonb jsonb, is_readonly boolean not null default false" : ""}
    );
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
    const preservedColumnId = "00000000-0000-0000-0000-000000000001";
    await db.query(`insert into public.board_columns(id, type, sort_order) values ($1, 'text', 91)`, [preservedColumnId]);
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
    assert.equal(names.has("sort_order"), true);
    const sortOrder = await db.query(`select sort_order from public.board_columns where id=$1`, [preservedColumnId]);
    assert.equal(sortOrder.rows[0].sort_order, 91);
    const sortOrderSchema = await db.query(`
      select data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='board_columns' and column_name='sort_order'
    `);
    assert.deepEqual(sortOrderSchema.rows[0], { data_type: "integer", is_nullable: "NO", column_default: "17" });

    const boardId = "00000000-0000-0000-0000-000000000101";
    const inheritedGroupId = "00000000-0000-0000-0000-000000000102";
    const emptyGroupId = "00000000-0000-0000-0000-000000000103";
    await db.query(
      `insert into public.boards(id, detail_layout_jsonb) values ($1, $2::jsonb)`,
      [boardId, JSON.stringify([{ key: "owner", source: "column" }, { key: "memo", source: "detail" }])],
    );
    await db.query(
      `insert into public.board_groups(id, board_id, detail_layout_jsonb) values ($1, $3, null), ($2, $3, '[]'::jsonb)`,
      [inheritedGroupId, emptyGroupId, boardId],
    );
    const layouts = await db.query(`
      select id, detail_layout_jsonb from public.board_groups order by id
    `);
    assert.equal(layouts.rows[0].detail_layout_jsonb, null);
    assert.deepEqual(layouts.rows[1].detail_layout_jsonb, []);
    await assert.rejects(
      db.query(`insert into public.boards(id, detail_layout_jsonb) values ('00000000-0000-0000-0000-000000000104', '{"key":"bad"}'::jsonb)`),
      /boards_detail_layout_jsonb_valid/,
    );
    await assert.rejects(
      db.query(`update public.board_groups set detail_layout_jsonb='[{"key":"x","source":"other"}]'::jsonb where id=$1`, [emptyGroupId]),
      /board_groups_detail_layout_jsonb_valid/,
    );
    for (const invalid of [[{}], [{ source: "column" }], [{ key: "x" }]]) {
      await assert.rejects(
        db.query(`update public.board_groups set detail_layout_jsonb=$2::jsonb where id=$1`, [emptyGroupId, JSON.stringify(invalid)]),
        /board_groups_detail_layout_jsonb_valid/,
      );
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
      assert.equal(rolledBackNames.has(name), true);
    }
    const rolledBackLayouts = await db.query(`
      select table_name, column_name from information_schema.columns
      where table_schema='public' and table_name in ('boards','board_groups')
        and column_name='detail_layout_jsonb'
    `);
    assert.equal(rolledBackLayouts.rows.length, 2);
    assert.equal((await db.query("select count(*)::integer as count from pg_proc where proname='is_valid_detail_layout'")).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer as count from pg_constraint where conname in ('boards_detail_layout_jsonb_valid','board_groups_detail_layout_jsonb_valid')`)).rows[0].count, 0);
    assert.equal((await db.query(`select sort_order from public.board_columns where id=$1`, [preservedColumnId])).rows[0].sort_order, 91);
    assert.equal((await db.query("select count(*)::integer as count from pg_type where typname='field_source'")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::integer as count from pg_class where relname in ('org_role_permission_overrides','org_permission_audit')")).rows[0].count, 2);
    assert.equal((await db.query(`select count(*)::integer as count from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='field_type'`)).rows[0].count, 17);
  } finally {
    await db.close();
  }
});

test("BBE-146 reconciliation is safe when detail layout columns already exist", async () => {
  const db = new PGlite();
  try {
    await bootstrapPartialDrift(db, { existingLayoutColumns: true });
    const boardId = "00000000-0000-0000-0000-000000000201";
    const groupId = "00000000-0000-0000-0000-000000000202";
    const existingBoardLayout = [{ key: "legacy-owner", source: "column" }];
    const existingGroupLayout = [{ key: "legacy-note", source: "detail" }];
    const existingColumnId = "00000000-0000-0000-0000-000000000204";
    await db.query(`insert into public.boards(id, detail_layout_jsonb) values ($1, $2::jsonb)`, [boardId, JSON.stringify(existingBoardLayout)]);
    await db.query(`insert into public.board_groups(id, board_id, detail_layout_jsonb) values ($1, $2, $3::jsonb)`, [groupId, boardId, JSON.stringify(existingGroupLayout)]);
    await db.query(`insert into public.board_columns(id, type, source, sort_order) values ($1, 'text', 'msg', 73)`, [existingColumnId]);

    const sql = await readFile(migrationPath, "utf8");
    await db.exec(sql);
    await db.exec(sql);

    const group = await db.query(`select detail_layout_jsonb from public.board_groups where id=$1`, [groupId]);
    assert.deepEqual(group.rows[0].detail_layout_jsonb, existingGroupLayout);
    const board = await db.query(`select detail_layout_jsonb from public.boards where id=$1`, [boardId]);
    assert.deepEqual(board.rows[0].detail_layout_jsonb, existingBoardLayout);
    const groupSchema = await db.query(`
      select is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='board_groups' and column_name='detail_layout_jsonb'
    `);
    assert.deepEqual(groupSchema.rows[0], { is_nullable: "YES", column_default: null });
    const nullGroupId = "00000000-0000-0000-0000-000000000203";
    await db.query(`insert into public.board_groups(id, board_id, detail_layout_jsonb) values ($1, $2, null)`, [nullGroupId, boardId]);
    assert.equal((await db.query(`select detail_layout_jsonb from public.board_groups where id=$1`, [nullGroupId])).rows[0].detail_layout_jsonb, null);
    assert.equal((await db.query(`select count(*)::integer as count from pg_constraint where conname in ('boards_detail_layout_jsonb_valid','board_groups_detail_layout_jsonb_valid')`)).rows[0].count, 2);

    await db.exec(await readFile(rollbackPath, "utf8"));
    const existingColumn = await db.query(`select source, sort_order from public.board_columns where id=$1`, [existingColumnId]);
    assert.deepEqual(existingColumn.rows[0], { source: "msg", sort_order: 73 });
    assert.equal((await db.query("select count(*)::integer as count from pg_type where typname='field_source'")).rows[0].count, 1);
    assert.equal((await db.query(`select count(*)::integer as count from pg_constraint where conname in ('boards_detail_layout_jsonb_valid','board_groups_detail_layout_jsonb_valid')`)).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
