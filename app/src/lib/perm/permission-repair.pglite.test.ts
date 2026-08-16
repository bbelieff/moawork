import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/076_permission_read_foundation_repair.sql"), "utf8");
const opened: PGlite[] = [];

async function database() {
  const db = new PGlite(); opened.push(db);
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.test_user', true),'')::uuid
    $$;
    create type public.member_role as enum ('owner','admin','member');
    create type public.member_scope as enum ('all','assigned');
    create table public.users(id uuid primary key);
    create table public.orgs(id uuid primary key, status text not null);
    create table public.org_members(org_id uuid, user_id uuid, role public.member_role, scope public.member_scope, status text, primary key(org_id,user_id));
    create table public.member_scoped_permission_bindings(org_id uuid, subject_user_id uuid, scope_key text, decision text, primary key(org_id,subject_user_id,scope_key));
    create table public.items(id uuid primary key, org_id uuid, assigned_to uuid);
  `);
  await db.exec(migration);
  return db;
}

afterEach(async () => { await Promise.all(opened.splice(0).map((db) => db.close())); });

describe("076 permission repair execution", () => {
  it("preserves assigned scope and denies cross-org and inactive membership", async () => {
    const db = await database();
    const owner = "00000000-0000-4000-8000-000000000001";
    const member = "00000000-0000-4000-8000-000000000002";
    const other = "00000000-0000-4000-8000-000000000003";
    const org = "10000000-0000-4000-8000-000000000001";
    const otherOrg = "10000000-0000-4000-8000-000000000002";
    await db.exec(`insert into users values ('${owner}'),('${member}'),('${other}'); insert into orgs values ('${org}','active'),('${otherOrg}','active'); insert into org_members values ('${org}','${owner}','owner','all','active'),('${org}','${member}','member','assigned','active'),('${otherOrg}','${other}','owner','all','active'); insert into items values ('20000000-0000-4000-8000-000000000001','${org}','${member}'),('20000000-0000-4000-8000-000000000002','${org}','${owner}');`);
    await db.query(`select set_config('app.test_user','${member}',false)`);
    const visible = await db.query<{ result: { itemIds: string[]; hiddenCount: number } }>(`select read_permission_scoped_work_items('${org}',null) result`);
    expect(visible.rows[0].result.itemIds).toEqual(["20000000-0000-4000-8000-000000000001"]);
    expect(visible.rows[0].result.hiddenCount).toBe(1);
    await expect(db.query(`select read_permission_scoped_work_items('${otherOrg}',null)`)).rejects.toThrow();
    await db.exec(`update org_members set status='suspended' where org_id='${org}' and user_id='${member}'`);
    await expect(db.query(`select read_permission_scoped_work_items('${org}',null)`)).rejects.toThrow();
  });
});
