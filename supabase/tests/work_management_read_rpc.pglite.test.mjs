import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(
  pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href,
);
const names = [
  "0001_init.sql",
  "001_schema_v1.sql",
  "002_seed_policyfund.sql",
  "003_boards_engine.sql",
  "004_gaps_and_leadin.sql",
  "005_app_admins.sql",
  "006_public_workspace_entry.sql",
  "007_public_workspace_entry_helper_acl.sql",
  "015_fix_org_helper_session_deadlock.sql",
  "034_work_management_read_rpc.sql",
];
const compatible = (sql) => sql
  .split(/\r?\n/u)
  .filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line))
  .join("\n");

test("read_work_management_board returns an empty tenant-bound board and denies probes", async () => {
  const db = new PGlite();
  const owner = "29000000-0000-0000-0000-000000000001";
  const member = "29000000-0000-0000-0000-000000000002";
  const outsider = "29000000-0000-0000-0000-000000000003";
  const otherOwner = "29000000-0000-0000-0000-000000000004";
  const org = "29000000-0000-0000-0000-000000000010";
  const otherOrg = "29000000-0000-0000-0000-000000000020";

  try {
    await db.exec(`
      create schema auth;
      create schema extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,aud text,role text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$
        select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')
      $$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$
        select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex')
      $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to public;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);

    for (const name of names) {
      if (name === "006_public_workspace_entry.sql") {
        await db.exec(`
          insert into auth.users values
            ('${owner}','owner@test.invalid','authenticated','authenticated'),
            ('${member}','member@test.invalid','authenticated','authenticated'),
            ('${outsider}','outsider@test.invalid','authenticated','authenticated'),
            ('${otherOwner}','other-owner@test.invalid','authenticated','authenticated');
          insert into public.users(id,email,name) values
            ('${owner}','owner@test.invalid','Owner'),
            ('${member}','member@test.invalid','Member'),
            ('${outsider}','outsider@test.invalid','Outsider'),
            ('${otherOwner}','other-owner@test.invalid','Other owner');
          select set_config('request.jwt.claim.sub','${owner}',false);
          insert into public.orgs(id,name) values('${org}','Synthetic');
        `);
      }
      await db.exec(compatible(await readFile(path.join(root, "supabase", "migrations", name), "utf8")));
    }

    await db.exec(`
      begin;
      insert into public.org_members(org_id,user_id,role,scope,status) values
        ('${org}','${member}','member','assigned','active');
      insert into public.orgs(id,name,slug,status) values
        ('${otherOrg}','Other synthetic','other-synthetic','active');
      insert into public.org_members(org_id,user_id,role,scope,status) values
        ('${otherOrg}','${otherOwner}','owner','all','active');
      commit;
    `);

    const contract = await db.query(`
      select
        to_regprocedure('public.read_work_management_board(uuid)') is not null as rpc_exists,
        has_function_privilege('anon','public.read_work_management_board(uuid)','execute') as anon_execute,
        has_function_privilege('authenticated','public.read_work_management_board(uuid)','execute') as auth_execute,
        procedure.prosecdef as security_definer,
        procedure.provolatile = 's' as stable,
        array_to_string(procedure.proconfig, ',') like '%search_path=public, pg_temp%' as fixed_search_path,
        exists (
          select 1
          from aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) privilege
          where privilege.grantee=0 and privilege.privilege_type='EXECUTE'
        ) as public_execute
      from pg_proc procedure
      where procedure.oid='public.read_work_management_board(uuid)'::regprocedure;
    `);
    assert.deepEqual(contract.rows, [{
      rpc_exists: true,
      anon_execute: false,
      auth_execute: true,
      security_definer: false,
      stable: true,
      fixed_search_path: true,
      public_execute: false,
    }]);

    const before = await db.query("select count(*)::integer as items from public.items");
    await db.exec(`
      select set_config('request.jwt.claim.sub','${owner}',false);
      set role authenticated;
    `);
    const ownerResult = await db.query(
      `select public.read_work_management_board('${org}') as snapshot`,
    );
    const snapshot = ownerResult.rows[0].snapshot;
    assert.equal(snapshot.board.orgId, org);
    assert.equal(snapshot.board.templateKey, "work-management");
    assert.equal(snapshot.board.baselineFingerprint, "26a391cc33608c1d87b3d25843745b1d443bc8de4bb2fee6ccab0f094e55012c");
    assert.equal(snapshot.board.currentFingerprint, "d6b98446a4ec4999753c7b258bc5b6b24cb53f99e5b97176221750b82761f67a");
    assert.equal(snapshot.role, "manager");
    assert.equal(snapshot.items.length, 0);
    assert.equal(snapshot.groups.length, 3);
    assert.equal(snapshot.columns.length, 32);
    assert.equal(snapshot.views.length, 3);
    assert.equal(snapshot.members.length, 2);
    assert.equal(snapshot.filesEnabled, false);
    assert.equal(snapshot.columns[17].key, "due_date");
    assert.equal(JSON.stringify(snapshot).includes("test.invalid"), false);
    await assert.rejects(
      db.query(`select public.read_work_management_board('${otherOrg}')`),
      /active workspace membership required/iu,
    );

    await db.exec(`
      reset role;
      select set_config('request.jwt.claim.sub','${member}',false);
      set role authenticated;
    `);
    const memberResult = await db.query(
      `select public.read_work_management_board('${org}') as snapshot`,
    );
    assert.equal(memberResult.rows[0].snapshot.role, "assignee");

    await db.exec(`
      reset role;
      select set_config('request.jwt.claim.sub','${outsider}',false);
      set role authenticated;
    `);
    await assert.rejects(
      db.query(`select public.read_work_management_board('${org}')`),
      /active workspace membership required/iu,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.query(`select public.read_work_management_board('${org}')`),
      /permission denied/iu,
    );
    await db.exec("reset role");

    const after = await db.query("select count(*)::integer as items from public.items");
    assert.deepEqual(after.rows, before.rows);
  } finally {
    await db.close();
  }
});
