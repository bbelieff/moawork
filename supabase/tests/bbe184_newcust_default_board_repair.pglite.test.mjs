import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { PGlite } = await import(pathToFileURL(path.join(root, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const migration = readFileSync(path.join(root, "supabase/migrations/093_bbe184_newcust_default_board_repair.sql"), "utf8");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.orgs(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,role text,status text,primary key(org_id,user_id));
    create table public.workspace_bootstrap_leases(
      org_id uuid primary key references public.orgs(id) on delete cascade,
      holder uuid not null,
      expires_at timestamptz not null,
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(migration);
  return db;
}

test("owner/admin acquire the exact-org lease and replay is idempotent", async () => {
  const db = await database();
  const org = id(1), owner = id(2), admin = id(3), first = id(4), second = id(5);
  await db.exec(`insert into orgs values('${org}'); insert into org_members values
    ('${org}','${owner}','owner','active'),('${org}','${admin}','admin','active');`);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  assert.equal((await db.query("select acquire_default_tab_repair_lease($1,$2) ok", [org, first])).rows[0].ok, true);
  assert.equal((await db.query("select acquire_default_tab_repair_lease($1,$2) ok", [org, first])).rows[0].ok, true);
  assert.equal((await db.query("select acquire_default_tab_repair_lease($1,$2) ok", [org, second])).rows[0].ok, false);
  assert.equal((await db.query("select renew_default_tab_repair_lease($1,$2) ok", [org, first])).rows[0].ok, true);
  assert.equal((await db.query("select release_default_tab_repair_lease($1,$2) ok", [org, first])).rows[0].ok, true);
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`);
  assert.equal((await db.query("select acquire_default_tab_repair_lease($1,$2) ok", [org, second])).rows[0].ok, true);
});

test("member, inactive manager and cross-org actor fail closed without a lease row", async () => {
  const db = await database();
  const org = id(10), other = id(11), member = id(12), inactive = id(13), outsider = id(14), holder = id(15);
  await db.exec(`insert into orgs values('${org}'),('${other}'); insert into org_members values
    ('${org}','${member}','member','active'),
    ('${org}','${inactive}','owner','inactive'),
    ('${other}','${outsider}','owner','active');`);
  for (const actor of [member, inactive, outsider]) {
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`);
    await assert.rejects(
      db.query("select acquire_default_tab_repair_lease($1,$2)", [org, holder]),
      /default tab repair denied/,
    );
  }
  assert.equal((await db.query("select count(*)::int n from workspace_bootstrap_leases")).rows[0].n, 0);
});

test("missing authentication fails closed", async () => {
  const db = await database();
  const org = id(20), holder = id(21);
  await db.exec(`insert into orgs values('${org}')`);
  await assert.rejects(
    db.query("select acquire_default_tab_repair_lease($1,$2)", [org, holder]),
    /default tab repair denied/,
  );
});
