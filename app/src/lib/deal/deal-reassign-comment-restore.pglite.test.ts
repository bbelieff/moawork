import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 시험 대상. 작업 폴더(app/)에서 supabase 쪽 마이그레이션을 읽는다.
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/171_restore_deal_reassign_and_comment_edit.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  org: id("a1"), owner: id("1a"), assignedOnly: id("2a"), teammate: id("3a"), left: id("4a"),
  boardDeal: id("d1"), plainDeal: id("d2"), item: id("e1"), board: id("f1"),
};

// 171 이 참조하는 것만 최소로 둔다. 담당 계보 함수(134)는 받은 인자를 적고 deals·items 를 바꾸는 대역으로 둔다.
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.users(id uuid primary key, name text);
  create table public.org_members(
    org_id uuid not null, user_id uuid not null, role text not null default 'member',
    scope text not null default 'assigned', status text not null default 'active', primary key(org_id, user_id)
  );
  create table public.deals(
    id uuid primary key, org_id uuid not null, assigned_to uuid,
    custom jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
  );
  create table public.items(
    id uuid primary key, org_id uuid not null, board_id uuid not null, deal_id uuid,
    assigned_to uuid, deleted_at timestamptz
  );
  create table public.assignment_lineage_state(org_id uuid not null, deal_id uuid primary key, version bigint not null);
  create table public.activities(
    id uuid primary key default gen_random_uuid(), org_id uuid not null, deal_id uuid,
    type text not null, content text, actor uuid
  );
  create table public.lineage_calls(args jsonb);
  create function public.reassign_deal_with_lineage(
    p_org_id uuid, p_board_id uuid, p_deal_id uuid, p_item_id uuid,
    p_assigned_to uuid, p_expected_assigned_to uuid, p_expected_version bigint, p_request_id uuid
  ) returns jsonb language plpgsql as $$
  begin
    insert into public.lineage_calls values (jsonb_build_object(
      'board', p_board_id, 'item', p_item_id, 'to', p_assigned_to,
      'expectedTo', p_expected_assigned_to, 'version', p_expected_version, 'hasRequest', p_request_id is not null));
    update public.deals set assigned_to = p_assigned_to where id = p_deal_id;
    update public.items set assigned_to = p_assigned_to where id = p_item_id;
    return '{}'::jsonb;
  end $$;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;
`;

let db: PGliteInterface;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`
    delete from public.lineage_calls; delete from public.activities; delete from public.assignment_lineage_state;
    delete from public.items; delete from public.deals; delete from public.org_members; delete from public.users;
    insert into public.users(id, name) values
      ('${ids.owner}','대표'), ('${ids.assignedOnly}','담당직원'), ('${ids.teammate}','동료'), ('${ids.left}','퇴사자');
    insert into public.org_members(org_id, user_id, role, scope, status) values
      ('${ids.org}','${ids.owner}','owner','all','active'),
      ('${ids.org}','${ids.assignedOnly}','member','assigned','active'),
      ('${ids.org}','${ids.teammate}','member','assigned','active'),
      ('${ids.org}','${ids.left}','member','assigned','inactive');
    insert into public.deals(id, org_id, assigned_to, custom) values
      ('${ids.boardDeal}','${ids.org}','${ids.assignedOnly}', '{}'),
      ('${ids.plainDeal}','${ids.org}', null,
        '{"comments":[{"id":"c1","body":"처음","author_id":"${ids.owner}","version":1,"created_at":"2026-10-01T00:00:00.000Z"}]}');
    insert into public.items(id, org_id, board_id, deal_id, assigned_to) values
      ('${ids.item}','${ids.org}','${ids.board}','${ids.boardDeal}','${ids.assignedOnly}');
    insert into public.assignment_lineage_state(org_id, deal_id, version) values ('${ids.org}','${ids.boardDeal}', 3);
  `);
});

async function as(userId: string | null) {
  await db.exec(`select set_config('app.uid', '${userId ?? ""}', false)`);
}

async function reassign(dealId: string, to: string | null) {
  const { rows } = await db.query<{ assigned_to: string | null }>(
    `select (public.reassign_deal_with_activity($1, $2, $3)).assigned_to as assigned_to`,
    [ids.org, dealId, to],
  );
  return rows[0]?.assigned_to;
}

describe("171 reassign_deal_with_activity — 업무 상세 담당자 바꾸기 복원", () => {
  it("보드 행이 있는 업무는 담당 계보 경로로 바꿔 보드 행 담당도 같이 바뀐다", async () => {
    await as(ids.owner);
    expect(await reassign(ids.boardDeal, ids.teammate)).toBe(ids.teammate);
    const calls = await db.query<{ args: Record<string, unknown> }>("select args from public.lineage_calls");
    expect(calls.rows.map((r) => r.args)).toEqual([{
      board: ids.board, item: ids.item, to: ids.teammate, expectedTo: ids.assignedOnly, version: 3, hasRequest: true,
    }]);
    const item = await db.query<{ assigned_to: string }>(`select assigned_to from public.items where id = '${ids.item}'`);
    expect(item.rows[0].assigned_to).toBe(ids.teammate);
    const log = await db.query<{ content: string }>("select content from public.activities");
    expect(log.rows.map((r) => r.content)).toEqual(["담당자: 담당직원 → 동료"]);
  });

  it("보드 행이 없는 업무는 업무만 바꾸고 활동을 남긴다", async () => {
    await as(ids.owner);
    expect(await reassign(ids.plainDeal, ids.teammate)).toBe(ids.teammate);
    expect((await db.query("select 1 from public.lineage_calls")).rows).toHaveLength(0);
    const log = await db.query<{ content: string }>("select content from public.activities");
    expect(log.rows.map((r) => r.content)).toEqual(["담당자: 미배정 → 동료"]);
  });

  it("같은 사람으로 바꾸면 아무것도 바꾸거나 남기지 않는다", async () => {
    await as(ids.owner);
    expect(await reassign(ids.boardDeal, ids.assignedOnly)).toBe(ids.assignedOnly);
    expect((await db.query("select 1 from public.lineage_calls")).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.activities")).rows).toHaveLength(0);
  });

  it("본인 담당 범위 직원은 바꿀 수 없고, 비활성 회원에게는 넘길 수 없다", async () => {
    await as(ids.assignedOnly);
    await expect(reassign(ids.boardDeal, ids.teammate)).rejects.toThrow(/not allowed/);
    await as(ids.owner);
    await expect(reassign(ids.boardDeal, ids.left)).rejects.toThrow(/not an active member/);
    const deal = await db.query<{ assigned_to: string }>(`select assigned_to from public.deals where id = '${ids.boardDeal}'`);
    expect(deal.rows[0].assigned_to).toBe(ids.assignedOnly);
  });
});

describe("171 edit_deal_comment_atomic — 댓글 고치기 복원", () => {
  async function edit(version: number, body = "고친 글") {
    const { rows } = await db.query<{ ok: boolean }>(
      `select public.edit_deal_comment_atomic($1, $2, 'c1', $3, $4) as ok`,
      [ids.org, ids.plainDeal, body, version],
    );
    return rows[0].ok;
  }

  it("작성자가 맞는 버전으로 고치면 본문·버전·이력이 바뀐다", async () => {
    await as(ids.owner);
    expect(await edit(1)).toBe(true);
    const { rows } = await db.query<{ c: Record<string, unknown> }>(
      `select custom->'comments'->0 as c from public.deals where id = '${ids.plainDeal}'`,
    );
    expect(rows[0].c).toMatchObject({ body: "고친 글", version: 2, edit_history: [{ body: "처음" }] });
  });

  it("작성자가 아니거나 버전이 낡았으면 고치지 않는다", async () => {
    await as(ids.teammate);
    expect(await edit(1)).toBe(false);
    await as(ids.owner);
    expect(await edit(5)).toBe(false);
    await expect(edit(1, "   ")).rejects.toThrow(/invalid comment body/);
  });

  it("익명 키로는 두 함수를 부를 수 없다", async () => {
    const { rows } = await db.query<{ a: boolean; b: boolean; c: boolean; d: boolean }>(`
      select has_function_privilege('anon', 'public.reassign_deal_with_activity(uuid,uuid,uuid)', 'execute') as a,
             has_function_privilege('anon', 'public.edit_deal_comment_atomic(uuid,uuid,text,text,integer)', 'execute') as b,
             has_function_privilege('authenticated', 'public.reassign_deal_with_activity(uuid,uuid,uuid)', 'execute') as c,
             has_function_privilege('authenticated', 'public.edit_deal_comment_atomic(uuid,uuid,text,text,integer)', 'execute') as d`);
    expect(rows[0]).toEqual({ a: false, b: false, c: true, d: true });
  });
});
