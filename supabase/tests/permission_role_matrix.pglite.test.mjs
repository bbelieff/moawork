import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = (name) => readFile(path.join(root, "supabase", "migrations", name), "utf8");
const ids = {
  org: "10000000-0000-4000-8000-000000000001",
  otherOrg: "10000000-0000-4000-8000-000000000002",
  owner: "20000000-0000-4000-8000-000000000001",
  admin: "20000000-0000-4000-8000-000000000002",
  lead: "20000000-0000-4000-8000-000000000003",
  member: "20000000-0000-4000-8000-000000000004",
  outsider: "20000000-0000-4000-8000-000000000005",
  rootDept: "30000000-0000-4000-8000-000000000001",
  childDept: "30000000-0000-4000-8000-000000000002",
  otherDept: "30000000-0000-4000-8000-000000000003",
  childItem: "40000000-0000-4000-8000-000000000001",
  otherItem: "40000000-0000-4000-8000-000000000002",
  crossTenantItem: "40000000-0000-4000-8000-000000000003",
};

async function actor(db, userId) {
  await db.exec("reset role");
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await db.exec("set role authenticated");
}

test("permission matrix migrations enforce tenant, role, deny, audit, and scope-before-view", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon nologin;
      create role authenticated nologin;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create type public.member_role as enum ('owner','admin','member');
      create type public.member_scope as enum ('all','assigned');
      create table public.orgs(id uuid primary key, status text not null default 'active');
      create table public.users(id uuid primary key);
      create table public.org_members(
        org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
        role public.member_role not null, scope public.member_scope not null, status text not null,
        primary key(org_id,user_id)
      );
      create table public.member_scoped_permission_bindings(
        org_id uuid not null, subject_user_id uuid not null, scope_key text not null,
        decision text not null, access_level text not null, updated_by uuid not null,
        updated_at timestamptz not null default now(), primary key(org_id,subject_user_id,scope_key)
      );
      create table public.departments(
        id uuid primary key, org_id uuid not null, parent_id uuid, archived_at timestamptz
      );
      create table public.department_members(
        org_id uuid not null, dept_id uuid not null, user_id uuid not null, is_primary boolean not null
      );
      create table public.items(id uuid primary key, org_id uuid not null, assigned_to uuid);
      create function public.member_hierarchy_authz_require_owner(p_org_id uuid) returns uuid
      language plpgsql security definer set search_path=public,pg_temp as $$
      declare v_actor uuid := auth.uid(); begin
        if not exists(select 1 from public.org_members where org_id=p_org_id and user_id=v_actor and role='owner' and status='active')
        then raise exception 'owner required' using errcode='42501'; end if;
        return v_actor;
      end $$;
      create function public.member_hierarchy_authz_require_active_nonowner(p_org_id uuid,p_target uuid,p_actor uuid) returns void
      language plpgsql security definer set search_path=public,pg_temp as $$ begin
        if not exists(select 1 from public.org_members where org_id=p_org_id and user_id=p_target and role<>'owner' and status='active')
        then raise exception 'active nonowner required' using errcode='42501'; end if;
      end $$;
      grant usage on schema public,auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(await migration("054_permission_role_enums.sql"));
    await db.exec(await migration("055_permission_role_matrix.sql"));
    await db.exec(`
      insert into public.orgs(id) values ('${ids.org}'),('${ids.otherOrg}');
      insert into public.users(id) values ('${ids.owner}'),('${ids.admin}'),('${ids.lead}'),('${ids.member}'),('${ids.outsider}');
      insert into public.org_members values
        ('${ids.org}','${ids.owner}','owner','all','active'),
        ('${ids.org}','${ids.admin}','admin','all','active'),
        ('${ids.org}','${ids.lead}','team_lead','department','active'),
        ('${ids.org}','${ids.member}','member','assigned','active'),
        ('${ids.otherOrg}','${ids.outsider}','owner','all','active');
      insert into public.departments values
        ('${ids.rootDept}','${ids.org}',null,null),
        ('${ids.childDept}','${ids.org}','${ids.rootDept}',null),
        ('${ids.otherDept}','${ids.org}',null,null);
      insert into public.department_members values
        ('${ids.org}','${ids.rootDept}','${ids.lead}',true),
        ('${ids.org}','${ids.childDept}','${ids.member}',true),
        ('${ids.org}','${ids.otherDept}','${ids.admin}',true);
      insert into public.items values
        ('${ids.childItem}','${ids.org}','${ids.member}'),
        ('${ids.otherItem}','${ids.org}','${ids.admin}'),
        ('${ids.crossTenantItem}','${ids.otherOrg}','${ids.outsider}');
    `);

    const acl = await db.query(`select
      has_function_privilege('public','public.effective_permission(uuid,text)','execute') as public_execute,
      has_function_privilege('anon','public.effective_permission(uuid,text)','execute') as anon_execute,
      has_function_privilege('authenticated','public.effective_permission(uuid,text)','execute') as authenticated_execute`);
    assert.deepEqual(acl.rows, [{ public_execute: false, anon_execute: false, authenticated_execute: true }]);

    await actor(db, ids.member);
    assert.equal((await db.query(`select public.effective_permission('${ids.org}','work.view_tabs') as allowed`)).rows[0].allowed, true);
    await db.exec("reset role");
    await db.exec(`insert into public.member_scoped_permission_bindings values ('${ids.org}','${ids.member}','work.view_tabs','deny','viewer','${ids.owner}',now())`);
    await actor(db, ids.member);
    assert.equal((await db.query(`select public.effective_permission('${ids.org}','work.view_tabs') as allowed`)).rows[0].allowed, false);

    await actor(db, ids.outsider);
    assert.equal((await db.query(`select public.effective_permission('${ids.org}','work.view_tabs') as allowed`)).rows[0].allowed, false);

    await actor(db, ids.lead);
    const childView = (await db.query(`select public.read_permission_scoped_work_items('${ids.org}','${ids.member}') as value`)).rows[0].value;
    assert.deepEqual(childView, { itemIds: [ids.childItem], hiddenCount: 0 });
    const otherView = (await db.query(`select public.read_permission_scoped_work_items('${ids.org}','${ids.admin}') as value`)).rows[0].value;
    assert.deepEqual(otherView, { itemIds: [], hiddenCount: 1 });
    assert.equal(JSON.stringify(childView).includes(ids.crossTenantItem), false);

    await actor(db, ids.owner);
    await assert.rejects(
      db.query(`select public.write_org_role_permission('${ids.org}','owner','work.view_tabs',false,gen_random_uuid())`),
      /owner permission is immutable/,
    );
    const recorded = (await db.query(`select public.record_risky_action('${ids.org}','danger.data_import','{}') as value`)).rows[0].value;
    assert.deepEqual(recorded, { recorded: true });
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::integer as count from public.org_permission_audit where operation='risky_action_recorded'")).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
