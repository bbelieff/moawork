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

test("checklist RLS rejects a checklist whose org does not own the deal", async () => {
  const db = new PGlite();
  const user = "11000000-0000-4000-8000-000000000001";
  const orgA = "11000000-0000-4000-8000-000000000010";
  const orgB = "11000000-0000-4000-8000-000000000011";
  const dealB = "11000000-0000-4000-8000-000000000020";
  try {
    await db.exec(`
      create schema auth;
      create role authenticated nologin;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.orgs(id uuid primary key);
      create table public.org_members(org_id uuid not null, user_id uuid not null, primary key(org_id,user_id));
      create table public.deals(id uuid primary key, org_id uuid not null references public.orgs(id));
      create function public.is_org_member(p_org_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
        select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid())
      $$;
      grant usage on schema public,auth to authenticated;
      grant select on public.deals to authenticated;
      grant execute on function auth.uid(),public.is_org_member(uuid) to authenticated;
      insert into public.orgs values ('${orgA}'),('${orgB}');
      insert into public.org_members values ('${orgA}','${user}');
      insert into public.deals values ('${dealB}','${orgB}');
    `);
    const migration = await readFile(path.join(root, "supabase", "migrations", "067_policyfund_document_checklists.sql"), "utf8");
    await db.exec(migration);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);

    await assert.rejects(
      db.query(`insert into public.deal_document_checklists(org_id,deal_id) values ('${orgA}','${dealB}') returning deal_id`),
      /row-level security/i,
    );
    assert.equal((await db.query("select count(*)::int as n from public.deal_document_checklists")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
