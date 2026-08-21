import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../migrations/116_bbe225_workspace_entry_pure_read.sql", import.meta.url), "utf8");
const actorA = "10000000-0000-4000-8000-000000000001";
const actorB = "10000000-0000-4000-8000-000000000002";
const orgA = "20000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000002";
const expiredA = "30000000-0000-4000-8000-000000000001";
const pendingA = "30000000-0000-4000-8000-000000000002";
const approvedA = "30000000-0000-4000-8000-000000000003";
const expiredB = "30000000-0000-4000-8000-000000000004";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.orgs(id uuid primary key, slug text not null, status text not null);
    create table public.org_members(org_id uuid not null, user_id uuid not null, status text not null);
    create table public.workspace_entry_requests(
      id uuid primary key, kind text not null, status text not null,
      requester_user_id uuid not null, target_org_id uuid,
      created_at timestamptz not null, review_expires_at timestamptz,
      resolved_at timestamptz, resolved_by uuid, decision_code text
    );
    create table public.workspace_entry_events(
      id bigserial primary key, request_id uuid not null, org_id uuid,
      event_type text not null, outcome text not null, metadata jsonb not null
    );
    revoke all on public.workspace_entry_requests from public, anon, authenticated, service_role;
    revoke all on public.workspace_entry_events from public, anon, authenticated, service_role;
    create function public.begin_guarded_migration(
      p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
      p_executor text default null,p_thread_id text default null,p_foundation boolean default false
    ) returns void language plpgsql as $$ begin null; end $$;
  `);
  await db.exec(migration);
  await db.query("insert into orgs values ($1,'alpha','active'),($2,'beta','active')", [orgA, orgB]);
  await db.query("insert into org_members values ($1,$2,'active')", [orgA, actorA]);
  await db.query(`insert into workspace_entry_requests values
    ($1,'join','pending',$2,$3,clock_timestamp()-interval '15 days',clock_timestamp()-interval '1 day',null,null,null),
    ($4,'join','pending',$2,$3,clock_timestamp(),clock_timestamp()+interval '14 days',null,null,null),
    ($5,'join','approved',$2,$3,clock_timestamp()-interval '2 days',clock_timestamp()+interval '12 days',clock_timestamp()-interval '1 day',null,'approved'),
    ($6,'join','pending',$7,$8,clock_timestamp()-interval '15 days',clock_timestamp()-interval '1 day',null,null,null)`,
    [expiredA, actorA, orgA, pendingA, approvedA, expiredB, actorB, orgB]);
  return db;
}

async function actAs(db, actor) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]);
}

test("hard-load read reports effective expiry without mutating requests or events", async () => {
  const db = await setup();
  try {
    await actAs(db, actorA);
    const before = (await db.query("select status,resolved_at from workspace_entry_requests where id=$1", [expiredA])).rows[0];
    const eventBefore = (await db.query("select count(*)::int count from workspace_entry_events")).rows[0].count;
    const rows = (await db.query("select * from list_my_workspace_entry_requests()")).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.request_id), [pendingA, approvedA, expiredA]);
    const effective = rows.find(row => row.request_id === expiredA);
    assert.equal(effective.request_status, "rejected");
    assert.equal(effective.decision_state, "not_approved");
    assert.ok(effective.resolved_at);
    assert.equal(rows.find(row => row.request_id === approvedA).approved_target_slug, "alpha");
    const after = (await db.query("select status,resolved_at from workspace_entry_requests where id=$1", [expiredA])).rows[0];
    assert.deepEqual(after, before);
    assert.equal((await db.query("select count(*)::int count from workspace_entry_events")).rows[0].count, eventBefore);
  } finally { await db.close(); }
});

test("requester and active-membership boundaries hide cross-tenant rows and approved slugs", async () => {
  const db = await setup();
  try {
    await actAs(db, actorA);
    assert.equal((await db.query("select count(*)::int count from list_my_workspace_entry_requests() where request_id=$1", [expiredB])).rows[0].count, 0);
    await db.query("update org_members set status='removed' where org_id=$1 and user_id=$2", [orgA, actorA]);
    assert.equal((await db.query("select approved_target_slug from list_my_workspace_entry_requests() where request_id=$1", [approvedA])).rows[0].approved_target_slug, null);
  } finally { await db.close(); }
});

test("explicit expiry is repeat-safe and changes exactly one row/event", async () => {
  const db = await setup();
  try {
    await actAs(db, actorA);
    assert.deepEqual((await db.query("select expire_my_workspace_entry_requests() result")).rows[0].result, { expired: 1, events: 1 });
    assert.deepEqual((await db.query("select expire_my_workspace_entry_requests() result")).rows[0].result, { expired: 0, events: 0 });
    assert.equal((await db.query("select count(*)::int count from workspace_entry_requests where id=$1 and status='rejected'", [expiredA])).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int count from workspace_entry_events where request_id=$1 and event_type='join_request_expired'", [expiredA])).rows[0].count, 1);
    assert.equal((await db.query("select status from workspace_entry_requests where id=$1", [expiredB])).rows[0].status, "pending");
  } finally { await db.close(); }
});

test("two locally contending explicit expiry calls converge on one row/event", async () => {
  const db = await setup();
  try {
    await actAs(db, actorA);
    const results = await Promise.all([
      db.query("select expire_my_workspace_entry_requests() result"),
      db.query("select expire_my_workspace_entry_requests() result"),
    ]);
    assert.deepEqual(results.map(result => result.rows[0].result).sort((a,b) => a.expired-b.expired), [
      { expired: 0, events: 0 }, { expired: 1, events: 1 },
    ]);
    assert.equal((await db.query("select count(*)::int count from workspace_entry_events where request_id=$1", [expiredA])).rows[0].count, 1);
  } finally { await db.close(); }
});

test("read is STABLE/DML-free and ACLs expose only authenticated execute", async () => {
  const db = await setup();
  try {
    const read = (await db.query("select provolatile from pg_proc where oid='public.list_my_workspace_entry_requests()'::regprocedure")).rows[0];
    assert.equal(read.provolatile, "s");
    const body = (await db.query("select pg_get_functiondef('public.list_my_workspace_entry_requests()'::regprocedure) body")).rows[0].body;
    assert.doesNotMatch(body, /\b(update|insert|delete|merge)\b/iu);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.list_my_workspace_entry_requests()','execute') ok")).rows[0].ok, true);
    assert.equal((await db.query("select has_function_privilege('anon','public.list_my_workspace_entry_requests()','execute') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.expire_my_workspace_entry_requests()','execute') ok")).rows[0].ok, true);
    assert.equal((await db.query("select has_function_privilege('anon','public.expire_my_workspace_entry_requests()','execute') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_function_privilege('service_role','public.expire_my_workspace_entry_requests()','execute') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_table_privilege('authenticated','public.workspace_entry_requests','select') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_table_privilege('authenticated','public.workspace_entry_requests','update') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_table_privilege('authenticated','public.workspace_entry_events','insert') ok")).rows[0].ok, false);
    await actAs(db, null);
    await assert.rejects(db.query("select expire_my_workspace_entry_requests()"), /authentication required/u);
  } finally { await db.close(); }
});
