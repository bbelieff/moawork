import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot,
  "node_modules",
  "@electric-sql",
  "pglite",
  "dist",
  "index.js",
)).href);

test("automation condition writes preserve legacy rows and deny unauthorized or cross-tenant rules", async () => {
  const db = new PGlite();
  const owner = "30000000-0000-4000-8000-000000000001";
  const member = "30000000-0000-4000-8000-000000000002";
  const outsider = "30000000-0000-4000-8000-000000000003";
  const org = "30000000-0000-4000-8000-000000000010";
  const otherOrg = "30000000-0000-4000-8000-000000000011";
  const board = "30000000-0000-4000-8000-000000000020";
  const otherBoard = "30000000-0000-4000-8000-000000000021";
  const group = "30000000-0000-4000-8000-000000000030";
  const otherGroup = "30000000-0000-4000-8000-000000000031";

  try {
    await db.exec(`
      create schema auth;
      create role anon nologin;
      create role authenticated nologin;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.orgs(id uuid primary key);
      create table public.org_members(
        org_id uuid not null, user_id uuid not null, role text not null, status text not null,
        primary key(org_id, user_id)
      );
      create table public.boards(id uuid primary key, org_id uuid not null);
      create table public.board_groups(id uuid primary key, board_id uuid not null);
      create table public.board_automation_rules(
        id uuid primary key,
        org_id uuid not null,
        board_id uuid not null,
        status_column_key text not null,
        status_value text not null,
        to_group_id uuid not null,
        enabled boolean not null default true,
        unique(board_id, status_column_key, status_value)
      );
      create function public.org_role(p_org_id uuid) returns text
      language sql stable security definer set search_path = public, pg_temp as $$
        select role from public.org_members
         where org_id = p_org_id and user_id = auth.uid() and status = 'active'
      $$;
      grant usage on schema public, auth to authenticated;
      grant execute on function auth.uid(), public.org_role(uuid) to authenticated;
      grant select, insert, update, delete on public.boards, public.board_groups,
        public.board_automation_rules to authenticated;
      alter table public.boards enable row level security;
      alter table public.board_groups enable row level security;
      alter table public.board_automation_rules enable row level security;
      create policy boards_select on public.boards for select to authenticated
        using (public.org_role(org_id) is not null);
      create policy groups_select on public.board_groups for select to authenticated
        using (exists (select 1 from public.boards board where board.id = board_id));
      create policy bar_select on public.board_automation_rules for select to authenticated
        using (public.org_role(org_id) is not null);
      create policy bar_manage on public.board_automation_rules for all to authenticated
        using (public.org_role(org_id) in ('owner','admin'))
        with check (public.org_role(org_id) in ('owner','admin'));

      insert into public.orgs values ('${org}'), ('${otherOrg}');
      insert into public.org_members values
        ('${org}','${owner}','owner','active'),
        ('${org}','${member}','member','active'),
        ('${otherOrg}','${outsider}','owner','active');
      insert into public.boards values ('${board}','${org}'), ('${otherBoard}','${otherOrg}');
      insert into public.board_groups values ('${group}','${board}'), ('${otherGroup}','${otherBoard}');
      insert into public.board_automation_rules
        (id,org_id,board_id,status_column_key,status_value,to_group_id)
      values ('30000000-0000-4000-8000-000000000040','${org}','${board}','status','legacy','${group}');
    `);

    await db.exec(await readFile(path.join(
      root,
      "supabase",
      "migrations",
      "042_automation_conditions.sql",
    ), "utf8"));

    const acl = await db.query(`select
      has_function_privilege('public', 'public.validate_automation_conditions(jsonb)', 'execute') as public_execute,
      has_function_privilege('anon', 'public.validate_automation_conditions(jsonb)', 'execute') as anon_execute,
      has_function_privilege('authenticated', 'public.validate_automation_conditions(jsonb)', 'execute') as authenticated_execute`);
    assert.deepEqual(acl.rows, [{ public_execute: false, anon_execute: false, authenticated_execute: true }]);

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    await db.query(`insert into public.board_automation_rules
      (id,org_id,board_id,status_column_key,status_value,trigger_label_id,conditions,to_group_id)
      values ('30000000-0000-4000-8000-000000000041','${org}','${board}','status','Done','label:done',
        '[{"column_key":"assignee","operator":"is","value_kind":"user_id","value":"user:owner"}]','${group}')`);
    await assert.rejects(db.query(`insert into public.board_automation_rules
      (id,org_id,board_id,status_column_key,status_value,to_group_id)
      values ('30000000-0000-4000-8000-000000000042','${org}','${board}','status','2','${group}')`),
    /trigger_label_id is required/iu);
    await db.query(`update public.board_automation_rules set enabled = false
      where id = '30000000-0000-4000-8000-000000000040'`);
    await assert.rejects(db.query(`update public.board_automation_rules set status_value = 'changed'
      where id = '30000000-0000-4000-8000-000000000040'`), /trigger_label_id is required/iu);
    await assert.rejects(db.query(`insert into public.board_automation_rules
      (id,org_id,board_id,status_column_key,status_value,trigger_label_id,to_group_id)
      values ('30000000-0000-4000-8000-000000000043','${org}','${otherBoard}','status','Cross','label:cross','${otherGroup}')`),
    /board must belong to its organization|row-level security/iu);

    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${member}',false)`);
    await assert.rejects(db.query(`insert into public.board_automation_rules
      (id,org_id,board_id,status_column_key,status_value,trigger_label_id,to_group_id)
      values ('30000000-0000-4000-8000-000000000044','${org}','${board}','status','Member','label:member','${group}')`),
    /row-level security|permission denied|board must belong/iu);

    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${outsider}',false)`);
    await assert.rejects(db.query(`insert into public.board_automation_rules
      (id,org_id,board_id,status_column_key,status_value,trigger_label_id,to_group_id)
      values ('30000000-0000-4000-8000-000000000045','${org}','${board}','status','Other','label:other','${group}')`),
    /row-level security|permission denied|board must belong/iu);

    await db.exec("reset role");
    const rows = await db.query("select status_value, trigger_label_id, enabled from public.board_automation_rules order by status_value");
    assert.deepEqual(rows.rows, [
      { status_value: "Done", trigger_label_id: "label:done", enabled: true },
      { status_value: "legacy", trigger_label_id: null, enabled: false },
    ]);
  } finally {
    await db.close();
  }
});
