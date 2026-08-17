import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);
const migration = await readFile(
  path.join(root, "supabase", "migrations", "088_bbe175_detail_layout_drift_repair.sql"),
  "utf8",
);

const ids = {
  orgA: "10000000-0000-0000-0000-000000000001",
  orgB: "10000000-0000-0000-0000-000000000002",
  ownerA: "20000000-0000-0000-0000-000000000001",
  adminA: "20000000-0000-0000-0000-000000000002",
  memberA: "20000000-0000-0000-0000-000000000003",
  ownerB: "20000000-0000-0000-0000-000000000004",
  boardA: "30000000-0000-0000-0000-000000000001",
  boardB: "30000000-0000-0000-0000-000000000002",
  groupA: "40000000-0000-0000-0000-000000000001",
  groupA2: "40000000-0000-0000-0000-000000000002",
};

async function baseDatabase({ healthy = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create type public.member_role as enum ('owner', 'admin', 'member');
    create type public.field_source as enum ('auto', 'in', 'act', 'msg', 'lk', 'calc');
    create table public.orgs(id uuid primary key);
    create table public.users(id uuid primary key);
    create table public.org_members(
      org_id uuid not null references public.orgs(id),
      user_id uuid not null references public.users(id),
      role public.member_role not null,
      primary key(org_id, user_id)
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function public.is_org_member(p_org_id uuid) returns boolean
      language sql stable security definer set search_path = public, pg_temp as $$
        select exists(select 1 from public.org_members where org_id = p_org_id and user_id = auth.uid())
      $$;
    create function public.org_role(p_org_id uuid) returns public.member_role
      language sql stable security definer set search_path = public, pg_temp as $$
        select role from public.org_members where org_id = p_org_id and user_id = auth.uid()
      $$;
    create table public.boards(
      id uuid primary key,
      org_id uuid not null references public.orgs(id),
      name text not null,
      updated_at timestamptz not null default now()
      ${healthy ? ", detail_layout_jsonb jsonb default '[]'::jsonb" : ""}
    );
    create table public.board_groups(
      id uuid primary key,
      org_id uuid not null references public.orgs(id),
      board_id uuid not null references public.boards(id),
      name text not null
      ${healthy ? ", detail_layout_jsonb jsonb" : ""}
    );
    create table public.board_columns(
      id uuid primary key,
      org_id uuid not null references public.orgs(id),
      board_id uuid not null references public.boards(id),
      key text not null,
      source public.field_source not null default 'in'
    );
    alter table public.boards enable row level security;
    alter table public.board_groups enable row level security;
    create policy boards_member_rw on public.boards for all to authenticated
      using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
    create policy groups_member_rw on public.board_groups for all to authenticated
      using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on public.boards, public.board_groups to authenticated;
    grant execute on function auth.uid(), public.is_org_member(uuid), public.org_role(uuid) to authenticated;

    insert into public.orgs values ('${ids.orgA}'), ('${ids.orgB}');
    insert into public.users values ('${ids.ownerA}'), ('${ids.adminA}'), ('${ids.memberA}'), ('${ids.ownerB}');
    insert into public.org_members values
      ('${ids.orgA}', '${ids.ownerA}', 'owner'),
      ('${ids.orgA}', '${ids.adminA}', 'admin'),
      ('${ids.orgA}', '${ids.memberA}', 'member'),
      ('${ids.orgB}', '${ids.ownerB}', 'owner');
    insert into public.boards(id, org_id, name) values
      ('${ids.boardA}', '${ids.orgA}', 'A'),
      ('${ids.boardB}', '${ids.orgB}', 'B');
    insert into public.board_groups(id, org_id, board_id, name) values
      ('${ids.groupA}', '${ids.orgA}', '${ids.boardA}', 'A1'),
      ('${ids.groupA2}', '${ids.orgA}', '${ids.boardA}', 'A2');
    insert into public.board_columns(id, org_id, board_id, key, source) values
      ('50000000-0000-0000-0000-000000000001', '${ids.orgA}', '${ids.boardA}', 'industry', 'in');
  `);
  return db;
}

async function authenticate(db, userId) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
}

async function asSuperuser(db) {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
}

test("missing schema applies twice without rewriting customer rows", async () => {
  const db = await baseDatabase();
  const before = await db.query("select id, name, updated_at from public.boards order by id");
  await db.exec(migration);
  await db.exec(migration);
  const after = await db.query("select id, name, updated_at, detail_layout_jsonb from public.boards order by id");
  assert.deepEqual(
    after.rows.map(({ detail_layout_jsonb: _layout, ...row }) => row),
    before.rows,
  );
  assert.deepEqual(after.rows.map((row) => row.detail_layout_jsonb), [[], []]);
  const groups = await db.query("select detail_layout_jsonb from public.board_groups order by id");
  assert.deepEqual(groups.rows, [{ detail_layout_jsonb: null }, { detail_layout_jsonb: null }]);
  const source = await db.query("select source::text from public.board_columns where key = 'industry'");
  assert.deepEqual(source.rows, [{ source: "in" }]);
  const enumValues = await db.query(`
    select enumlabel
      from pg_enum
     where enumtypid = 'public.field_source'::regtype
     order by enumsortorder
  `);
  assert.deepEqual(enumValues.rows.map((row) => row.enumlabel), ["auto", "in", "act", "msg", "lk", "calc"]);
  await db.close();
});

test("healthy schema replays and preserves inherit, explicit empty, and sibling state", async () => {
  const db = await baseDatabase({ healthy: true });
  await db.exec(migration);
  await authenticate(db, ids.ownerA);
  await db.exec(`update public.boards set detail_layout_jsonb = '[{"key":"company","source":"column"}]' where id = '${ids.boardA}'`);
  await db.exec(`update public.board_groups set detail_layout_jsonb = '[]' where id = '${ids.groupA}'`);
  let rows = await db.query(`select id, detail_layout_jsonb from public.board_groups where board_id = '${ids.boardA}' order by id`);
  assert.deepEqual(rows.rows, [
    { id: ids.groupA, detail_layout_jsonb: [] },
    { id: ids.groupA2, detail_layout_jsonb: null },
  ]);
  await db.exec(`update public.board_groups set detail_layout_jsonb = null where id = '${ids.groupA}'`);
  rows = await db.query(`select detail_layout_jsonb from public.board_groups where id = '${ids.groupA}'`);
  assert.deepEqual(rows.rows, [{ detail_layout_jsonb: null }]);
  await asSuperuser(db);
  await db.exec(migration);
  await db.close();
});

test("owner and admin can write while member and cross-org actor cannot", async () => {
  const db = await baseDatabase();
  await db.exec(migration);
  await authenticate(db, ids.adminA);
  await db.exec(`update public.boards set detail_layout_jsonb = '[]' where id = '${ids.boardA}'`);

  await authenticate(db, ids.memberA);
  await assert.rejects(
    db.exec(`update public.boards set detail_layout_jsonb = '[{"key":"x","source":"detail"}]' where id = '${ids.boardA}'`),
    /detail layout write requires owner or admin/,
  );

  await authenticate(db, ids.ownerB);
  const hidden = await db.query(`update public.boards set detail_layout_jsonb = '[]' where id = '${ids.boardA}' returning id`);
  assert.equal(hidden.rows.length, 0);

  await authenticate(db, ids.ownerA);
  await assert.rejects(
    db.exec(`update public.boards set detail_layout_jsonb = '{}' where id = '${ids.boardA}'`),
    /boards_detail_layout_array/,
  );
  await db.close();
});
