import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const opened: PGlite[] = [];
afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

async function setup() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''app.user_id'',true),'''')::uuid';
    create role anon; create role authenticated; create role service_role;
    create table public.orgs(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,role text,status text);
    create table public.workspace_entry_requests(target_org_id uuid,requester_user_id uuid,kind text,status text);
  `);
  const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/080_workspace_bootstrap_lease.sql"), "utf8");
  await db.exec(sql);
  return db;
}

describe("workspace bootstrap lease migration", () => {
  it("serializes holders, recovers expiry, and denies non-owner/cross-org actors", async () => {
    const db = await setup();
    const orgA = "00000000-0000-0000-0000-000000000001";
    const orgB = "00000000-0000-0000-0000-000000000002";
    const owner = "00000000-0000-0000-0000-000000000011";
    const member = "00000000-0000-0000-0000-000000000012";
    const h1 = "00000000-0000-0000-0000-000000000021";
    const h2 = "00000000-0000-0000-0000-000000000022";
    await db.query("insert into orgs values($1),($2)", [orgA, orgB]);
    await db.query("insert into org_members values($1,$2,'owner','active'),($1,$3,'member','active')", [orgA, owner, member]);
    await db.query("insert into workspace_entry_requests values($1,$2,'create','approved')", [orgA, owner]);
    await db.query("select set_config('app.user_id',$1,false)", [owner]);

    expect((await db.query<{ok:boolean}>("select acquire_workspace_bootstrap_lease($1,$2) ok", [orgA,h1])).rows[0].ok).toBe(true);
    expect((await db.query<{ok:boolean}>("select acquire_workspace_bootstrap_lease($1,$2) ok", [orgA,h2])).rows[0].ok).toBe(false);
    expect((await db.query<{ok:boolean}>("select renew_workspace_bootstrap_lease($1,$2) ok", [orgA,h1])).rows[0].ok).toBe(true);
    expect((await db.query<{ok:boolean}>("select release_workspace_bootstrap_lease($1,$2) ok", [orgA,h2])).rows[0].ok).toBe(false);
    await db.query("update workspace_bootstrap_leases set expires_at=clock_timestamp()-interval '1 second' where org_id=$1", [orgA]);
    expect((await db.query<{ok:boolean}>("select acquire_workspace_bootstrap_lease($1,$2) ok", [orgA,h2])).rows[0].ok).toBe(true);
    expect((await db.query<{ok:boolean}>("select renew_workspace_bootstrap_lease($1,$2) ok", [orgA,h1])).rows[0].ok).toBe(false);
    expect((await db.query<{ok:boolean}>("select renew_workspace_bootstrap_lease($1,$2) ok", [orgA,h2])).rows[0].ok).toBe(true);
    expect((await db.query<{n:number}>("select count(*)::int n from workspace_bootstrap_leases where org_id=$1",[orgA])).rows[0].n).toBe(1);

    await db.query("select set_config('app.user_id',$1,false)", [member]);
    await expect(db.query("select acquire_workspace_bootstrap_lease($1,$2)",[orgA,h1])).rejects.toThrow();
    await db.query("select set_config('app.user_id',$1,false)", [owner]);
    await expect(db.query("select acquire_workspace_bootstrap_lease($1,$2)",[orgB,h1])).rejects.toThrow();
  });

  it("grants only authenticated callers and keeps direct table access closed", async () => {
    const db = await setup();
    const privileges = await db.query<{role_name:string;exec_ok:boolean;table_ok:boolean}>(`
      select role_name,
        has_function_privilege(role_name,'public.acquire_workspace_bootstrap_lease(uuid,uuid)','execute') exec_ok,
        has_table_privilege(role_name,'public.workspace_bootstrap_leases','select') table_ok
      from (values ('anon'),('authenticated'),('service_role')) r(role_name)
      order by role_name
    `);
    expect(privileges.rows).toEqual([
      { role_name: "anon", exec_ok: false, table_ok: false },
      { role_name: "authenticated", exec_ok: true, table_ok: false },
      { role_name: "service_role", exec_ok: false, table_ok: false },
    ]);
    const publicGrant = await db.query<{open:boolean}>(`
      select coalesce(p.proacl::text ~ '(^|[,{])=X',false) open
      from pg_proc p where p.oid='public.acquire_workspace_bootstrap_lease(uuid,uuid)'::regprocedure
    `);
    expect(publicGrant.rows[0].open).toBe(false);
  });
});
