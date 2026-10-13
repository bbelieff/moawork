import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// QA #884 · migration 175 — 상담 기록 미팅 일시를 읽기 전용 보드 칸에 옮겨 적는 함수와 한 번 맞추기.
const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/175_consultation_meeting_at_mirror.sql"), "utf8");
const id = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const ids = { org: id("1"), owner: id("10"), member: id("11"), other: id("12"), board: id("20"), item: id("30"), othersItem: id("31"), noState: id("32") };

const SCHEMA = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.org_members(org_id uuid, user_id uuid, role text, scope text);
  create function public.is_org_member(p uuid) returns boolean language sql stable as $$ select exists(select 1 from public.org_members where org_id=p and user_id=auth.uid()) $$;
  create function public.org_role(p uuid) returns text language sql stable as $$ select role from public.org_members where org_id=p and user_id=auth.uid() $$;
  create function public.org_scope(p uuid) returns text language sql stable as $$ select scope from public.org_members where org_id=p and user_id=auth.uid() $$;
  create table public.boards(id uuid primary key, org_id uuid, source text);
  create table public.board_columns(id uuid primary key default gen_random_uuid(), board_id uuid, key text, is_readonly boolean default false);
  create table public.items(id uuid primary key, org_id uuid, board_id uuid, assigned_to uuid);
  create table public.item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, unique(item_id, column_key));
  create table public.consultation_states(org_id uuid, item_id uuid, meeting_at timestamptz, primary key(org_id, item_id));
  create function public.begin_guarded_migration(p_logical_key text, p_file_name text, p_file_digest text, p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean) returns void language sql as $$ select $$;
  insert into public.org_members values ('${ids.org}','${ids.owner}','owner','all'),('${ids.org}','${ids.member}','member','assigned'),('${ids.org}','${ids.other}','member','assigned');
  insert into public.boards values ('${ids.board}','${ids.org}','core.default-tab/contact');
  insert into public.board_columns(board_id, key, is_readonly) values ('${ids.board}','meeting_at',true);
  insert into public.items values ('${ids.item}','${ids.org}','${ids.board}','${ids.member}'),('${ids.othersItem}','${ids.org}','${ids.board}','${ids.other}'),('${ids.noState}','${ids.org}','${ids.board}','${ids.member}');
  insert into public.consultation_states values ('${ids.org}','${ids.item}','2026-10-20T05:00:00Z'),('${ids.org}','${ids.othersItem}','2026-10-21T05:00:00Z');
  insert into public.item_values values ('${ids.org}','${ids.item}','meeting_at','"2026-01-01T00:00:00Z"'::jsonb);
`;

let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(SCHEMA); await db.exec(migration); });
afterAll(async () => { await db.close(); });
const as = (uid: string) => db.exec(`select set_config('app.uid','${uid}',false)`);
const cell = async (item: string) => (await db.query<{ v: string | null }>(`select value_jsonb #>> '{}' v from item_values where item_id=$1 and column_key='meeting_at'`, [item])).rows[0]?.v ?? null;

describe("migration 175 — 미팅 일시 거울", () => {
  it("한 번 맞추기: 상담 기록 일시가 있는 리드컨택 행의 보드 칸을 정본 값으로 덮는다", async () => {
    expect(new Date(String(await cell(ids.item))).toISOString()).toBe("2026-10-20T05:00:00.000Z");
    expect(new Date(String(await cell(ids.othersItem))).toISOString()).toBe("2026-10-21T05:00:00.000Z");
  });

  it("행 담당자는 거울을 맞출 수 있고, 상담 기록이 바뀌면 그 값, 지워지면 칸도 지운다", async () => {
    await db.exec(`update consultation_states set meeting_at='2026-11-01T01:30:00Z' where item_id='${ids.item}'`);
    await as(ids.member);
    await db.query(`select mirror_consultation_meeting_at($1,$2)`, [ids.org, ids.item]);
    expect(new Date(String(await cell(ids.item))).toISOString()).toBe("2026-11-01T01:30:00.000Z");
    await db.exec(`update consultation_states set meeting_at=null where item_id='${ids.item}'`);
    await db.query(`select mirror_consultation_meeting_at($1,$2)`, [ids.org, ids.item]);
    expect(await cell(ids.item)).toBeNull();
  });

  it("상담 기록이 없는 행은 아무것도 하지 않는다", async () => {
    await as(ids.member);
    await db.query(`select mirror_consultation_meeting_at($1,$2)`, [ids.org, ids.noState]);
    expect(await cell(ids.noState)).toBeNull();
  });

  it("남의 행(본인 담당 범위)은 막고, 대표는 된다", async () => {
    await as(ids.member);
    await expect(db.query(`select mirror_consultation_meeting_at($1,$2)`, [ids.org, ids.othersItem])).rejects.toThrow(/denied/);
    await as(ids.owner);
    await db.query(`select mirror_consultation_meeting_at($1,$2)`, [ids.org, ids.othersItem]);
  });

  it("익명은 부를 수 없다", async () => {
    const r = await db.query<{ anon: boolean }>(`select has_function_privilege('anon','public.mirror_consultation_meeting_at(uuid,uuid)','execute') anon`);
    expect(r.rows[0].anon).toBe(false);
  });
});
