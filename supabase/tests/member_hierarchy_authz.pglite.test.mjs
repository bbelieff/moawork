// CHECKPOINT: first material test write for MEMBER-AUTHZ-013.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const names = ["0001_init.sql","001_schema_v1.sql","002_seed_policyfund.sql","003_boards_engine.sql","004_gaps_and_leadin.sql","005_app_admins.sql","006_public_workspace_entry.sql","007_public_workspace_entry_helper_acl.sql","008_workspace_entry_self_route_state.sql","009_workspace_entry_request_lifecycle.sql","010_functional_workspace_ops.sql","011_member_account_ops.sql","012_workspace_ops_read_list.sql","013_member_hierarchy_authz.sql"];
const compatible = (sql) => sql.split(/\r?\n/u).filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line)).join("\n");

test("fresh 0001..013 owner-only member hierarchy and scoped bindings are replay-safe", async () => {
  const db = new PGlite();
  const owner = "13000000-0000-0000-0000-000000000001";
  const manager = "13000000-0000-0000-0000-000000000002";
  const member = "13000000-0000-0000-0000-000000000003";
  const outsider = "13000000-0000-0000-0000-000000000004";
  const org = "13000000-0000-0000-0000-000000000010";
  const otherOrg = "13000000-0000-0000-0000-000000000020";
  const ownerSession = "13000000-0000-0000-0000-000000000030";
  const managerSession = "13000000-0000-0000-0000-000000000031";
  try {
    await db.exec(`
      create schema auth; create schema extensions;
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,aud text,role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$ select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex') $$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$ select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex') $$;
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
            ('${manager}','manager@test.invalid','authenticated','authenticated'),
            ('${member}','member@test.invalid','authenticated','authenticated'),
            ('${outsider}','outsider@test.invalid','authenticated','authenticated');
          insert into public.users(id,email,name) values
            ('${owner}','owner@test.invalid','Owner'),('${manager}','manager@test.invalid','Manager'),
            ('${member}','member@test.invalid','Member'),('${outsider}','outsider@test.invalid','Outsider');
          select set_config('request.jwt.claim.sub','${owner}',false);
          insert into public.orgs(id,name) values('${org}','Synthetic');
        `);
      }
      await db.exec(compatible(await readFile(path.join(root,"supabase","migrations",name),"utf8")));
    }
    await db.exec(`
      begin;
      select set_config('request.jwt.claim.sub','${owner}',false);
      insert into public.org_members(org_id,user_id,role,scope,status) values
        ('${org}','${manager}','member','assigned','active'),
        ('${org}','${member}','member','assigned','active');
      select set_config('request.jwt.claim.sub','${outsider}',false);
      insert into public.orgs(id,name,slug,status) values('${otherOrg}','Other','other-org','active');
      insert into public.org_members(org_id,user_id,role,scope,status) values('${otherOrg}','${outsider}','owner','all','active');
      commit;
      select set_config('request.jwt.claim.sub','${owner}',false);
      select set_config('request.jwt.claim.session_id','${ownerSession}',false);
      set role authenticated;
    `);
    const acl = await db.query(`select
      has_function_privilege('anon','public.set_workspace_member_hierarchy_role_scope(uuid,uuid,uuid,public.member_role,public.member_scope,uuid)','execute') as hierarchy_anon,
      has_function_privilege('authenticated','public.set_workspace_member_hierarchy_role_scope(uuid,uuid,uuid,public.member_role,public.member_scope,uuid)','execute') as hierarchy_auth,
      has_function_privilege('anon','public.bind_workspace_lower_member_permission(uuid,uuid,text,text,text,uuid)','execute') as binding_anon,
      has_function_privilege('authenticated','public.bind_workspace_lower_member_permission(uuid,uuid,text,text,text,uuid)','execute') as binding_auth;
    `);
    assert.deepEqual(acl.rows,[{hierarchy_anon:false,hierarchy_auth:true,binding_anon:false,binding_auth:true}]);
    await db.query(`select public.register_my_member_account_session('13000000-0000-0000-0000-000000000040','${ownerSession}','${org}')`);

    const hierarchyRequest = "13000000-0000-0000-0000-000000000041";
    const first = await db.query(`select public.set_workspace_member_hierarchy_role_scope('${org}','${member}','${manager}','admin','all','${hierarchyRequest}') as result`);
    assert.deepEqual(first.rows[0].result,{accepted:true,replayed:false});
    const replay = await db.query(`select public.set_workspace_member_hierarchy_role_scope('${org}','${member}','${manager}','admin','all','${hierarchyRequest}') as result`);
    assert.deepEqual(replay.rows[0].result,{accepted:true,replayed:true});
    await assert.rejects(db.query(`select public.set_workspace_member_hierarchy_role_scope('${org}','${member}','${manager}','member','all','${hierarchyRequest}')`),/idempotency key reuse/iu);
    await assert.rejects(db.query(`select public.set_workspace_member_hierarchy_role_scope('${org}','${manager}','${member}','member','assigned','13000000-0000-0000-0000-000000000051')`),/hierarchy cycle/iu);
    await db.exec(`reset role;`);
    const changed = await db.query(`select role::text,scope::text from public.org_members where org_id='${org}' and user_id='${member}'`);
    assert.deepEqual(changed.rows,[{role:"admin",scope:"all"}]);
    await db.exec(`set role authenticated;`);

    await assert.rejects(db.query(`select public.bind_workspace_lower_member_permission('${org}','${member}','board:admin','allow','editor','13000000-0000-0000-0000-000000000042')`),/active member target required/iu);
    await db.exec(`reset role;`);
    const beforeBindingAudit = await db.query(`select count(*)::int as count from public.member_hierarchy_authz_audit where operation='member_scoped_permission_bound'`);
    assert.deepEqual(beforeBindingAudit.rows,[{count:0}]);
    await db.exec(`set role authenticated;`);
    const bindingRequest = "13000000-0000-0000-0000-000000000043";
    const bound = await db.query(`select public.bind_workspace_lower_member_permission('${org}','${manager}','board:deals','deny','viewer','${bindingRequest}') as result`);
    assert.deepEqual(bound.rows[0].result,{accepted:true,replayed:false});
    const bindingReplay = await db.query(`select public.bind_workspace_lower_member_permission('${org}','${manager}','board:deals','deny','viewer','${bindingRequest}') as result`);
    assert.deepEqual(bindingReplay.rows[0].result,{accepted:true,replayed:true});
    await db.exec(`reset role;`);
    const binding = await db.query(`select decision,access_level from public.member_scoped_permission_bindings where org_id='${org}' and subject_user_id='${manager}' and scope_key='board:deals'`);
    assert.deepEqual(binding.rows,[{decision:"deny",access_level:"viewer"}]);
    const audit = await db.query(`select operation,count(*)::int as count from public.member_hierarchy_authz_audit group by operation order by operation`);
    assert.deepEqual(audit.rows,[{operation:"member_hierarchy_role_scope_set",count:1},{operation:"member_scoped_permission_bound",count:1}]);
    await db.exec(`set role authenticated;`);

    await assert.rejects(db.query(`select public.set_workspace_member_hierarchy_role_scope('${org}','${owner}',null,'member','assigned','13000000-0000-0000-0000-000000000043')`),/active non-owner|self/iu);
    await assert.rejects(db.query(`select public.set_workspace_member_hierarchy_role_scope('${org}','${member}','${member}','member','assigned','13000000-0000-0000-0000-000000000044')`),/self reporting/iu);
    await assert.rejects(db.query(`select public.bind_workspace_lower_member_permission('${otherOrg}','${outsider}','board:x','allow','editor','13000000-0000-0000-0000-000000000045')`),/protected workspace owner/iu);

    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${manager}',false); select set_config('request.jwt.claim.session_id','${managerSession}',false); set role authenticated;`);
    await db.query(`select public.register_my_member_account_session('13000000-0000-0000-0000-000000000046','${managerSession}','${org}')`);
    await assert.rejects(db.query(`select public.bind_workspace_lower_member_permission('${org}','${member}','board:x','allow','editor','13000000-0000-0000-0000-000000000047')`),/protected workspace owner/iu);
    await db.exec(`reset role; set role authenticated;`);
    await assert.rejects(db.query(`update public.org_members set role='owner' where org_id='${org}' and user_id='${member}'`),/permission denied/iu);
    await assert.rejects(db.query(`select * from public.member_hierarchy_authz_audit`),/permission denied/iu);
    await db.exec(`reset role; set role anon;`);
    await assert.rejects(db.query(`select public.bind_workspace_lower_member_permission('${org}','${member}','board:x','allow','editor','13000000-0000-0000-0000-000000000048')`),/permission denied/iu);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${owner}',false); select set_config('request.jwt.claim.session_id','${ownerSession}',false); set role authenticated;`);
    await db.query(`select public.request_member_account_session_cutoff('13000000-0000-0000-0000-000000000049','${ownerSession}',false)`);
    await assert.rejects(db.query(`select public.bind_workspace_lower_member_permission('${org}','${member}','board:after-cutoff','allow','viewer','13000000-0000-0000-0000-000000000050')`),/protected workspace owner/iu);
    await db.exec(`reset role`);
  } finally { await db.close(); }
});
