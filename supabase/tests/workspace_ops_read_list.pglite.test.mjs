import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(
  pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href
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
  "008_workspace_entry_self_route_state.sql",
  "009_workspace_entry_request_lifecycle.sql",
  "010_functional_workspace_ops.sql",
  "011_member_account_ops.sql",
  "012_workspace_ops_read_list.sql",
  "015_fix_org_helper_session_deadlock.sql",
  "024_workspace_ops_read_owner_alignment.sql",
];
const predecessor011 = process.env.MOAWORK_011_PATH;
const compatible = (sql) =>
  sql
    .split(/\r?\n/u)
    .filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line))
    .join("\n");

async function migrationSource(name) {
  if (name === "011_member_account_ops.sql" && predecessor011) {
    return readFile(predecessor011, "utf8");
  }
  return readFile(path.join(root, "supabase", "migrations", name), "utf8");
}

test("owner read RPCs follow the canonical active-owner contract without a separate session registration", async () => {
  const db = new PGlite();
  const owner = "12000000-0000-0000-0000-000000000001";
  const member = "12000000-0000-0000-0000-000000000002";
  const otherOwner = "12000000-0000-0000-0000-000000000003";
  const org = "12000000-0000-0000-0000-000000000010";
  const otherOrg = "12000000-0000-0000-0000-000000000020";
  const board = "12000000-0000-0000-0000-000000000030";
  const otherBoard = "12000000-0000-0000-0000-000000000040";
  const ownerSession = "12000000-0000-0000-0000-000000000050";
  const memberSession = "12000000-0000-0000-0000-000000000051";

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
            ('${otherOwner}','other-owner@test.invalid','authenticated','authenticated');
          insert into public.users(id,email,name) values
            ('${owner}','owner@test.invalid','Owner'),
            ('${member}','member@test.invalid','Member'),
            ('${otherOwner}','other-owner@test.invalid','Other owner');
          select set_config('request.jwt.claim.sub','${owner}',false);
          insert into public.orgs(id,name) values('${org}','Synthetic');
        `);
      }
      await db.exec(compatible(await migrationSource(name)));
    }

    await db.exec(`
      begin;
      select set_config('request.jwt.claim.sub','${otherOwner}',false);
      insert into public.orgs(id,name,slug,status)
        values('${otherOrg}','Other','other-workspace','active');
      select set_config('request.jwt.claim.sub','${owner}',false);
      insert into public.org_members(org_id,user_id,role,scope,status) values
        ('${org}','${member}','member','assigned','active'),
        ('${otherOrg}','${otherOwner}','owner','all','active');
      insert into public.boards(id,org_id,name,description,icon,is_system,sort_order) values
        ('${board}','${org}','Current board','Current only','table',false,1),
        ('${otherBoard}','${otherOrg}','Other board','Other only','lock',false,1);
      insert into public.workspace_builder_configs(org_id,configuration,version,updated_by) values
        ('${org}','{"tabs":[{"key":"current"}]}'::jsonb,3,'${owner}'),
        ('${otherOrg}','{"tabs":[{"key":"other"}]}'::jsonb,7,'${otherOwner}');
      insert into public.workspace_automation_configs(
        id,org_id,board_id,request_id,draft,state,created_by,updated_by
      ) values
        ('12000000-0000-0000-0000-000000000060','${org}','${board}',
          '12000000-0000-0000-0000-000000000061','{"when":"current"}'::jsonb,'draft','${owner}','${owner}'),
        ('12000000-0000-0000-0000-000000000070','${otherOrg}','${otherBoard}',
          '12000000-0000-0000-0000-000000000071','{"when":"other"}'::jsonb,'active','${otherOwner}','${otherOwner}');
      commit;
    `);

    const acl = await db.query(`
      select
        has_function_privilege('anon','public.list_workspace_ops_boards(uuid)','execute') as boards_anon,
        has_function_privilege('authenticated','public.list_workspace_ops_boards(uuid)','execute') as boards_auth,
        has_function_privilege('anon','public.get_workspace_builder_config(uuid)','execute') as builder_anon,
        has_function_privilege('authenticated','public.get_workspace_builder_config(uuid)','execute') as builder_auth,
        has_function_privilege('anon','public.list_workspace_automation_configs(uuid)','execute') as automation_anon,
        has_function_privilege('authenticated','public.list_workspace_automation_configs(uuid)','execute') as automation_auth,
        has_function_privilege('authenticated','public.workspace_ops_read_require_owner(uuid)','execute') as helper_auth,
        exists (
          select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege
          where p.oid='public.list_workspace_ops_boards(uuid)'::regprocedure
            and privilege.grantee=0 and privilege.privilege_type='EXECUTE'
        ) as boards_public;
    `);
    assert.deepEqual(acl.rows, [{
      boards_anon: false,
      boards_auth: true,
      builder_anon: false,
      builder_auth: true,
      automation_anon: false,
      automation_auth: true,
      helper_auth: false,
      boards_public: false,
    }]);

    await db.exec(`
      select set_config('request.jwt.claim.sub','${owner}',false);
      select set_config('request.jwt.claim.session_id','${ownerSession}',false);
      set role authenticated;
    `);
    const boards = await db.query(
      `select board_id,name from public.list_workspace_ops_boards('${org}')`,
    );
    assert.deepEqual(boards.rows, [{ board_id: board, name: "Current board" }]);
    const builder = await db.query(
      `select configuration,version from public.get_workspace_builder_config('${org}')`,
    );
    assert.deepEqual(builder.rows, [{ configuration: { tabs: [{ key: "current" }] }, version: 3 }]);
    const automations = await db.query(
      `select automation_id,board_id,draft,state from public.list_workspace_automation_configs('${org}')`,
    );
    assert.deepEqual(automations.rows, [{
      automation_id: "12000000-0000-0000-0000-000000000060",
      board_id: board,
      draft: { when: "current" },
      state: "draft",
    }]);
    await assert.rejects(
      db.query(`select * from public.list_workspace_ops_boards('${otherOrg}')`),
      /protected workspace owner required/iu,
    );
    await db.query(
      `select public.register_my_member_account_session(
        '12000000-0000-0000-0000-000000000052','${ownerSession}','${org}'
      )`,
    );

    await db.exec(`
      reset role;
      select set_config('request.jwt.claim.sub','${member}',false);
      select set_config('request.jwt.claim.session_id','${memberSession}',false);
      set role authenticated;
    `);
    await db.query(
      `select public.register_my_member_account_session(
        '12000000-0000-0000-0000-000000000053','${memberSession}','${org}'
      )`,
    );
    await assert.rejects(
      db.query(`select * from public.get_workspace_builder_config('${org}')`),
      /protected workspace owner required/iu,
    );

    await db.exec(`
      reset role;
      select set_config('request.jwt.claim.sub','${owner}',false);
      select set_config('request.jwt.claim.session_id','${ownerSession}',false);
      set role authenticated;
    `);
    await db.query(
      `select public.request_member_account_session_cutoff(
        '12000000-0000-0000-0000-000000000054','${ownerSession}',false
      )`,
    );
    const automationsAfterSessionCutoff = await db.query(
      `select automation_id,board_id,draft,state
         from public.list_workspace_automation_configs('${org}')`,
    );
    assert.deepEqual(automationsAfterSessionCutoff.rows, automations.rows);

    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query(`select * from public.list_workspace_ops_boards('${org}')`),
      /permission denied/iu,
    );
    await db.exec("reset role; set role authenticated;");
    await assert.rejects(
      db.query(`select * from public.workspace_builder_configs`),
      /permission denied/iu,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
