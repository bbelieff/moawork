import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const migrations = [
  "0001_init.sql", "001_schema_v1.sql", "002_seed_policyfund.sql", "003_boards_engine.sql",
  "004_gaps_and_leadin.sql", "005_app_admins.sql", "006_public_workspace_entry.sql",
  "007_public_workspace_entry_helper_acl.sql", "008_workspace_entry_self_route_state.sql",
  "009_workspace_entry_request_lifecycle.sql", "010_functional_workspace_ops.sql",
  "011_member_account_ops.sql", "012_workspace_ops_read_list.sql", "013_member_hierarchy_authz.sql",
  "014_platform_metrics_daily.sql", "015_fix_org_helper_session_deadlock.sql",
  "016_platform_console_metrics_alignment.sql",
];
const compatible = (sql) => sql.split(/\r?\n/u).filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line)).join("\n");

test("fresh 0001..016 exposes only the guarded aggregate platform-metrics loader", async () => {
  const db = new PGlite();
  const owner = "16000000-0000-0000-0000-000000000001";
  const platform = "16000000-0000-0000-0000-000000000002";
  const tenant = "16000000-0000-0000-0000-000000000003";
  const orgA = "16000000-0000-0000-0000-000000000010";
  const orgB = "16000000-0000-0000-0000-000000000020";

  try {
    await db.exec(`
      create schema auth; create schema extensions;
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key, email text, aud text, role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;
      create function public.digest(p bytea, a text) returns bytea language sql immutable strict as $$ select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex') $$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$ select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex') $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid(), auth.jwt() to public;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    `);

    for (const name of migrations) {
      if (name === "006_public_workspace_entry.sql") {
        await db.exec(`
          insert into auth.users values ('${owner}', 'owner@test.invalid', 'authenticated', 'authenticated');
          insert into public.users(id,email,name) values ('${owner}', 'owner@test.invalid', 'Owner');
          select set_config('request.jwt.claim.sub', '${owner}', false);
          insert into public.orgs(id,name) values ('${orgA}', 'Synthetic A');
        `);
      }
      await db.exec(compatible(await readFile(path.join(root, "supabase", "migrations", name), "utf8")));
    }

    await db.exec(`
      reset role;
      insert into auth.users values
        ('${platform}', 'platform@test.invalid', 'authenticated', 'authenticated'),
        ('${tenant}', 'tenant@test.invalid', 'authenticated', 'authenticated');
      insert into public.users(id,email,name) values
        ('${platform}', 'platform@test.invalid', 'Platform'),
        ('${tenant}', 'tenant@test.invalid', 'Tenant');
      insert into public.app_admins(email,role,is_platform)
        values ('platform@test.invalid','owner',true)
        on conflict (email) do update set role=excluded.role,is_platform=excluded.is_platform;
      begin;
      insert into public.orgs(id,name,slug,status) values ('${orgB}','Synthetic B','synthetic-b','active');
      insert into public.org_members(org_id,user_id,role,scope,status)
        values ('${orgB}','${owner}','owner','all','active');
      commit;
      insert into public.platform_metrics_daily(day,org_id,dau,mau,stickiness,active_users,dormant_users,new_deals,computed_at) values
        ('2026-07-29','${orgA}',2,10,0.2,2,8,3,'2026-07-29T03:10:00Z'),
        ('2026-07-29','${orgB}',3,15,0.2,3,12,4,'2026-07-29T03:11:00Z');
    `);

    const acl = await db.query(`
      select
        (select relrowsecurity from pg_class where oid = 'public.platform_metrics_daily'::regclass) as metrics_rls_enabled,
        (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'platform_metrics_daily') as metrics_policy_count,
        (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'platform_metrics_daily' and column_name = 'day') as canonical_day_columns,
        (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'platform_metrics_daily' and column_name = 'date') as legacy_date_columns,
        has_table_privilege('anon','public.app_admins','select') as anon_admins_select,
        has_table_privilege('authenticated','public.app_admins','select') as auth_admins_select,
        has_table_privilege('anon','public.platform_metrics_daily','select') as anon_metrics_select,
        has_table_privilege('authenticated','public.platform_metrics_daily','select') as auth_metrics_select,
        has_function_privilege('anon','public.platform_console_metrics_daily(date,date)','execute') as anon_loader_execute,
        has_function_privilege('authenticated','public.platform_console_metrics_daily(date,date)','execute') as auth_loader_execute,
        has_function_privilege('authenticated','public.platform_console_require_operator()','execute') as auth_guard_execute
    `);
    assert.deepEqual(acl.rows, [{
      metrics_rls_enabled: true, metrics_policy_count: 0, canonical_day_columns: 1, legacy_date_columns: 0,
      anon_admins_select: false, auth_admins_select: false,
      anon_metrics_select: false, auth_metrics_select: false,
      anon_loader_execute: false, auth_loader_execute: true, auth_guard_execute: false,
    }]);

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${platform}',false);`);
    const aggregate = await db.query("select * from public.platform_console_metrics_daily('2026-07-29','2026-07-29')");
    assert.deepEqual(aggregate.rows, [{
      day: new Date("2026-07-29T00:00:00.000Z"), workspace_count: 2, dau: 5, mau: 25,
      stickiness: "0.2000", active_users: 5, dormant_users: 20, new_deals: 7,
      computed_at: new Date("2026-07-29T03:11:00.000Z"),
    }]);
    assert.equal(Object.hasOwn(aggregate.rows[0], "org_id"), false);
    await assert.rejects(
      db.query("select * from public.platform_console_metrics_daily('2026-07-30','2026-07-29')"),
      /valid day range required/iu,
    );
    await assert.rejects(db.query("select * from public.platform_metrics_daily"), /permission denied/iu);
    await assert.rejects(db.query("select * from public.app_admins"), /permission denied/iu);

    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${tenant}',false);`);
    await assert.rejects(
      db.query("select * from public.platform_console_metrics_daily('2026-07-29','2026-07-29')"),
      /platform operator required/iu,
    );
    await assert.rejects(db.query("select * from public.platform_metrics_daily"), /permission denied/iu);
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query("select * from public.platform_console_metrics_daily('2026-07-29','2026-07-29')"),
      /permission denied for function/iu,
    );
    await db.exec("reset role;");
  } finally {
    await db.close();
  }
});
