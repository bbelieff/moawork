import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);

test("field source metadata keeps board column tenant RLS", async () => {
  const db = new PGlite();
  const ownerA = "23000000-0000-4000-8000-000000000001";
  const ownerB = "23000000-0000-4000-8000-000000000002";
  const orgA = "23000000-0000-4000-8000-000000000010";
  const orgB = "23000000-0000-4000-8000-000000000011";
  try {
    await db.exec(`
      create schema auth;
      create role authenticated nologin;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create type field_type as enum ('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','url','checkbox');
      create table org_members(org_id uuid, user_id uuid, primary key(org_id,user_id));
      create function is_org_member(p_org_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
        select exists(select 1 from org_members where org_id=p_org_id and user_id=auth.uid())
      $$;
      create table board_columns(id uuid primary key, org_id uuid not null, type field_type not null);
      alter table board_columns enable row level security;
      create policy bcols_rw on board_columns for all to authenticated
        using (is_org_member(org_id)) with check (is_org_member(org_id));
      grant usage on schema public, auth to authenticated;
      grant usage on type field_type to authenticated;
      grant select, update on board_columns to authenticated;
      grant execute on function auth.uid(), is_org_member(uuid) to authenticated;
      insert into org_members values ('${orgA}','${ownerA}'),('${orgB}','${ownerB}');
      insert into board_columns values
        ('23000000-0000-4000-8000-000000000020','${orgA}','text'),
        ('23000000-0000-4000-8000-000000000021','${orgB}','text');
    `);
    await db.exec(await readFile(path.join(root, "supabase", "migrations", "052_field_type_source.sql"), "utf8"));
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ownerA}',false)`);
    assert.deepEqual((await db.query("select source::text,right_pinned from board_columns order by id")).rows,
      [{ source: "in", right_pinned: false }]);
    assert.equal((await db.query("update board_columns set source='act',right_pinned=true returning source::text")).rows[0].source, "act");
    assert.equal((await db.query(`update board_columns set source='msg' where org_id='${orgB}' returning id`)).rows.length, 0);
  } finally {
    await db.close();
  }
});
