import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const labRoot = path.resolve(repositoryRoot, "..", "labs", "multi-workspace-entry");
const pgliteModule = path.join(
  labRoot,
  "node_modules",
  "@electric-sql",
  "pglite",
  "dist",
  "index.js",
);
const { PGlite } = await import(pathToFileURL(pgliteModule).href);

const migrationNames = [
  "0001_init.sql",
  "001_schema_v1.sql",
  "002_seed_policyfund.sql",
  "003_boards_engine.sql",
  "004_gaps_and_leadin.sql",
  "005_app_admins.sql",
  "006_public_workspace_entry.sql",
  "007_public_workspace_entry_helper_acl.sql",
];

let db;

function pgliteCompatibleSql(sql) {
  // PGlite 0.5.4 does not ship the pgcrypto extension. Production SQL keeps
  // pgcrypto; this local executable gate replaces only the CREATE EXTENSION
  // statements and supplies deterministic-shape crypto stubs below. Security
  // strength of pgcrypto itself remains a hosted PostgreSQL verification item.
  return sql
    .split(/\r?\n/u)
    .filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line))
    .join("\n");
}

async function bootstrapSupabasePrimitives() {
  await db.exec(`
    create schema if not exists auth;
    create schema if not exists extensions;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end;
    $$;

    create table auth.users (
      id uuid primary key,
      email text,
      aud text,
      role text
    );

    create or replace function auth.uid()
      returns uuid
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

    create or replace function public.digest(p_data bytea, p_algorithm text)
      returns bytea
      language sql
      immutable
      strict
      as $$
        select decode(
          md5(encode(p_data, 'hex') || ':' || p_algorithm)
          || md5('second:' || encode(p_data, 'hex') || ':' || p_algorithm),
          'hex'
        )
      $$;

    create or replace function public.gen_random_bytes(p_length integer)
      returns bytea
      language sql
      volatile
      strict
      as $$
        select decode(
          substr(
            repeat(md5(random()::text || clock_timestamp()::text), 8),
            1,
            p_length * 2
          ),
          'hex'
        )
      $$;

    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);
}

before(async () => {
  db = new PGlite();
  await bootstrapSupabasePrimitives();
});

after(async () => {
  if (db) await db.close();
});

test("applies exact base migrations 0001..007 to a fresh PGlite database", async () => {
  for (const name of migrationNames) {
    if (name === "006_public_workspace_entry.sql") {
      await db.exec(`
        insert into auth.users (id, email, aud, role)
        values ('09000000-0000-0000-0000-000000000001', 'legacy-owner@test.invalid', 'authenticated', 'authenticated');
        insert into public.users (id, email, name)
        values ('09000000-0000-0000-0000-000000000001', 'legacy-owner@test.invalid', 'Legacy Owner');
        select set_config('request.jwt.claim.sub', '09000000-0000-0000-0000-000000000001', false);
        insert into public.orgs (id, name)
        values ('09000000-0000-0000-0000-000000000010', 'Legacy Workspace');
      `);
    }
    const migrationPath = path.join(repositoryRoot, "supabase", "migrations", name);
    const sql = pgliteCompatibleSql(await readFile(migrationPath, "utf8"));
    await db.exec(sql);
  }

  const applied = await db.query(`
    select
      to_regclass('public.workspace_entry_requests') is not null as requests,
      to_regclass('public.workspace_invite_codes') is not null as invites,
      to_regclass('public.workspace_entry_events') is not null as events,
      to_regprocedure('public.resolve_workspace_create_request(uuid,boolean,text)') is not null as create_rpc,
      to_regprocedure('public.resolve_workspace_join_request(uuid,boolean,text)') is not null as join_rpc,
      to_regprocedure('public.list_my_workspace_entry_requests()') is not null as requester_read_rpc
  `);
  assert.deepEqual(applied.rows, [
    {
      requests: true,
      invites: true,
      events: true,
      create_rpc: true,
      join_rpc: true,
      requester_read_rpc: true,
    },
  ]);

  const legacy = await db.query(`
    select organization.status as workspace_status, membership.status as membership_status
    from public.orgs organization
    join public.org_members membership on membership.org_id = organization.id
    where organization.id = '09000000-0000-0000-0000-000000000010'
  `);
  assert.deepEqual(legacy.rows, [{ workspace_status: "active", membership_status: "active" }]);

  // Keep the second test isolated while proving the 001-era row was backfilled.
  await db.exec(`
    delete from public.orgs where id = '09000000-0000-0000-0000-000000000010';
    delete from public.users where id = '09000000-0000-0000-0000-000000000001';
    delete from auth.users where id = '09000000-0000-0000-0000-000000000001';
    select set_config('request.jwt.claim.sub', '', false);
  `);
});

test("keeps authenticated helper access while denying anon and PUBLIC", async () => {
  const acl = await db.query(`
    with target_functions as (
      select p.oid, p.proacl, p.proowner
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.oid in (
          'public.is_platform_admin()'::regprocedure,
          'public.is_protected_workspace_owner(uuid)'::regprocedure,
          'public.shares_workspace_with(uuid)'::regprocedure
        )
    )
    select
      count(*) filter (
        where has_function_privilege('anon', oid, 'EXECUTE')
      )::integer as anon_execute,
      count(*) filter (
        where has_function_privilege('authenticated', oid, 'EXECUTE')
      )::integer as authenticated_execute,
      count(*) filter (
        where exists (
          select 1
          from aclexplode(coalesce(proacl, acldefault('f', proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )::integer as public_execute
    from target_functions
  `);

  assert.deepEqual(acl.rows, [
    { anon_execute: 0, authenticated_execute: 3, public_execute: 0 },
  ]);

  const anonymousProbes = [
    "select public.is_platform_admin()",
    "select public.is_protected_workspace_owner('00000000-0000-0000-0000-000000000000'::uuid)",
    "select public.shares_workspace_with('00000000-0000-0000-0000-000000000000'::uuid)",
  ];

  for (const probe of anonymousProbes) {
    await db.exec("set role anon");
    try {
      await assert.rejects(db.query(probe), /permission denied for function/iu);
    } finally {
      await db.exec("reset role");
    }
  }
});

test("runs the public-entry SQL attack and atomicity suite with skip=0", async () => {
  const testPath = path.join(repositoryRoot, "supabase", "tests", "public_workspace_entry.sql");
  const sql = (await readFile(testPath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");

  await db.exec(sql);

  // The suite rolls itself back. A fresh read proves it did not leak fixtures.
  const residual = await db.query(`
    select
      (select count(*)::integer from public.workspace_entry_requests) as requests,
      (select count(*)::integer from public.orgs) as workspaces
  `);
  assert.deepEqual(residual.rows, [{ requests: 0, workspaces: 0 }]);
});

// CHECKPOINT pglite-material 2026-07-27 KST
// Fresh schema execution is local/non-hosted. True multi-connection races,
// PostgREST/JWT-to-GUC, pooler, hosted migration, and production remain NOT_RUN.
