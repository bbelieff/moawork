import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const names = ["0001_init.sql","001_schema_v1.sql","002_seed_policyfund.sql","003_boards_engine.sql","004_gaps_and_leadin.sql","005_app_admins.sql","006_public_workspace_entry.sql","007_public_workspace_entry_helper_acl.sql","008_workspace_entry_self_route_state.sql","009_workspace_entry_request_lifecycle.sql","010_functional_workspace_ops.sql","011_member_account_ops.sql"];
const tenLocal = path.join(root, "supabase", "migrations", "010_functional_workspace_ops.sql");
const compatible = (sql) => sql.split(/\r?\n/u).filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line)).join("\n");

test("fresh member/account operations are RPC-only, self-scoped, and fail closed", async () => {
  const db = new PGlite();
  const owner = "11000000-0000-0000-0000-000000000001";
  const member = "11000000-0000-0000-0000-000000000002";
  const support = "11000000-0000-0000-0000-000000000003";
  const org = "11000000-0000-0000-0000-000000000010";
  const otherOrg = "11000000-0000-0000-0000-000000000099";
  try {
    await db.exec(`create schema auth; create schema extensions; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,aud text,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')$$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex')$$;
      grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to public;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
    for (const name of names) {
      if (name === "006_public_workspace_entry.sql") await db.exec(`insert into auth.users values('${owner}','owner@test.invalid','authenticated','authenticated'),('${member}','member@test.invalid','authenticated','authenticated'),('${support}','support@test.invalid','authenticated','authenticated'); insert into public.users(id,email,name) values('${owner}','owner@test.invalid','Owner'),('${member}','member@test.invalid','Member'),('${support}','support@test.invalid','Support'); select set_config('request.jwt.claim.sub','${owner}',false); insert into public.orgs(id,name) values('${org}','Synthetic');`);
      const source = name === "010_functional_workspace_ops.sql" ? tenLocal : path.join(root,"supabase","migrations",name);
      await db.exec(compatible(await readFile(source,"utf8")));
    }
    const helperAcl = await db.query(`select
      has_function_privilege('authenticated','public.workspace_ops_require_owner(uuid)','execute') as authenticated_execute,
      has_function_privilege('anon','public.workspace_ops_require_owner(uuid)','execute') as anon_execute,
      exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.workspace_ops_require_owner(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as public_execute`);
    assert.deepEqual(helperAcl.rows,[{authenticated_execute:false,anon_execute:false,public_execute:false}]);
    const sessionAcl = await db.query(`select
      to_regprocedure('public.revoke_current_member_account_session(uuid,boolean)') is null as old_current_absent,
      to_regprocedure('public.revoke_all_member_account_sessions(boolean)') is null as old_all_absent,
      to_regprocedure('public.revoke_my_member_account_sessions(uuid,boolean,boolean)') is null as old_generic_absent,
      has_function_privilege('authenticated','public.acknowledge_external_member_session_cutoff(uuid,text)','execute') as acknowledgement_auth_execute,
      has_function_privilege('service_role','public.acknowledge_external_member_session_cutoff(uuid,text)','execute') as acknowledgement_service_execute`);
    assert.deepEqual(sessionAcl.rows,[{old_current_absent:true,old_all_absent:true,old_generic_absent:true,acknowledgement_auth_execute:false,acknowledgement_service_execute:true}]);
    await db.exec(`insert into public.org_members(org_id,user_id,role,scope,status) values('${org}','${member}','member','assigned','active'); insert into public.app_admins(email,role,is_platform) values('support@test.invalid','admin',true) on conflict (email) do update set role='admin',is_platform=true; begin; insert into public.orgs(id,name,slug,status) values('${otherOrg}','Other','other-workspace','active'); insert into public.org_members(org_id,user_id,role,scope,status) values('${otherOrg}','${support}','owner','all','active'),('${otherOrg}','${member}','member','assigned','active'); commit; select set_config('request.jwt.claim.sub','${owner}',false); select set_config('request.jwt.claim.session_id','11000000-0000-0000-0000-000000000031',false); set role authenticated;`);
    await db.query(`select public.register_my_member_account_session('11000000-0000-0000-0000-000000000032','11000000-0000-0000-0000-000000000031','${org}')`);
    assert.equal((await db.query(`select (public.register_my_member_account_session('11000000-0000-0000-0000-000000000032','11000000-0000-0000-0000-000000000031','${org}'))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await db.query(`select public.save_member_account_profile('${org}','${member}','Team lead','team-a','11000000-0000-0000-0000-000000000021')`);
    assert.equal((await db.query(`select (public.save_member_account_profile('${org}','${member}','Team lead','team-a','11000000-0000-0000-0000-000000000021'))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await assert.rejects(db.query(`select public.save_member_account_profile('${org}','${owner}','Owner','team-a','11000000-0000-0000-0000-000000000023')`),/active non-owner member required/iu);
    await assert.rejects(db.query(`select public.save_member_account_profile('${org}','${member}','Changed','team-a','11000000-0000-0000-0000-000000000021')`),/idempotency key reuse/iu);
    await assert.rejects(db.exec(`insert into public.member_account_profiles(org_id,user_id,updated_by) values('${org}','${member}','${owner}')`),/permission denied/iu);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',false); select set_config('request.jwt.claim.session_id','11000000-0000-0000-0000-000000000033',false); set role authenticated;");
    await db.query(`select public.register_my_member_account_session('11000000-0000-0000-0000-000000000034','11000000-0000-0000-0000-000000000033','${org}')`);
    await assert.rejects(db.query(`select public.save_member_account_profile('${org}','${member}','x','team-a','11000000-0000-0000-0000-000000000022')`),/protected owner required/iu);
    assert.equal((await db.query(`select public.get_member_account_profile('${org}','${member}') is not null as visible`)).rows[0].visible,true);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false); select set_config('request.jwt.claim.session_id','11000000-0000-0000-0000-000000000031',false); set role authenticated;");
    await assert.rejects(db.query(`select public.register_my_member_account_session('11000000-0000-0000-0000-000000000032','11000000-0000-0000-0000-000000000031',null)`),/idempotency key reuse/iu);
    await assert.rejects(db.query(`select public.get_member_account_profile('${otherOrg}','${member}')`),/active membership required/iu);
    await db.exec("reset role; set role service_role;");
    assert.deepEqual((await db.query(`select count(*)::integer as n from public.member_account_sessions where revoked_at is null`)).rows,[{n:2}]);
    await db.exec("reset role; set role authenticated;");
    await db.exec("reset role; set role service_role; update public.member_account_sessions set last_seen_at=now()-interval '7 days' where id='11000000-0000-0000-0000-000000000031'; reset role; set role authenticated;");
    await assert.rejects(db.query(`select public.get_member_account_profile('${org}','${member}')`),/active membership required/iu);
    await db.exec("reset role; set role service_role; update public.member_account_sessions set last_seen_at=now(),created_at=now()-interval '30 days 1 second',absolute_expires_at=now()-interval '1 second' where id='11000000-0000-0000-0000-000000000031'; reset role; set role authenticated;");
    await assert.rejects(db.query(`select public.get_member_account_profile('${org}','${member}')`),/active membership required/iu);
    await db.exec("reset role; set role service_role; update public.member_account_sessions set created_at=now(),last_seen_at=now(),absolute_expires_at=now()+interval '30 days' where id='11000000-0000-0000-0000-000000000031'; reset role; set role authenticated;");
    await db.query(`select public.request_my_privacy_export('11000000-0000-0000-0000-000000000041','${org}')`);
    assert.equal((await db.query(`select (public.request_my_privacy_export('11000000-0000-0000-0000-000000000041','${org}'))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await assert.rejects(db.query(`select public.request_my_privacy_export('11000000-0000-0000-0000-000000000041',null)`),/idempotency key reuse/iu);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',false); set role authenticated;");
    await db.query(`select public.request_support_read_access('11000000-0000-0000-0000-000000000051','${org}','diagnose')`);
    assert.equal((await db.query(`select (public.request_support_read_access('11000000-0000-0000-0000-000000000051','${org}','diagnose'))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await assert.rejects(db.query(`select public.request_support_read_access('11000000-0000-0000-0000-000000000051','${org}','changed purpose')`),/idempotency key reuse/iu);
    await assert.deepEqual((await db.query("select * from public.get_my_support_read_scope() ")).rows,[]);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false); set role authenticated;");
    await assert.rejects(db.query(`select public.approve_support_read_access('11000000-0000-0000-0000-000000000051',1441)`),/pending request and ttl required/iu);
    await db.query(`select public.approve_support_read_access('11000000-0000-0000-0000-000000000051',30)`);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',false); set role authenticated;");
    assert.equal((await db.query("select count(*)::integer as n from public.get_my_support_read_scope() ")).rows[0].n,1);
    await db.exec("reset role; set role service_role; update public.support_access_grants set created_at=now()-interval '2 hours', expires_at=now()-interval '1 second'; reset role; set role authenticated;");
    assert.equal((await db.query("select count(*)::integer as n from public.get_my_support_read_scope() ")).rows[0].n,0);
    await db.exec("reset role; select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false); select set_config('request.jwt.claim.session_id','11000000-0000-0000-0000-000000000031',false); set role authenticated;");
    await db.query(`select public.request_member_account_session_cutoff('11000000-0000-0000-0000-000000000061','11000000-0000-0000-0000-000000000031',false)`);
    assert.equal((await db.query(`select (public.request_member_account_session_cutoff('11000000-0000-0000-0000-000000000061','11000000-0000-0000-0000-000000000031',false))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await assert.rejects(db.query(`select public.request_member_account_session_cutoff('11000000-0000-0000-0000-000000000061','11000000-0000-0000-0000-000000000033',false)`),/idempotency key reuse/iu);
    await assert.rejects(db.query(`select public.save_workspace_builder_config('${org}','{"tabs":[]}'::jsonb,'11000000-0000-0000-0000-000000000062')`),/protected (workspace )?owner required/iu);
    await assert.rejects(db.query(`select public.get_member_account_profile('${org}','${member}')`),/active membership required/iu);
    await db.query(`select public.revoke_current_member_account_session('11000000-0000-0000-0000-000000000063','11000000-0000-0000-0000-000000000031')`);
    assert.equal((await db.query(`select (public.revoke_current_member_account_session('11000000-0000-0000-0000-000000000063','11000000-0000-0000-0000-000000000031'))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await assert.rejects(db.query(`select public.revoke_current_member_account_session('11000000-0000-0000-0000-000000000063','11000000-0000-0000-0000-000000000033')`),/idempotency key reuse/iu);
    await db.query(`select public.revoke_all_member_account_sessions('11000000-0000-0000-0000-000000000064')`);
    assert.equal((await db.query(`select (public.revoke_all_member_account_sessions('11000000-0000-0000-0000-000000000064'))->>'replayed' as replayed`)).rows[0].replayed,'true');
    await db.exec("reset role; set role service_role;");
    assert.deepEqual((await db.query(`select operation,count(*)::integer as n from public.member_account_ops_audit where operation in ('member_profile_saved','session_registered','privacy_export_requested','support_read_requested','session_cutoff_current','session_cutoff_all') group by operation order by operation`)).rows,[{operation:'member_profile_saved',n:1},{operation:'privacy_export_requested',n:1},{operation:'session_cutoff_all',n:1},{operation:'session_cutoff_current',n:2},{operation:'session_registered',n:2},{operation:'support_read_requested',n:1}]);
    await db.exec("reset role");
  } finally { await db.close(); }
});
