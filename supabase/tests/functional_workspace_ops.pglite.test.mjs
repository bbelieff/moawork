import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const names = ["0001_init.sql","001_schema_v1.sql","002_seed_policyfund.sql","003_boards_engine.sql","004_gaps_and_leadin.sql","005_app_admins.sql","006_public_workspace_entry.sql","007_public_workspace_entry_helper_acl.sql","008_workspace_entry_self_route_state.sql","009_workspace_entry_request_lifecycle.sql","010_functional_workspace_ops.sql"];

function compatible(sql) { return sql.split(/\r?\n/u).filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line)).join("\n"); }

test("fresh 0001..010 schema exposes owner-only workspace ops and denies direct DML", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create schema extensions;
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,aud text,role text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')$$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex')$$;
      grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to public;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);
    for (const name of names) {
      if (name === "006_public_workspace_entry.sql") await db.exec(`
        insert into auth.users values('09000000-0000-0000-0000-000000000001','owner@test.invalid','authenticated','authenticated');
        insert into public.users(id,email,name) values('09000000-0000-0000-0000-000000000001','owner@test.invalid','Owner');
        select set_config('request.jwt.claim.sub','09000000-0000-0000-0000-000000000001',false);
        insert into public.orgs(id,name) values('09000000-0000-0000-0000-000000000010','Synthetic');
      `);
      await db.exec(compatible(await readFile(path.join(root,"supabase","migrations",name),"utf8")));
    }
    const present = await db.query(`select to_regprocedure('public.save_workspace_builder_config(uuid,jsonb,uuid)') is not null as builder, to_regprocedure('public.create_workspace_csv_dry_run(uuid,uuid,uuid,jsonb,uuid)') is not null as csv, to_regprocedure('public.activate_workspace_automation(uuid)') is not null as automation`);
    assert.deepEqual(present.rows,[{builder:true,csv:true,automation:true}]);
    const acl = await db.query(`select has_table_privilege('authenticated','public.workspace_builder_configs','insert') as builder_insert, has_function_privilege('anon','public.save_workspace_builder_config(uuid,jsonb,uuid)','execute') as anon_execute, has_function_privilege('authenticated','public.save_workspace_builder_config(uuid,jsonb,uuid)','execute') as auth_execute`);
    assert.deepEqual(acl.rows,[{builder_insert:false,anon_execute:false,auth_execute:true}]);
    await db.exec(`
      begin;
      insert into public.orgs(id,name,slug,status) values
        ('09000000-0000-0000-0000-000000000020','Other','other-workspace','active');
      insert into public.org_members(org_id,user_id,role,scope,status) values
        ('09000000-0000-0000-0000-000000000020','09000000-0000-0000-0000-000000000001','owner','all','active');
      insert into public.boards(id,org_id,name) values
        ('09000000-0000-0000-0000-000000000030','09000000-0000-0000-0000-000000000010','Board A'),
        ('09000000-0000-0000-0000-000000000031','09000000-0000-0000-0000-000000000020','Board B');
      commit;
      select set_config('request.jwt.claim.sub','09000000-0000-0000-0000-000000000001',false);
    `);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.create_workspace_csv_dry_run('09000000-0000-0000-0000-000000000040','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000031','[]'::jsonb,'09000000-0000-0000-0000-000000000041')"),/foreign key|owner required/iu);
    await assert.rejects(db.query("select public.create_workspace_csv_dry_run('09000000-0000-0000-0000-000000000042','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000099','[]'::jsonb,'09000000-0000-0000-0000-000000000043')"),/foreign key/iu);
    await db.query("select public.create_workspace_csv_dry_run('09000000-0000-0000-0000-000000000044','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000030','[{\"title\":\"Imported\",\"values\":{\"status\":\"new\"}}]'::jsonb,'09000000-0000-0000-0000-000000000045')");
    const replay = await db.query("select public.create_workspace_csv_dry_run('09000000-0000-0000-0000-000000000044','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000030','[{\"title\":\"Imported\",\"values\":{\"status\":\"new\"}}]'::jsonb,'09000000-0000-0000-0000-000000000045') as result");
    assert.deepEqual(replay.rows,[{result:{accepted:true,replayed:true,status:'dry_run'}}]);
    await assert.rejects(db.query("select public.create_workspace_csv_dry_run('09000000-0000-0000-0000-000000000046','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000030','[{\"title\":\"Changed\"}]'::jsonb,'09000000-0000-0000-0000-000000000045')"),/idempotency/iu);
    await db.query("select public.save_workspace_automation_draft('09000000-0000-0000-0000-000000000047','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000030','{\"when\":\"x\"}'::jsonb,'09000000-0000-0000-0000-000000000048')");
    await assert.rejects(db.query("select public.save_workspace_automation_draft('09000000-0000-0000-0000-000000000049','09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000030','{\"when\":\"changed\"}'::jsonb,'09000000-0000-0000-0000-000000000048')"),/idempotency/iu);
    await db.query("select public.apply_workspace_csv_batch('09000000-0000-0000-0000-000000000044')");
    await db.exec("reset role");
    assert.deepEqual((await db.query("select count(*)::integer as n from public.items where board_id='09000000-0000-0000-0000-000000000030'")).rows,[{n:1}]);
    await db.exec("set role authenticated");
    await db.query("select public.rollback_workspace_csv_batch('09000000-0000-0000-0000-000000000044')");
    await db.exec("reset role");
    assert.deepEqual((await db.query("select status, jsonb_array_length(applied_item_ids)::integer as n from public.workspace_csv_batches where id='09000000-0000-0000-0000-000000000044'")).rows,[{status:'rolled_back',n:0}]);
    assert.deepEqual((await db.query("select count(*)::integer as n from public.items where board_id='09000000-0000-0000-0000-000000000030'")).rows,[{n:0}]);
    await db.exec("set role authenticated");
    await assert.rejects(db.exec("insert into public.workspace_builder_configs(org_id,updated_by) values('09000000-0000-0000-0000-000000000010','09000000-0000-0000-0000-000000000001')"),/permission denied/iu);
    await db.exec("reset role");
  } finally { await db.close(); }
});
