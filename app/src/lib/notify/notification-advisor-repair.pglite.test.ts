import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const foundation = readFileSync(
  new URL("../../../../supabase/migrations/082_notification_foundation.sql", import.meta.url),
  "utf8",
);
const repair = readFileSync(
  new URL("../../../../supabase/migrations/083_notification_advisor_repair.sql", import.meta.url),
  "utf8",
);
const id = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("BBE-167 notification advisor repair", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  it("keeps recipient RLS and ACL intact while adding both covering indexes", async () => {
    const db = new PGlite();
    opened.push(db);
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key,status text not null);
      create table public.org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table public.boards(id uuid primary key,org_id uuid);
      create table public.items(id uuid primary key,org_id uuid,board_id uuid,assigned_to uuid);
      create table public.workspace_entry_requests(id uuid primary key,kind text,status text,target_org_id uuid,requester_user_id uuid);
      create function public.effective_permission(uuid,text) returns boolean language sql stable as $$select true$$;
      grant usage on schema public to authenticated;
      grant select on public.org_members,public.orgs to authenticated;
      insert into public.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
      insert into public.orgs values('${id(10)}','active'),('${id(11)}','active');
      insert into public.org_members values
        ('${id(10)}','${id(1)}','owner','all','active'),
        ('${id(10)}','${id(2)}','member','all','active'),
        ('${id(11)}','${id(3)}','owner','all','active');
    `);
    await db.exec(foundation);
    await db.exec(repair);
    await db.exec(repair);

    const indexes = await db.query<{ indexname: string }>(`
      select indexname from pg_indexes
      where schemaname='public'
        and indexname in ('notification_surface_seen_user_org_idx','notifications_actor_idx')
      order by indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "notification_surface_seen_user_org_idx",
      "notifications_actor_idx",
    ]);

    const policies = await db.query<{ qual: string; with_check: string | null }>(`
      select qual, with_check from pg_policies
      where schemaname='public'
        and tablename in ('notifications','notification_surface_seen')
    `);
    expect(policies.rows).toHaveLength(3);
    for (const policy of policies.rows) {
      expect(`${policy.qual} ${policy.with_check ?? ""}`).toMatch(/select auth\.uid\(\)/iu);
    }

    const acl = await db.query<{
      auth_select: boolean; auth_insert: boolean; auth_delete: boolean;
      auth_read_update: boolean; auth_title_update: boolean;
    }>(`select
      has_table_privilege('authenticated','public.notifications','select') auth_select,
      has_table_privilege('authenticated','public.notifications','insert') auth_insert,
      has_table_privilege('authenticated','public.notifications','delete') auth_delete,
      has_column_privilege('authenticated','public.notifications','read_at','update') auth_read_update,
      has_column_privilege('authenticated','public.notifications','title','update') auth_title_update
    `);
    expect(acl.rows[0]).toEqual({
      auth_select: true,
      auth_insert: false,
      auth_delete: false,
      auth_read_update: true,
      auth_title_update: false,
    });

    await db.exec(`
      insert into public.notifications(org_id,user_id,type,title)
      values('${id(10)}','${id(1)}','test','one'),('${id(11)}','${id(3)}','test','other');
      select set_config('app.uid','${id(1)}',false);
      set role authenticated;
    `);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications",
    )).rows[0].count).toBe(1);
    await db.exec("update public.notifications set read_at=now()");
    await db.exec("reset role");
    expect((await db.query<{ count: number }>(
      `select count(*)::int count from public.notifications where user_id='${id(1)}' and read_at is not null`,
    )).rows[0].count).toBe(1);
  });
});
