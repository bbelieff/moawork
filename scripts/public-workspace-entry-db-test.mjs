#!/usr/bin/env node
/**
 * PUBLIC-WORKSPACE-ENTRY-01 disposable PostgreSQL runner.
 *
 * Required environment variable:
 *   PUBLIC_WORKSPACE_ENTRY_TEST_DATABASE_URL
 *
 * The URL must target an admin connection on a disposable-capable PostgreSQL
 * server. This runner creates a randomly named database, applies 0001..006,
 * runs the SQL attack suite plus a real two-connection concurrency probe, and
 * always drops the database. The URL is never printed.
 *
 * CHECKPOINT runner-first-write 2026-07-27 KST
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(root, "supabase", "migrations");
const sqlTestPath = path.join(root, "supabase", "tests", "public_workspace_entry.sql");
const sourceUrl = process.env.PUBLIC_WORKSPACE_ENTRY_TEST_DATABASE_URL;

if (!sourceUrl) {
  console.error(
    "NOT_RUN: PUBLIC_WORKSPACE_ENTRY_TEST_DATABASE_URL is required for the disposable PostgreSQL gate.",
  );
  process.exit(2);
}

const databaseName = `moawork_public_entry_${crypto.randomBytes(8).toString("hex")}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const adminUrl = new URL(sourceUrl);
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;

const admin = new Client({ connectionString: adminUrl.toString() });
let databaseCreated = false;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function setActor(client, actorId) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId]);
}

async function bootstrapSupabasePrimitives(client) {
  await client.query(`
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
    create table if not exists auth.users (
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
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to public;
  `);
}

async function applyMigrations(client) {
  const names = [
    "0001_init.sql",
    "001_schema_v1.sql",
    "002_seed_policyfund.sql",
    "003_boards_engine.sql",
    "004_gaps_and_leadin.sql",
    "005_app_admins.sql",
    "006_public_workspace_entry.sql",
  ];
  for (const name of names) {
    const sql = await fs.readFile(path.join(migrationDirectory, name), "utf8");
    await client.query(sql);
  }
  return names;
}

async function runSqlSuite(client) {
  const raw = await fs.readFile(sqlTestPath, "utf8");
  const sql = raw
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
  const result = await client.query(sql);
  const finalResult = [...result].reverse().find((entry) => entry.rows?.[0]?.result)?.rows[0].result;
  assert(finalResult === "PUBLIC_WORKSPACE_ENTRY_SQL_PASS", "SQL suite completion marker");
}

async function runConcurrencySuite() {
  const setup = new Client({ connectionString: testUrl.toString() });
  await setup.connect();
  try {
    await setup.query(`
      insert into auth.users (id, email, aud, role) values
        ('60000000-0000-0000-0000-000000000001', 'concurrency-platform@test.invalid', 'authenticated', 'authenticated'),
        ('60000000-0000-0000-0000-000000000002', 'concurrency-a@test.invalid', 'authenticated', 'authenticated'),
        ('60000000-0000-0000-0000-000000000003', 'concurrency-b@test.invalid', 'authenticated', 'authenticated');
      insert into public.users (id, email, name) values
        ('60000000-0000-0000-0000-000000000001', 'concurrency-platform@test.invalid', 'Concurrency Platform'),
        ('60000000-0000-0000-0000-000000000002', 'concurrency-a@test.invalid', 'Concurrency A'),
        ('60000000-0000-0000-0000-000000000003', 'concurrency-b@test.invalid', 'Concurrency B');
      insert into public.app_admins (email, role, is_platform)
      values ('concurrency-platform@test.invalid', 'admin', true);
    `);
  } finally {
    await setup.end();
  }

  const submitA = new Client({ connectionString: testUrl.toString() });
  const submitB = new Client({ connectionString: testUrl.toString() });
  await Promise.all([submitA.connect(), submitB.connect()]);
  try {
    await Promise.all([
      setActor(submitA, "60000000-0000-0000-0000-000000000002"),
      setActor(submitB, "60000000-0000-0000-0000-000000000003"),
    ]);
    await Promise.all([
      submitA.query(
        "select public.submit_workspace_create_request($1, $2, $3)",
        ["61000000-0000-0000-0000-000000000001", "Race A", "race-space"],
      ),
      submitB.query(
        "select public.submit_workspace_create_request($1, $2, $3)",
        ["61000000-0000-0000-0000-000000000002", "Race B", "race-space"],
      ),
    ]);
  } finally {
    await Promise.all([submitA.end(), submitB.end()]);
  }

  const approveA = new Client({ connectionString: testUrl.toString() });
  const approveB = new Client({ connectionString: testUrl.toString() });
  await Promise.all([approveA.connect(), approveB.connect()]);
  let approvalResults;
  try {
    await Promise.all([
      setActor(approveA, "60000000-0000-0000-0000-000000000001"),
      setActor(approveB, "60000000-0000-0000-0000-000000000001"),
    ]);
    approvalResults = await Promise.allSettled([
      approveA.query(
        "select public.resolve_workspace_create_request($1, true, 'concurrency')",
        ["61000000-0000-0000-0000-000000000001"],
      ),
      approveB.query(
        "select public.resolve_workspace_create_request($1, true, 'concurrency')",
        ["61000000-0000-0000-0000-000000000002"],
      ),
    ]);
  } finally {
    await Promise.all([approveA.end(), approveB.end()]);
  }

  assert(
    approvalResults.filter((result) => result.status === "fulfilled").length === 1,
    "exactly one concurrent same-slug approval succeeds",
  );
  assert(
    approvalResults.filter((result) => result.status === "rejected").length === 1,
    "exactly one concurrent same-slug approval is rejected",
  );

  const verify = new Client({ connectionString: testUrl.toString() });
  await verify.connect();
  try {
    const state = await verify.query(`
      select
        (select count(*)::integer from public.orgs where slug = 'race-space') as org_count,
        (select count(*)::integer
         from public.org_members member
         join public.orgs organization on organization.id = member.org_id
         where organization.slug = 'race-space' and member.role = 'owner') as owner_count,
        (select count(*)::integer from public.workspace_entry_requests
         where id in (
           '61000000-0000-0000-0000-000000000001',
           '61000000-0000-0000-0000-000000000002'
         ) and status = 'approved') as approved_count,
        (select count(*)::integer from public.workspace_entry_events
         where event_type = 'create_request_resolved' and outcome = 'approved') as approval_audit_count
    `);
    assert(state.rows[0].org_count === 1, "concurrency creates one workspace");
    assert(state.rows[0].owner_count === 1, "concurrency creates one protected owner");
    assert(state.rows[0].approved_count === 1, "concurrency resolves one request approved");
    assert(state.rows[0].approval_audit_count === 1, "concurrency writes one approval audit");
  } finally {
    await verify.end();
  }
}

try {
  await admin.connect();
  await admin.query(`create database ${quoteIdentifier(databaseName)}`);
  databaseCreated = true;

  const testClient = new Client({ connectionString: testUrl.toString() });
  await testClient.connect();
  let migrationNames;
  try {
    await bootstrapSupabasePrimitives(testClient);
    migrationNames = await applyMigrations(testClient);
    await runSqlSuite(testClient);
  } finally {
    await testClient.end();
  }

  await runConcurrencySuite();
  console.log(`PASS: ${migrationNames.length} migrations; SQL suite PASS; concurrency suite PASS; skip=0`);
} finally {
  if (databaseCreated) {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
  }
  await admin.end().catch(() => undefined);
}

// CHECKPOINT runner-material 2026-07-27 KST
// Real concurrency uses two independent connections; no static-string proxy.
