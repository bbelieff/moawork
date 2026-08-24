import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(process.cwd(), "../supabase/migrations/125_issue530_board_group_order.sql");
const opened: PGlite[] = [];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())), 15_000);

describe("Issue #530 group order migration", () => {
  it("repairs only duplicate order and enforces exact org+board group sets", async () => {
    const db = new PGlite(); opened.push(db);
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as 'select ''${id(90)}''::uuid';
      create function public.effective_permission(uuid,text) returns boolean language sql stable as 'select true';
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as 'select';
      create table public.boards(id uuid primary key,org_id uuid not null,source text,is_system boolean not null default false);
      create table public.board_groups(id uuid primary key,org_id uuid not null,board_id uuid not null,name text not null,color text,sort_order integer not null,detail_layout_jsonb jsonb);
      insert into boards values
        ('${id(1)}','${id(10)}','core.default-tab/new-lead',false),
        ('${id(2)}','${id(10)}','core.default-tab/notice',false);
      insert into board_groups(id,org_id,board_id,name,sort_order) values
        ('${id(11)}','${id(10)}','${id(1)}','🔇 1차 부재',0),
        ('${id(12)}','${id(10)}','${id(1)}','💡 신규고객',0),
        ('${id(13)}','${id(10)}','${id(1)}','🔍 2차 상담고객',0),
        ('${id(21)}','${id(10)}','${id(2)}','공지 완료',9),
        ('${id(22)}','${id(10)}','${id(2)}','지원사업',4);
    `);
    await db.exec(await readFile(migrationPath, "utf8"));
    const repaired = await db.query<{ name: string }>(`select name from board_groups where board_id='${id(1)}' order by sort_order`);
    expect(repaired.rows.map((row) => row.name)).toEqual(["💡 신규고객", "🔍 2차 상담고객", "🔇 1차 부재"]);
    const preserved = await db.query<{ name: string; sort_order: number }>(`select name,sort_order from board_groups where board_id='${id(2)}' order by sort_order`);
    expect(preserved.rows).toEqual([{ name: "지원사업", sort_order: 4 }, { name: "공지 완료", sort_order: 9 }]);
    await db.query(`select * from public.reorder_board_groups('${id(10)}','${id(1)}',array['${id(11)}','${id(12)}','${id(13)}']::uuid[])`);
    await expect(db.query(`select * from public.reorder_board_groups('${id(10)}','${id(1)}',array['${id(11)}','${id(22)}','${id(13)}']::uuid[])`)).rejects.toThrow(/group_set_mismatch/u);
    await db.exec("create or replace function public.effective_permission(uuid,text) returns boolean language sql stable as 'select false'");
    await expect(db.query(`select * from public.reorder_board_groups('${id(10)}','${id(1)}',array['${id(11)}','${id(12)}','${id(13)}']::uuid[])`)).rejects.toThrow(/permission_denied/u);
  }, 15_000);
});
