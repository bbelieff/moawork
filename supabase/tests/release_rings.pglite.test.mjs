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

const migrations = [
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
  "013_member_hierarchy_authz.sql",
  "014_platform_metrics_daily.sql",
  "014_reserve_crm_route_slugs.sql",
  "015_fix_org_helper_session_deadlock.sql",
  "016_entry_request_dedup.sql",
  "016_platform_console_metrics_alignment.sql",
  "017_fix_is_platform_admin_role_axis.sql",
  "018_platform_admin_direct_create.sql",
  "019_notifications.sql",
  "020_release_rings.sql",
  "021_reserve_mode_workspace_slug.sql",
  "022_admin_mode_workspace_persistence.sql",
  "023_platform_demo_workspace_bootstrap.sql",
];

const compatible = (sql) =>
  sql
    .split(/\r?\n/u)
    .filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line))
    .join("\n");

test("fresh 0001..023 release rings stay operator-controlled and tenant-safe", async () => {
  const db = new PGlite();
  const bootstrapOwner = "20000000-0000-4000-8000-000000000001";
  const platform = "20000000-0000-4000-8000-000000000002";
  const member = "20000000-0000-4000-8000-000000000003";
  const outsider = "20000000-0000-4000-8000-000000000004";
  const customerOrg = "20000000-0000-4000-8000-000000000010";
  const internalOrg = "20000000-0000-4000-8000-000000000020";
  const otherOrg = "20000000-0000-4000-8000-000000000030";
  const internalBoard = "20000000-0000-4000-8000-000000000040";
  const customerBoard = "20000000-0000-4000-8000-000000000041";
  const memberSession = "20000000-0000-4000-8000-000000000050";

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
      create function auth.jwt() returns jsonb language sql stable as $$
        select jsonb_build_object('email',nullif(current_setting('request.jwt.claim.email',true),''))
      $$;
      create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$
        select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')
      $$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$
        select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex')
      $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.jwt() to public;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);

    for (const name of migrations) {
      if (name === "006_public_workspace_entry.sql") {
        await db.exec(`
          insert into auth.users values
            ('${bootstrapOwner}','owner@test.invalid','authenticated','authenticated'),
            ('${platform}','platform@test.invalid','authenticated','authenticated'),
            ('${member}','member@test.invalid','authenticated','authenticated'),
            ('${outsider}','outsider@test.invalid','authenticated','authenticated');
          insert into public.users(id,email,name) values
            ('${bootstrapOwner}','owner@test.invalid','Owner'),
            ('${platform}','platform@test.invalid','Platform'),
            ('${member}','member@test.invalid','Member'),
            ('${outsider}','outsider@test.invalid','Outsider');
          select set_config('request.jwt.claim.sub','${bootstrapOwner}',false);
          insert into public.orgs(id,name) values('${customerOrg}','Synthetic customer');
        `);
      }
      await db.exec(compatible(await readFile(path.join(root, "supabase", "migrations", name), "utf8")));
    }

    await db.exec(`
      reset role;
      insert into public.app_admins(email,role,is_platform)
        values('platform@test.invalid','owner',true)
        on conflict (email) do update set role=excluded.role,is_platform=excluded.is_platform;
      update public.orgs set slug='customer-workspace',status='active' where id='${customerOrg}';
      insert into public.org_members(org_id,user_id,role,scope,status)
        values('${customerOrg}','${member}','member','assigned','active');

      select set_config('request.jwt.claim.sub','${bootstrapOwner}',false);
      begin;
      insert into public.orgs(id,name,slug,status)
        values('${internalOrg}','Synthetic internal','internal-demo','active');
      insert into public.org_members(org_id,user_id,role,scope,status)
        values('${internalOrg}','${bootstrapOwner}','owner','all','active');
      commit;

      select set_config('request.jwt.claim.sub','${outsider}',false);
      begin;
      insert into public.orgs(id,name,slug,status)
        values('${otherOrg}','Synthetic other','other-workspace','active');
      insert into public.org_members(org_id,user_id,role,scope,status)
        values('${otherOrg}','${outsider}','owner','all','active');
      commit;

      insert into public.boards(id,org_id,name,description,icon,is_system,sort_order)
        values('${internalBoard}','${internalOrg}','Internal board',null,null,false,1);
      insert into public.boards(id,org_id,name,description,icon,is_system,sort_order)
        values('${customerBoard}','${customerOrg}','Customer board',null,null,false,1);
    `);

    const acl = await db.query(`
      select
        has_table_privilege('anon','public.workspace_release_profiles','select') as profile_anon,
        has_table_privilege('authenticated','public.workspace_release_profiles','select') as profile_auth,
        has_table_privilege('authenticated','public.feature_release_controls','select') as feature_auth,
        has_table_privilege('authenticated','public.release_ring_audit','select') as audit_auth,
        has_table_privilege('authenticated','public.admin_mode_workspace_selections','select') as selection_auth,
        has_table_privilege('authenticated','public.admin_mode_workspace_selection_audit','select') as selection_audit_auth,
        has_function_privilege(
          'anon',
          'public.platform_set_workspace_release_profile(uuid,uuid,text,boolean,text,text)',
          'execute'
        ) as profile_mutation_anon,
        has_function_privilege(
          'authenticated',
          'public.platform_set_workspace_release_profile(uuid,uuid,text,boolean,text,text)',
          'execute'
        ) as profile_mutation_auth,
        has_function_privilege(
          'anon',
          'public.platform_set_feature_release(uuid,text,text,boolean,text)',
          'execute'
        ) as feature_mutation_anon,
        has_function_privilege(
          'authenticated',
          'public.resolve_workspace_release_selector(uuid)',
          'execute'
        ) as selector_auth,
        has_function_privilege(
          'anon',
          'public.list_reviewed_internal_demo_release_options()',
          'execute'
        ) as demo_list_anon,
        has_function_privilege(
          'authenticated',
          'public.list_reviewed_internal_demo_release_options()',
          'execute'
        ) as demo_list_auth,
        has_function_privilege(
          'authenticated',
          'public.release_rings_require_operator()',
          'execute'
        ) as guard_auth,
        has_function_privilege(
          'anon',
          'public.platform_set_admin_mode_workspace_selection(uuid,uuid)',
          'execute'
        ) as selection_set_anon,
        has_function_privilege(
          'authenticated',
          'public.platform_set_admin_mode_workspace_selection(uuid,uuid)',
          'execute'
        ) as selection_set_auth,
        has_function_privilege(
          'authenticated',
          'public.get_my_admin_mode_workspace_selection()',
          'execute'
        ) as selection_get_auth;
    `);
    assert.deepEqual(acl.rows, [{
      profile_anon: false,
      profile_auth: false,
      feature_auth: false,
      audit_auth: false,
      selection_auth: false,
      selection_audit_auth: false,
      profile_mutation_anon: false,
      profile_mutation_auth: true,
      feature_mutation_anon: false,
      selector_auth: true,
      demo_list_anon: false,
      demo_list_auth: true,
      guard_auth: false,
      selection_set_anon: false,
      selection_set_auth: true,
      selection_get_auth: true,
    }]);

    await db.exec(`
      set role authenticated;
      select set_config('request.jwt.claim.sub','${outsider}',false);
    `);
    await assert.rejects(
      db.query(`select public.platform_set_feature_release(
        '20000000-0000-4000-8000-000000000061',
        'developer.builder','canary',true,'release_validation'
      )`),
      /platform operator required/iu,
    );
    await assert.rejects(
      db.query("select * from public.list_reviewed_internal_demo_release_options()"),
      /platform operator required/iu,
    );
    await assert.rejects(
      db.query(`select public.platform_set_admin_mode_workspace_selection(
        '20000000-0000-4000-8000-000000000068','${otherOrg}'
      )`),
      /platform operator required/iu,
    );
    await assert.rejects(
      db.query("select * from public.get_my_admin_mode_workspace_selection()"),
      /platform operator required/iu,
    );

    await db.exec(`
      reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${platform}',false);
    `);
    await assert.rejects(
      db.query(`select * from public.resolve_workspace_release_selector('${internalOrg}')`),
      /release selector unavailable/iu,
    );
    const emptyDemoOptions = await db.query(
      "select * from public.list_reviewed_internal_demo_release_options()",
    );
    assert.deepEqual(emptyDemoOptions.rows, []);
    const emptySelection = await db.query(
      "select * from public.get_my_admin_mode_workspace_selection()",
    );
    assert.deepEqual(emptySelection.rows, []);
    await assert.rejects(
      db.query(`select public.platform_set_admin_mode_workspace_selection(
        '20000000-0000-4000-8000-000000000070','${otherOrg}'
      )`),
      /admin mode workspace unavailable/iu,
    );
    await assert.rejects(
      db.query(`select public.platform_set_admin_mode_workspace_selection(
        '20000000-0000-4000-8000-000000000071','${customerOrg}'
      )`),
      /admin mode workspace unavailable/iu,
    );

    const profile = await db.query(`select public.platform_set_workspace_release_profile(
      '20000000-0000-4000-8000-000000000062',
      '${internalOrg}','canary',true,'platform_reviewed_demo','internal_demo_review'
    ) as result`);
    assert.deepEqual(profile.rows[0].result, {
      org_id: internalOrg,
      release_ring: "canary",
      is_internal: true,
      internal_source: "platform_reviewed_demo",
    });

    const replay = await db.query(`select public.platform_set_workspace_release_profile(
      '20000000-0000-4000-8000-000000000062',
      '${internalOrg}','canary',true,'platform_reviewed_demo','internal_demo_review'
    ) as result`);
    assert.deepEqual(replay.rows, profile.rows);
    await assert.rejects(
      db.query(`select public.platform_set_workspace_release_profile(
        '20000000-0000-4000-8000-000000000062',
        '${internalOrg}','stable',true,'platform_reviewed_demo','rollback'
      )`),
      /idempotency key reuse/iu,
    );
    await assert.rejects(
      db.query(`select public.platform_set_workspace_release_profile(
        '20000000-0000-4000-8000-000000000063',
        '${internalOrg}','canary',true,null,'internal_demo_review'
      )`),
      /internal source invalid/iu,
    );

    await db.query(`select public.platform_set_feature_release(
      '20000000-0000-4000-8000-000000000064',
      'developer.builder','canary',true,'release_validation'
    )`);

    const internalSelector = await db.query(
      `select * from public.resolve_workspace_release_selector('${internalOrg}')`,
    );
    assert.deepEqual(internalSelector.rows, [{
      org_id: internalOrg,
      route_path: "/w/internal-demo",
      route_authorization: "reviewed_internal_demo",
      release_ring: "canary",
      is_internal: true,
      internal_source: "platform_reviewed_demo",
      feature_releases: { "developer.builder": true },
    }]);

    const internalSelection = await db.query(`select public.platform_set_admin_mode_workspace_selection(
      '20000000-0000-4000-8000-000000000068','${internalOrg}'
    ) as result`);
    assert.deepEqual(internalSelection.rows, [{ result: {
      org_id: internalOrg,
      route_path: "/w/internal-demo",
      route_authorization: "reviewed_internal_demo",
      release_ring: "canary",
    } }]);
    const internalSelectionReplay = await db.query(`select public.platform_set_admin_mode_workspace_selection(
      '20000000-0000-4000-8000-000000000068','${internalOrg}'
    ) as result`);
    assert.deepEqual(internalSelectionReplay.rows, internalSelection.rows);
    const persistedInternalSelection = await db.query(
      "select * from public.get_my_admin_mode_workspace_selection()",
    );
    assert.deepEqual(persistedInternalSelection.rows, [internalSelection.rows[0].result]);
    const selectedDemoStillCannotReadTenant = await db.query(
      `select id from public.boards where org_id='${internalOrg}'`,
    );
    assert.deepEqual(selectedDemoStillCannotReadTenant.rows, []);

    await assert.rejects(
      db.query(`select * from public.resolve_workspace_release_selector('${otherOrg}')`),
      /release selector unavailable/iu,
    );

    await db.query(`select public.platform_set_workspace_release_profile(
      '20000000-0000-4000-8000-000000000066',
      '${otherOrg}','canary',true,'platform_reviewed_demo','internal_demo_review'
    )`);
    const multipleDemoOptions = await db.query(
      "select * from public.list_reviewed_internal_demo_release_options()",
    );
    assert.deepEqual(multipleDemoOptions.rows, [
      { org_id: internalOrg, route_path: "/w/internal-demo" },
      { org_id: otherOrg, route_path: "/w/other-workspace" },
    ]);

    await db.exec(`
      reset role;
      update public.orgs set status='suspended' where id='${otherOrg}';
      set role authenticated;
      select set_config('request.jwt.claim.sub','${platform}',false);
    `);
    const activeDemoOptions = await db.query(
      "select * from public.list_reviewed_internal_demo_release_options()",
    );
    assert.deepEqual(activeDemoOptions.rows, [
      { org_id: internalOrg, route_path: "/w/internal-demo" },
    ]);

    await db.query(`select public.platform_set_workspace_release_profile(
      '20000000-0000-4000-8000-000000000067',
      '${internalOrg}','stable',true,'platform_reviewed_demo','rollback'
    )`);
    await assert.rejects(
      db.query(`select * from public.resolve_workspace_release_selector('${internalOrg}')`),
      /release selector unavailable/iu,
    );
    const driftedSelection = await db.query(
      "select * from public.get_my_admin_mode_workspace_selection()",
    );
    assert.deepEqual(driftedSelection.rows, []);

    await db.exec(`
      reset role;
      insert into public.org_members(org_id,user_id,role,scope,status)
        values('${customerOrg}','${platform}','member','assigned','active');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${platform}',false);
    `);
    await assert.rejects(
      db.query(`select public.platform_set_admin_mode_workspace_selection(
        '20000000-0000-4000-8000-000000000068','${customerOrg}'
      )`),
      /idempotency key reuse/iu,
    );
    const tenantSelection = await db.query(`select public.platform_set_admin_mode_workspace_selection(
      '20000000-0000-4000-8000-000000000069','${customerOrg}'
    ) as result`);
    assert.deepEqual(tenantSelection.rows, [{ result: {
      org_id: customerOrg,
      route_path: "/w/customer-workspace",
      route_authorization: "active_membership",
      release_ring: "stable",
    } }]);
    const persistedTenantSelection = await db.query(
      "select * from public.get_my_admin_mode_workspace_selection()",
    );
    assert.deepEqual(persistedTenantSelection.rows, [tenantSelection.rows[0].result]);
    const activeMemberCanReadTenant = await db.query(
      `select id from public.boards where org_id='${customerOrg}'`,
    );
    assert.deepEqual(activeMemberCanReadTenant.rows, [{ id: customerBoard }]);

    await db.exec(`
      reset role;
      insert into public.app_admins(email,role,is_platform)
        values('owner@test.invalid','owner',true)
        on conflict (email) do update set role=excluded.role,is_platform=excluded.is_platform;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${bootstrapOwner}',false);
    `);
    await db.query(`select public.platform_set_workspace_release_profile(
      '20000000-0000-4000-8000-000000000070',
      '${internalOrg}','canary',true,'platform_reviewed_demo','internal_demo_review'
    )`);
    await db.query(`select public.platform_set_feature_release(
      '20000000-0000-4000-8000-000000000071',
      'platform_reviewed_demo','canary',true,'release_validation'
    )`);
    const ownedDemoSelection = await db.query(`select public.platform_set_admin_mode_workspace_selection(
      '20000000-0000-4000-8000-000000000072','${internalOrg}'
    ) as result`);
    assert.equal(ownedDemoSelection.rows[0].result.route_authorization, "active_membership");
    const firstBootstrap = await db.query(`select public.platform_ensure_selected_demo_workspace(
      '20000000-0000-4000-8000-000000000073','${internalOrg}'
    ) as result`);
    assert.deepEqual(firstBootstrap.rows, [{ result: { accepted: true, created: true } }]);
    const replayBootstrap = await db.query(`select public.platform_ensure_selected_demo_workspace(
      '20000000-0000-4000-8000-000000000074','${internalOrg}'
    ) as result`);
    assert.deepEqual(replayBootstrap.rows, [{ result: { accepted: true, created: false } }]);
    const demoStorage = await db.query(`
      select
        count(distinct board.id)::integer as boards,
        count(distinct group_row.id)::integer as groups,
        count(distinct column_row.id)::integer as columns
      from public.boards board
      left join public.board_groups group_row on group_row.board_id=board.id
      left join public.board_columns column_row on column_row.board_id=board.id
      where board.org_id='${internalOrg}'
        and board.source='platform_reviewed_demo'
    `);
    assert.deepEqual(demoStorage.rows, [{ boards: 1, groups: 1, columns: 2 }]);
    await db.exec(`
      reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${platform}',false);
    `);

    await db.exec(`
      reset role;
      update public.org_members
         set status='suspended'
       where org_id='${customerOrg}' and user_id='${platform}';
      set role authenticated;
      select set_config('request.jwt.claim.sub','${platform}',false);
    `);
    const revokedTenantSelection = await db.query(
      "select * from public.get_my_admin_mode_workspace_selection()",
    );
    assert.deepEqual(revokedTenantSelection.rows, []);
    const revokedMemberCannotReadTenant = await db.query(
      `select id from public.boards where org_id='${customerOrg}'`,
    );
    assert.deepEqual(revokedMemberCannotReadTenant.rows, []);

    const hiddenBoard = await db.query(
      `select id from public.boards where org_id='${internalOrg}'`,
    );
    assert.deepEqual(hiddenBoard.rows, []);

    await db.exec(`
      reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${member}',false);
      select set_config('request.jwt.claim.session_id','${memberSession}',false);
    `);
    await db.query(`select public.register_my_member_account_session(
      '20000000-0000-4000-8000-000000000065','${memberSession}','${customerOrg}'
    )`);
    const customerSelector = await db.query(
      `select * from public.resolve_workspace_release_selector('${customerOrg}')`,
    );
    assert.deepEqual(customerSelector.rows, [{
      org_id: customerOrg,
      route_path: "/w/customer-workspace",
      route_authorization: "active_membership",
      release_ring: "stable",
      is_internal: false,
      internal_source: null,
      feature_releases: {},
    }]);
    await db.exec(`
      reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${outsider}',false);
    `);
    await assert.rejects(
      db.query(`select * from public.resolve_workspace_release_selector('${internalOrg}')`),
      /release selector unavailable/iu,
    );

    await db.exec("reset role");
    const invariants = await db.query(`
      select
        (select count(*)::integer from public.org_members
          where org_id='${internalOrg}' and user_id='${platform}') as platform_memberships,
        (select count(*)::integer from public.org_members
          where org_id='${internalOrg}') as internal_memberships,
        (select count(*)::integer from public.org_members
          where org_id='${internalOrg}' and role='owner' and scope='all' and status='active') as internal_owners,
        (select count(*)::integer from public.org_members
          where org_id='${customerOrg}' and role='owner' and scope='all' and status='active') as customer_owners,
        (select count(*)::integer from public.org_members
          where org_id='${customerOrg}' and user_id='${platform}') as explicit_platform_tenant_memberships,
        (select count(*)::integer from public.admin_mode_workspace_selection_audit) as selection_audits,
        (select count(*)::integer from public.release_ring_audit
          where operation='workspace_profile_set'
            and request_id='20000000-0000-4000-8000-000000000062') as replay_audits,
        (select count(*)::integer from information_schema.columns
          where table_schema='public' and table_name='release_ring_audit'
            and column_name in ('email','name','slug','note')) as pii_columns,
        (select count(*)::integer from public.release_ring_audit
          where before_state::text like '%@%' or after_state::text like '%@%') as pii_payloads;
    `);
    assert.deepEqual(invariants.rows, [{
      platform_memberships: 0,
      internal_memberships: 1,
      internal_owners: 1,
      customer_owners: 1,
      explicit_platform_tenant_memberships: 1,
        selection_audits: 3,
      replay_audits: 1,
      pii_columns: 0,
      pii_payloads: 0,
    }]);

    await db.exec("set role anon");
    await assert.rejects(
      db.query(`select * from public.resolve_workspace_release_selector('${customerOrg}')`),
      /permission denied/iu,
    );
    await assert.rejects(
      db.query("select * from public.list_reviewed_internal_demo_release_options()"),
      /permission denied/iu,
    );
    await assert.rejects(
      db.query("select * from public.get_my_admin_mode_workspace_selection()"),
      /permission denied/iu,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
