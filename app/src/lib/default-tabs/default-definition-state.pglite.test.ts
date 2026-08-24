import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/126_issue534_default_definition_state_unique.sql"), "utf8")
  .replace(/^-- moa-migration-guard:[^\n]*\n\s*select public\.begin_guarded_migration\([\s\S]*?\);\s*/u, "");
const opened: PGlite[] = [];
afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("issue #534 board-scoped definition revision metadata", () => {
  it("survives actor changes, serializes one row, denies cross-org/anon, and changes no business rows", async () => {
    const db = new PGlite(); opened.push(db);
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create function public.effective_permission(p_org_id uuid,p_permission text) returns boolean language sql stable as
        $$select p_permission='structure.section_manage' and p_org_id::text=current_setting('app.org',true) and current_setting('app.manager',true)='true'$$;
      create table boards(id uuid primary key,org_id uuid not null);
      create table board_views(id uuid primary key default '99999999-9999-4999-8999-999999999999',org_id uuid not null,board_id uuid not null,user_id uuid,name text not null,kind text not null default 'table',filters_jsonb jsonb not null default '{}',sort_jsonb jsonb not null default '[]',visible_columns_jsonb jsonb not null default '[]',shared boolean not null default false);
      create table items(id uuid primary key,org_id uuid not null,title text);
      create table item_values(item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      create role authenticated; create role anon; create role service_role;
      ${migration}
    `);
    const orgA="11111111-1111-4111-8111-111111111111", orgB="22222222-2222-4222-8222-222222222222";
    const boardA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", boardB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query("insert into boards values($1,$2),($3,$4)",[boardA,orgA,boardB,orgB]);
    await db.query("insert into items values('55555555-5555-4555-8555-555555555555',$1,'customer keep')",[orgA]);
    const before=(await db.query("select * from items")).rows;
    await db.exec(`set role authenticated; select set_config('app.org','${orgA}',false); select set_config('app.manager','true',false); select set_config('app.uid','33333333-3333-4333-8333-333333333333',false);`);
    await db.query("select write_default_board_definition_state($1,$2,$3::jsonb)",[orgA,boardA,JSON.stringify({revision:1})]);
    await db.exec("select set_config('app.uid','44444444-4444-4444-8444-444444444444',false)");
    expect((await db.query<{state:{revision:number}}>("select read_default_board_definition_state($1,$2) state",[orgA,boardA])).rows[0].state.revision).toBe(1);
    await db.query("select write_default_board_definition_state($1,$2,$3::jsonb)",[orgA,boardA,JSON.stringify({revision:2})]);
    await db.exec("reset role");
    expect((await db.query<{n:number}>("select count(*)::int n from board_views where board_id=$1",[boardA])).rows[0].n).toBe(1);
    await db.exec("set role authenticated");
    await expect(db.query("select read_default_board_definition_state($1,$2)",[orgB,boardB])).rejects.toThrow(/permission_denied/u);
    await db.exec("reset role; set role anon");
    await expect(db.query("select read_default_board_definition_state($1,$2)",[orgA,boardA])).rejects.toThrow(/permission denied/u);
    await db.exec("reset role");
    expect((await db.query("select * from items")).rows).toEqual(before);
  });
});
