import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(
  pathToFileURL(path.join(dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href,
);
const guard = await readFile(path.join(root, "supabase", "migrations", "094_migration_apply_guard.sql"), "utf8");
const migration = await readFile(
  path.join(root, "supabase", "migrations", "107_bbe242_board_column_check_execute_restore.sql"),
  "utf8",
);

const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "10000000-0000-4000-8000-000000000002";
const userA = "10000000-0000-4000-8000-000000000010";
const boardA = "10000000-0000-4000-8000-000000000020";
const boardB = "10000000-0000-4000-8000-000000000021";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create type public.field_type as enum('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','people','url','checkbox','money','calc');
    create type public.field_source as enum('auto','in','act','msg','lk','calc');
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    alter function auth.uid() owner to postgres;

    create table public.orgs(id uuid primary key);
    create table public.org_members(org_id uuid not null, user_id uuid not null, status text not null, primary key(org_id,user_id));
    create table public.boards(id uuid primary key, org_id uuid not null references public.orgs(id));

    create function public.is_org_member(p_org_id uuid) returns boolean
      language sql stable security definer set search_path = public, pg_temp as $$
        select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid() and status='active')
      $$;

    create function public.board_column_access_policy_is_valid(p jsonb) returns boolean
      language sql immutable security invoker set search_path = public, pg_temp as $$
        select jsonb_typeof(coalesce(p, '{}'::jsonb)) = 'object' and not coalesce(p, '{}'::jsonb) ? 'unknown'
      $$;
    create function public.board_column_validation_is_valid(p jsonb) returns boolean
      language sql immutable security invoker set search_path = public, pg_temp as $$
        select jsonb_typeof(coalesce(p, '{}'::jsonb)) = 'object' and not coalesce(p, '{}'::jsonb) ? 'unknown'
      $$;
    create function public.board_column_metadata_is_valid(validation jsonb, edit_policy jsonb, view_policy jsonb)
      returns boolean language sql immutable security invoker set search_path = public, pg_temp as $$
        select public.board_column_validation_is_valid(validation)
          and public.board_column_access_policy_is_valid(edit_policy)
          and public.board_column_access_policy_is_valid(view_policy)
      $$;

    revoke execute on function public.board_column_metadata_is_valid(jsonb,jsonb,jsonb) from public, anon, authenticated;
    revoke execute on function public.board_column_access_policy_is_valid(jsonb) from public, anon, authenticated;
    revoke execute on function public.board_column_validation_is_valid(jsonb) from public, anon, authenticated;

    create table public.board_columns(
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references public.orgs(id),
      board_id uuid not null references public.boards(id),
      key text not null,
      label text not null,
      type public.field_type not null,
      source public.field_source not null default 'in',
      sort_order integer not null default 0,
      validation_jsonb jsonb not null default '{}',
      edit_policy_jsonb jsonb not null default '{}',
      view_policy_jsonb jsonb not null default '{}',
      constraint board_columns_policy_objects check (
        public.board_column_metadata_is_valid(validation_jsonb, edit_policy_jsonb, view_policy_jsonb)
      ),
      unique(board_id,key)
    );
    alter table public.board_columns enable row level security;
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on public.board_columns to authenticated;
    create policy bcols_select on public.board_columns for select to authenticated using (public.is_org_member(org_id));
    create policy bcols_insert on public.board_columns for insert to authenticated with check (public.is_org_member(org_id));
    create policy bcols_update on public.board_columns for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
    create policy bcols_delete on public.board_columns for delete to authenticated using (public.is_org_member(org_id));

    insert into public.orgs values ('${orgA}'), ('${orgB}');
    insert into public.org_members values ('${orgA}','${userA}','active');
    insert into public.boards values ('${boardA}','${orgA}'), ('${boardB}','${orgB}');
  `);
  await db.exec(guard);
  await db.exec(`
    insert into public.migration_apply_guard
      (logical_key,file_name,file_digest,expected_predecessor,executor,thread_id)
    values
      ('106_bbe240_reserve_ledger_workspace_slug','106_bbe240_reserve_ledger_workspace_slug.sql',repeat('a',64),'105_bbe240_deals_fee_terms','test','bbe-262');
  `);
  return db;
}

async function authenticate(db) {
  await db.exec(`select set_config('request.jwt.claims','{"sub":"${userA}","role":"authenticated"}',false); set role authenticated;`);
}

async function reset(db) {
  await db.exec("reset role; select set_config('request.jwt.claims','',false)");
}

test("복구 migration은 검증기 3종만 열고 probe 뒤 고객 행을 그대로 둔다", async () => {
  const db = await database();
  const before = (await db.query("select count(*)::int n from public.board_columns")).rows[0].n;
  await db.exec(migration);
  const after = (await db.query("select count(*)::int n from public.board_columns")).rows[0].n;
  assert.equal(after, before);

  const rows = (await db.query(`
    select p.oid::regprocedure::text signature, p.prosecdef, p.proconfig,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'board_column_metadata_is_valid','board_column_access_policy_is_valid','board_column_validation_is_valid'
    ) order by p.proname
  `)).rows;
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.prosecdef, false, row.signature);
    assert.deepEqual(row.proconfig, ["search_path=public, pg_temp"], row.signature);
    assert.equal(row.authenticated_execute, true, row.signature);
    assert.equal(row.anon_execute, false, row.signature);
  }
  await db.close();
});

test("authenticated의 실제 쓰기는 성공하고 잘못된 JSON과 타조직 쓰기는 변화 0으로 거부된다", async () => {
  const db = await database();
  await db.exec(migration);
  await authenticate(db);
  await db.exec(`insert into public.board_columns(org_id,board_id,key,label,type) values('${orgA}','${boardA}','valid','Valid','text')`);
  await assert.rejects(
    db.exec(`insert into public.board_columns(org_id,board_id,key,label,type,validation_jsonb) values('${orgA}','${boardA}','invalid','Invalid','text','{"unknown":true}')`),
    /board_columns_policy_objects/,
  );
  await assert.rejects(
    db.exec(`insert into public.board_columns(org_id,board_id,key,label,type) values('${orgB}','${boardB}','foreign','Foreign','text')`),
    /row-level security|violates row-level security policy/i,
  );
  await reset(db);
  assert.deepEqual(
    (await db.query("select board_id::text board_id,key from public.board_columns order by key")).rows,
    [{ board_id: boardA, key: "valid" }],
  );
  await db.close();
});

test("중첩 검증기 EXECUTE 하나라도 회수하면 같은 42501로 실제 쓰기가 RED 된다", async () => {
  const db = await database();
  await db.exec(migration);
  await db.exec("revoke execute on function public.board_column_validation_is_valid(jsonb) from authenticated");
  await authenticate(db);
  await assert.rejects(
    db.exec(`insert into public.board_columns(org_id,board_id,key,label,type) values('${orgA}','${boardA}','mutant','Mutant','text')`),
    (error) => error?.code === "42501" && /board_column_validation_is_valid/.test(error.message),
  );
  await reset(db);
  assert.equal((await db.query("select count(*)::int n from public.board_columns")).rows[0].n, 0);
  await db.close();
});
