import { PGlite } from "@electric-sql/pglite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/112_bbe195_persistent_group_column_layout.sql"),
  "utf8",
);

const ids = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  userA: "00000000-0000-4000-8000-000000000010",
  boardA: "00000000-0000-4000-8000-000000000020",
  boardB: "00000000-0000-4000-8000-000000000021",
  groupA: "00000000-0000-4000-8000-000000000030",
};

const schema = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.boards(id uuid primary key,org_id uuid not null);
  create table public.board_groups(id uuid primary key,org_id uuid not null,board_id uuid not null);
  create table public.board_columns(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null,key text not null);
  create table public.board_views(
    id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null,
    user_id uuid references public.users(id) on delete cascade,name text not null,kind text not null default 'table',filters_jsonb jsonb not null default '{}',
    sort_jsonb jsonb not null default '[]',visible_columns_jsonb jsonb not null default '[]',shared boolean not null default false
  );
  create table public.allowed_layout_writers(org_id uuid,user_id uuid,primary key(org_id,user_id));
  create function public.effective_permission(p_org_id uuid,p_scope_key text) returns boolean language sql stable
    as $$select p_scope_key='structure.column_manage' and exists(select 1 from public.allowed_layout_writers where org_id=p_org_id and user_id=auth.uid())$$;
  create function public.begin_guarded_migration(
    p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
    p_executor text,p_thread_id text,p_foundation boolean
  ) returns void language sql as $$select$$;
  alter table public.board_views enable row level security;
  grant select,insert,update,delete on public.board_views to authenticated;
  create policy board_views_visible on public.board_views for select to authenticated
    using (shared or user_id=auth.uid() or user_id is null);
  create policy board_views_insert_own on public.board_views for insert to authenticated
    with check (user_id=auth.uid());
  create policy board_views_update_own on public.board_views for update to authenticated
    using (user_id=auth.uid()) with check (user_id=auth.uid());
  create policy board_views_delete_own on public.board_views for delete to authenticated
    using (user_id=auth.uid());
`;

async function boot(dataDir = "memory://") {
  const db = new PGlite(dataDir);
  await db.exec(schema);
  await db.exec(migration);
  await db.exec(`
    insert into orgs values('${ids.orgA}'),('${ids.orgB}');
    insert into users values('${ids.userA}');
    insert into boards values('${ids.boardA}','${ids.orgA}'),('${ids.boardB}','${ids.orgB}');
    insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}');
    insert into board_columns(org_id,board_id,key) values
      ('${ids.orgA}','${ids.boardA}','status'),('${ids.orgA}','${ids.boardA}','owner'),
      ('${ids.orgB}','${ids.boardB}','secret');
    insert into allowed_layout_writers values('${ids.orgA}','${ids.userA}');
    select set_config('app.uid','${ids.userA}',false);
    set role authenticated;
  `);
  return db;
}

let active: PGlite | null = null;
const tempDirs: string[] = [];
afterEach(async () => {
  await active?.close(); active = null;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("BBE-195 persistent group column layout", () => {
  it("DB 정본은 앱 메모리를 잃은 뒤에도 변경됨/기본복구 판정을 유지한다", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "bbe195-restart-"));
    tempDirs.push(tempRoot);
    const dataDir = join(tempRoot, "database");
    active = await boot(dataDir);
    await active.exec(`select public.set_board_group_column_order('${ids.boardA}','${ids.groupA}',array['owner','status']);`);
    await active.exec("reset role");
    await active.close(); active = null;

    active = new PGlite(dataDir);
    await active.waitReady;
    await active.exec(`select set_config('app.uid','${ids.userA}',false); set role authenticated;`);
    const restarted = await active.query<{ layout: unknown }>(`
      select visible_columns_jsonb as layout from board_views
       where org_id='${ids.orgA}' and board_id='${ids.boardA}'
    `);
    expect(restarted.rows).toEqual([{ layout: [{ [ids.groupA]: ["owner", "status"] }] }]);

    await active.exec("reset role; delete from users where id='" + ids.userA + "'; set role authenticated;");
    const afterActorDeletion = await active.query<{ count: number }>("select count(*)::int as count from board_views");
    expect(afterActorDeletion.rows[0]?.count).toBe(1);

    await active.exec(`select public.set_board_group_column_order('${ids.boardA}','${ids.groupA}',array[]::text[]);`);
    const reset = await active.query<{ count: number }>("select count(*)::int as count from board_views");
    expect(reset.rows[0]?.count).toBe(0);
  });

  it("재시도는 한 행만 유지하고 다른 조직·알 수 없는 컬럼 쓰기를 거부한다", async () => {
    active = await boot();
    await Promise.all([
      active.exec(`select public.set_board_group_column_order('${ids.boardA}','${ids.groupA}',array['status']);`),
      active.exec(`select public.set_board_group_column_order('${ids.boardA}','__ungrouped__',array['owner']);`),
    ]);
    await active.exec(`select public.set_board_group_column_order('${ids.boardA}','${ids.groupA}',array['status']);`);
    const rows = await active.query<{ count: number }>("select count(*)::int as count from board_views");
    expect(rows.rows[0]?.count).toBe(1);
    const concurrent = await active.query<{ layout: unknown }>("select visible_columns_jsonb as layout from board_views");
    expect(concurrent.rows).toEqual([{ layout: [{ [ids.groupA]: ["status"], __ungrouped__: ["owner"] }] }]);

    await expect(active.exec(`select public.set_board_group_column_order('${ids.boardB}','__ungrouped__',array['secret']);`))
      .rejects.toThrow(/board not found/u);
    await expect(active.exec(`select public.set_board_group_column_order('${ids.boardA}','${ids.groupA}',array['secret']);`))
      .rejects.toThrow(/unknown or duplicate/u);
    const unchanged = await active.query<{ value: string }>(`
      select visible_columns_jsonb #>> array['0','${ids.groupA}','0'] as value from board_views
    `);
    expect(unchanged.rows[0]?.value).toBe("status");

    await expect(active.exec(`
      insert into board_views(org_id,board_id,user_id,name,shared)
      values('${ids.orgA}','${ids.boardA}','${ids.userA}','__moawork_group_column_layout_v1__',true)
    `)).rejects.toThrow(/row-level security/u);
    await active.exec("update board_views set visible_columns_jsonb='[]' where name='__moawork_group_column_layout_v1__'; delete from board_views where name='__moawork_group_column_layout_v1__';");
    const directDmlBlocked = await active.query<{ count: number }>("select count(*)::int as count from board_views where visible_columns_jsonb <> '[]'::jsonb");
    expect(directDmlBlocked.rows[0]?.count).toBe(1);

    const rpcOnly = await active.query<{ count: number }>(`
      select count(*)::int as count from pg_policies
       where schemaname='public' and tablename='board_views'
         and policyname like 'board_views_group_layout_%_rpc_only'
         and permissive='RESTRICTIVE'
    `);
    expect(rpcOnly.rows[0]?.count).toBe(3);
    expect(migration).toContain("perform pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':' || p_board_id::text, 195))");
  });
});
