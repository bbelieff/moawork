import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../../supabase/migrations/082_notification_foundation.sql", import.meta.url),
  "utf8",
);
const id = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("BBE-167 hosted notification foundation", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  async function setup(): Promise<PGlite> {
    const db = new PGlite();
    opened.push(db);
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key, status text not null);
      create table public.org_members(
        org_id uuid not null,
        user_id uuid not null,
        role text not null,
        scope text not null,
        status text not null,
        primary key(org_id, user_id)
      );
      create table public.boards(id uuid primary key, org_id uuid not null);
      create table public.items(
        id uuid primary key,
        org_id uuid not null,
        board_id uuid not null,
        assigned_to uuid
      );
      create table public.workspace_entry_requests(
        id uuid primary key,
        kind text not null,
        status text not null,
        target_org_id uuid,
        requester_user_id uuid
      );
      create function public.effective_permission(p_org_id uuid, p_permission text)
      returns boolean language sql stable as $$
        select p_permission = 'work.item_upsert' and exists(
          select 1 from public.org_members
          where org_id = p_org_id and user_id = auth.uid() and status = 'active'
        )
      $$;
      grant usage on schema public to authenticated;
      grant select on public.org_members, public.orgs to authenticated;

      insert into public.users values
        ('${id(10)}'), ('${id(11)}'), ('${id(12)}'), ('${id(13)}');
      insert into public.orgs values ('${id(1)}','active'), ('${id(2)}','active');
      insert into public.org_members values
        ('${id(1)}','${id(10)}','member','all','active'),
        ('${id(1)}','${id(11)}','owner','all','active'),
        ('${id(2)}','${id(12)}','owner','all','active'),
        ('${id(2)}','${id(13)}','member','all','active');
      insert into public.boards values ('${id(20)}','${id(1)}'), ('${id(21)}','${id(2)}');
      insert into public.items values
        ('${id(30)}','${id(1)}','${id(20)}','${id(10)}'),
        ('${id(31)}','${id(2)}','${id(21)}','${id(13)}');
      select set_config('app.uid','${id(10)}',false);
    `);
    await db.exec(migration);
    return db;
  }

  it("emits one owner notification for a member move, fences replay, and isolates organizations", async () => {
    const db = await setup();
    const first = await db.query<{ result: number }>(`
      select public.notify_board_item_moved(
        '${id(1)}','${id(20)}','${id(30)}','${id(40)}'
      ) result
    `);
    const replay = await db.query<{ result: number }>(`
      select public.notify_board_item_moved(
        '${id(1)}','${id(20)}','${id(30)}','${id(40)}'
      ) result
    `);
    expect(first.rows[0].result).toBe(1);
    expect(replay.rows[0].result).toBe(0);

    const rows = await db.query<{
      count: number; user_id: string; actor_id: string; title: string; target_id: string;
    }>(`
      select count(*)::int count, min(user_id::text) user_id,
             min(actor_id::text) actor_id, min(title) title, min(target_id::text) target_id
      from public.notifications
    `);
    expect(rows.rows[0]).toMatchObject({
      count: 1,
      user_id: id(11),
      actor_id: id(10),
      title: "업무 위치가 변경되었습니다",
      target_id: id(30),
    });

    await expect(db.query(`
      select public.notify_board_item_moved(
        '${id(2)}','${id(21)}','${id(31)}','${id(41)}'
      )
    `)).rejects.toThrow(/membership|required|unavailable/u);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications",
    )).rows[0].count).toBe(1);
  });

  it("limits recipient access, supports read/resolve, and preserves the receipt after target deletion", async () => {
    const db = await setup();
    await db.query(`select public.notify_board_item_moved('${id(1)}','${id(20)}','${id(30)}','${id(42)}')`);

    await db.exec(`select set_config('app.uid','${id(11)}',false); set role authenticated`);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications",
    )).rows[0].count).toBe(1);
    await db.exec("update public.notifications set read_at=now(), resolved_at=now()");
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications where read_at is not null and resolved_at is not null",
    )).rows[0].count).toBe(1);
    await db.exec(`
      insert into public.notification_surface_seen(org_id,user_id,surface_key)
      values('${id(1)}','${id(11)}','bell')
      on conflict(org_id,user_id,surface_key) do update set seen_at=excluded.seen_at
    `);
    await db.exec("reset role; delete from public.items where id='" + id(30) + "'");
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications",
    )).rows[0].count).toBe(1);

    await db.exec(`select set_config('app.uid','${id(12)}',false); set role authenticated`);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications",
    )).rows[0].count).toBe(0);
    await db.exec("reset role");
  });

  it("restores join-request producer/resolver and keeps caller grants least-privileged", async () => {
    const db = await setup();
    await db.exec(`
      insert into public.workspace_entry_requests
        (id,kind,status,target_org_id,requester_user_id)
      values ('${id(50)}','join','pending','${id(1)}','${id(10)}');
      update public.workspace_entry_requests set status='approved' where id='${id(50)}';
    `);
    const request = await db.query<{ count: number; resolved: number }>(`
      select count(*)::int count,
             count(*) filter(where resolved_at is not null)::int resolved
      from public.notifications where type='join_request'
    `);
    expect(request.rows[0]).toEqual({ count: 1, resolved: 1 });

    const acl = await db.query<{
      public_exec: boolean; anon_exec: boolean; auth_exec: boolean; service_exec: boolean;
      auth_insert: boolean; auth_select: boolean; auth_delete: boolean;
      auth_read_update: boolean; auth_title_update: boolean;
    }>(`select
      has_function_privilege('public','public.notify_board_item_moved(uuid,uuid,uuid,uuid)','execute') public_exec,
      has_function_privilege('anon','public.notify_board_item_moved(uuid,uuid,uuid,uuid)','execute') anon_exec,
      has_function_privilege('authenticated','public.notify_board_item_moved(uuid,uuid,uuid,uuid)','execute') auth_exec,
      has_function_privilege('service_role','public.notify_board_item_moved(uuid,uuid,uuid,uuid)','execute') service_exec,
      has_table_privilege('authenticated','public.notifications','insert') auth_insert,
      has_table_privilege('authenticated','public.notifications','select') auth_select,
      has_table_privilege('authenticated','public.notifications','delete') auth_delete,
      has_column_privilege('authenticated','public.notifications','read_at','update') auth_read_update,
      has_column_privilege('authenticated','public.notifications','title','update') auth_title_update
    `);
    expect(acl.rows[0]).toEqual({
      public_exec: false,
      anon_exec: false,
      auth_exec: true,
      service_exec: false,
      auth_insert: false,
      auth_select: true,
      auth_delete: false,
      auth_read_update: true,
      auth_title_update: false,
    });

    await db.exec(migration);
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.notifications where type='join_request'",
    )).rows[0].count).toBe(1);
  });
});
