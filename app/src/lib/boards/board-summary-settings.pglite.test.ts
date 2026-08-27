import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1);
const denied = id(2);
const org = id(10);
const otherOrg = id(11);
const board = id(20);

const call = (request: string, intent: unknown, targetBoard = board, targetOrg = org) =>
  `select * from public.apply_board_summary_settings('${targetOrg}','${targetBoard}','${request}','${JSON.stringify(intent).replaceAll("'", "''")}'::jsonb)`;

describe("Issue #605 board summary migration", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key,status text not null default 'active');
      create table public.org_members(org_id uuid,user_id uuid,status text,primary key(org_id,user_id));
      create table public.boards(
        id uuid primary key,org_id uuid not null references orgs,name text,description text,icon text,
        is_system boolean not null default false,source text,sort_order int,created_by uuid,
        created_at timestamptz default now(),updated_at timestamptz default now(),detail_layout_jsonb jsonb
      );
      create table public.board_columns(
        id uuid primary key,org_id uuid not null,board_id uuid not null,key text not null,type text not null,
        archived_at timestamptz,summary_hidden boolean default false,unique(org_id,board_id,key)
      );
      create function public.effective_permission(candidate uuid,permission_key text) returns boolean language sql stable as
        $$select auth.uid()='${actor}'::uuid and candidate='${org}'::uuid and permission_key='structure.tab_manage'$$;
      create function public.begin_guarded_migration(
        p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
        p_executor text,p_thread_id text,p_foundation boolean default false
      ) returns void language sql as $$select$$;
      grant update on public.boards to anon,service_role;
      grant update(name,description,icon,source,updated_at,detail_layout_jsonb) on public.boards to authenticated;
      grant select on public.boards to anon,authenticated,service_role;
      insert into users values('${actor}'),('${denied}');
      insert into orgs(id) values('${org}'),('${otherOrg}');
      insert into org_members values('${org}','${actor}','active'),('${org}','${denied}','active'),('${otherOrg}','${actor}','active');
      insert into boards(id,org_id,name) values('${board}','${org}','테스트 보드'),('${id(21)}','${otherOrg}','다른 보드');
      insert into board_columns values
        ('${id(30)}','${org}','${board}','status','status',null,false),
        ('${id(31)}','${org}','${board}','amount','money',null,false),
        ('${id(32)}','${org}','${board}','quantity','number',null,false),
        ('${id(33)}','${org}','${board}','hidden','money',null,true),
        ('${id(34)}','${org}','${board}','archived','number',now(),false);
      select set_config('request.jwt.claim.sub','${actor}',false);
    `);
    const sql = await readFile(resolve(process.cwd(), "../supabase/migrations/138_issue605_board_summary_settings.sql"), "utf8");
    await db.exec(sql);
  });
  afterEach(async () => db.close());

  it("persists ordered config once and replays the exact request without a second write", async () => {
    const request = id(100);
    const intent = { type: "add", metric: { id: "status", kind: "distribution", columnKey: "status" } };
    const first = await db.query<{ config: unknown; replayed: boolean }>(call(request, intent));
    const replay = await db.query<{ config: unknown; replayed: boolean }>(call(request, intent));
    expect(first.rows[0]).toMatchObject({ config: [intent.metric], replayed: false });
    expect(replay.rows[0]).toMatchObject({ config: [intent.metric], replayed: true });
    expect((await db.query<{ n: number }>("select count(*)::int n from board_summary_setting_requests")).rows[0].n).toBe(1);
    expect((await db.query<{ value: unknown }>("select summary_config_jsonb value from boards where id=$1", [board])).rows[0].value).toEqual([intent.metric]);
  });

  it("rejects payload reuse, duplicate/max3, wrong type, hidden and archived targets without mutation", async () => {
    const add = async (n: number, metric: Record<string, unknown>) => db.query(call(id(n), { type: "add", metric }));
    await add(101, { id: "status", kind: "distribution", columnKey: "status" });
    await expect(db.query(call(id(101), { type: "remove", metricId: "status" }))).rejects.toThrow(/replay conflict/);
    await expect(add(102, { id: "copy", kind: "distribution", columnKey: "status" })).rejects.toThrow(/config invalid/);
    await expect(add(103, { id: "wrong", kind: "sum", columnKey: "status" })).rejects.toThrow(/target invalid/);
    await expect(add(104, { id: "hidden", kind: "sum", columnKey: "hidden" })).rejects.toThrow(/target invalid/);
    await expect(add(105, { id: "archived", kind: "sum", columnKey: "archived" })).rejects.toThrow(/target invalid/);
    await add(106, { id: "amount", kind: "sum", columnKey: "amount" });
    await add(107, { id: "quantity", kind: "sum", columnKey: "quantity" });
    await expect(add(108, { id: "fourth", kind: "sum", columnKey: "quantity" })).rejects.toThrow(/max three/);
    expect((await db.query<{ n: number }>("select jsonb_array_length(summary_config_jsonb)::int n from boards where id=$1", [board])).rows[0].n).toBe(3);
  });

  it("moves/removes canonically and denies permission or cross-org tuples", async () => {
    await db.query(call(id(110), { type: "add", metric: { id: "status", kind: "distribution", columnKey: "status" } }));
    await db.query(call(id(111), { type: "add", metric: { id: "amount", kind: "sum", columnKey: "amount" } }));
    const moved = await db.query<{ config: Array<{ id: string }> }>(call(id(112), { type: "move", metricId: "amount", direction: -1 }));
    expect(moved.rows[0].config.map((entry) => entry.id)).toEqual(["amount", "status"]);
    const removed = await db.query<{ config: Array<{ id: string }> }>(call(id(113), { type: "remove", metricId: "status" }));
    expect(removed.rows[0].config.map((entry) => entry.id)).toEqual(["amount"]);
    await db.exec(`select set_config('request.jwt.claim.sub','${denied}',false)`);
    await expect(db.query(call(id(114), { type: "remove", metricId: "amount" }))).rejects.toThrow(/permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`);
    await expect(db.query(call(id(115), { type: "remove", metricId: "amount" }, id(21), otherOrg))).rejects.toThrow(/permission denied/);
  });

  it("cleans hidden, missing and type-drift targets one by one while stale move fails closed", async () => {
    await db.exec(`update public.boards set summary_config_jsonb='[
      {"id":"hidden","kind":"sum","columnKey":"hidden"},
      {"id":"missing","kind":"sum","columnKey":"missing"},
      {"id":"drift","kind":"sum","columnKey":"status"}
    ]'::jsonb where id='${board}'`);
    await expect(db.query(call(id(116), { type: "move", metricId: "hidden", direction: 1 }))).rejects.toThrow(/move target unavailable/);
    const first = await db.query<{ config: Array<{ id: string }> }>(call(id(117), { type: "remove", metricId: "hidden" }));
    expect(first.rows[0].config.map((entry) => entry.id)).toEqual(["missing", "drift"]);
    const second = await db.query<{ config: Array<{ id: string }> }>(call(id(118), { type: "remove", metricId: "missing" }));
    expect(second.rows[0].config.map((entry) => entry.id)).toEqual(["drift"]);
    const third = await db.query<{ config: Array<{ id: string }> }>(call(id(119), { type: "remove", metricId: "drift" }));
    expect(third.rows[0].config).toEqual([]);
  });

  it("rolls back the board update when the receipt cannot commit, then retries cleanly", async () => {
    const request = id(120);
    await db.exec(`create function reject_summary_receipt() returns trigger language plpgsql as $$begin if new.request_id='${request}' then raise exception 'receipt blocked'; end if; return new; end$$;
      create trigger reject_summary_receipt before insert on board_summary_setting_requests for each row execute function reject_summary_receipt();`);
    const intent = { type: "add", metric: { id: "amount", kind: "sum", columnKey: "amount" } };
    await expect(db.query(call(request, intent))).rejects.toThrow(/receipt blocked/);
    expect((await db.query<{ value: unknown }>("select summary_config_jsonb value from boards where id=$1", [board])).rows[0].value).toEqual([]);
    await db.exec("drop trigger reject_summary_receipt on board_summary_setting_requests");
    await expect(db.query(call(request, intent))).resolves.toBeTruthy();
  });

  it("keeps direct writes and ledger reads closed to public API roles with customer DML zero", async () => {
    await db.exec("set role authenticated");
    await expect(db.exec(`update public.boards set name='authenticated ordinary update' where id='${board}'`)).resolves.toBeTruthy();
    await db.exec("reset role; set role service_role");
    await expect(db.exec(`update public.boards set description='service role legacy update' where id='${board}'`)).resolves.toBeTruthy();
    await db.exec("reset role");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await expect(db.exec(`update public.boards set summary_config_jsonb='[]' where id='${board}'`)).rejects.toThrow();
      await expect(db.query("select * from public.board_summary_setting_requests")).rejects.toThrow();
      await db.exec("reset role");
    }
    const sql = await readFile(resolve(process.cwd(), "../supabase/migrations/138_issue605_board_summary_settings.sql"), "utf8");
    expect(sql).not.toMatch(/\b(update|delete)\s+(?:from\s+)?public\.(?:items|item_values|companies|deals|org_members)\b/i);
  });
});
