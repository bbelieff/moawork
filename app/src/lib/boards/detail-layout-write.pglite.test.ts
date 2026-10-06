import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * #654 (2026-10-06 운영) — 상세 배치 저장이 «0행인데 오류 없음» 으로 끝날 수 있는가.
 *
 * 저장소(SupabaseBoardsRepo.setGroupDetailLayout / setBoardDetailLayout)는
 * `update … select … maybeSingle()` 이다. RLS 의 USING 이 행을 걸러내면 Postgres 는
 * 오류 없이 0행을 돌려주고, 저장소는 그걸 undefined 로 바꿔 «성공처럼» 끝낸다.
 * 그 경로가 실제 정책에서 살아 있는지 여기서 잰다 — 정책 문장은 손으로 베끼지 않고
 * migration 파일(003·128)에서 그대로 꺼내고, 쓰기 권한 트리거는 088 을 통째로 올린다.
 */
const migrations = resolve(process.cwd(), "../supabase/migrations");
const read = (name: string) => readFileSync(resolve(migrations, name), "utf8");
function statement(sql: string, pattern: RegExp): string {
  const found = sql.match(pattern)?.[0];
  if (!found) throw new Error(`policy statement not found: ${pattern}`);
  return found;
}
const groupPolicy = statement(read("003_boards_engine.sql"), /^create policy bgroups_rw[^;]*;/mu);
const boardsSql = read("128_issue542_new_lead_v6plus.sql");
const boardsReadPolicy = statement(boardsSql, /^create policy boards_read on public\.boards[^;]*;/mu);
const boardsUpdatePolicy = statement(boardsSql, /^create policy boards_update on public\.boards[^;]*;/mu);
const layoutGuard = read("088_bbe175_detail_layout_drift_repair.sql");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const OTHER_ORG = id(2);
const OWNER = id(10);
const MEMBER = id(11);
const BOARD = id(20);
const GROUP = id(30);
const OTHER_GROUP = id(31);
const LAYOUT = JSON.stringify([{ key: "detail_qa-654", source: "detail", label: "QA-654", type: "text" }]);

describe("#654 상세 배치 update 의 실제 RLS 결과", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.org_members(org_id uuid, user_id uuid, role text not null, primary key(org_id,user_id));
      create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp
        as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid())$$;
      create function public.org_role(p_org uuid) returns text language sql stable security definer set search_path=public,pg_temp
        as $$select role from public.org_members where org_id=p_org and user_id=auth.uid()$$;
      -- 실제 effective_permission 은 좌석·역할 정의를 읽는다. 여기서는 «멤버는 컬럼 관리만, 탭 관리는 owner/admin» 인 회사를 흉내 낸다.
      create function public.effective_permission(p_org uuid, p_key text) returns boolean language sql stable security definer set search_path=public,pg_temp
        as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid()
          and (role in ('owner','admin') or p_key <> 'structure.tab_manage'))$$;
      create table public.boards(id uuid primary key, org_id uuid not null, name text not null, source text,
        detail_layout_jsonb jsonb default '[]'::jsonb, updated_at timestamptz default now());
      create table public.board_groups(id uuid primary key, org_id uuid not null, board_id uuid not null, name text not null,
        detail_layout_jsonb jsonb);
      insert into public.org_members values ('${ORG}','${OWNER}','owner'), ('${ORG}','${MEMBER}','member');
      insert into public.boards(id,org_id,name,source) values ('${BOARD}','${ORG}','리드컨택 관리','core.default-tab/contact');
      insert into public.board_groups(id,org_id,board_id,name) values
        ('${GROUP}','${ORG}','${BOARD}','컨텍'), ('${OTHER_GROUP}','${OTHER_ORG}','${id(21)}','다른 회사 그룹');
    `);
    await db.exec(layoutGuard);
    await db.exec(`
      alter table public.boards enable row level security;
      alter table public.board_groups enable row level security;
      ${groupPolicy}
      ${boardsReadPolicy}
      ${boardsUpdatePolicy}
      grant usage on schema public, auth to authenticated;
      grant execute on function auth.uid(), public.is_org_member(uuid), public.org_role(uuid), public.effective_permission(uuid,text) to authenticated;
      grant select, update on public.board_groups to authenticated;
      grant select on public.boards to authenticated;
      grant update(name, source, detail_layout_jsonb, updated_at) on public.boards to authenticated;
    `);
  });

  afterEach(async () => db.close());

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  const updateGroup = (groupId: string, org = ORG) => db.query(
    "update public.board_groups set detail_layout_jsonb = $1::jsonb where org_id = $2 and id = $3 returning id, detail_layout_jsonb",
    [LAYOUT, org, groupId],
  );
  const updateBoard = () => db.query(
    "update public.boards set detail_layout_jsonb = $1::jsonb, updated_at = now() where org_id = $2 and id = $3 returning id, detail_layout_jsonb",
    [LAYOUT, ORG, BOARD],
  );

  it("owner 의 그룹 배치 저장은 한 행을 바꾸고 바뀐 배치를 돌려준다 — 운영의 「💰 컨텍」 저장과 같은 경로", async () => {
    await as(OWNER);
    const result = await updateGroup(GROUP);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ detail_layout_jsonb: JSON.parse(LAYOUT) });
  });

  it("★ 탭 관리 권한이 없으면 보드 기본 배치 update 는 «오류 없이 0행» 이다 — 저장소가 undefined 를 성공처럼 돌려주던 경로", async () => {
    await as(MEMBER);
    const result = await updateBoard();
    expect(result.rows).toHaveLength(0);
    await db.exec("reset role");
    const stored = await db.query<{ n: number }>(
      "select jsonb_array_length(detail_layout_jsonb) n from public.boards where id = $1", [BOARD],
    );
    expect(stored.rows[0].n).toBe(0);
  });

  it("다른 회사 그룹을 가리키면(잘못된 groupId) 역시 오류 없이 0행이다", async () => {
    await as(OWNER);
    expect((await updateGroup(OTHER_GROUP, OTHER_ORG)).rows).toHaveLength(0);
  });

  it("owner/admin 이 아닌 멤버의 그룹 배치 변경은 088 트리거가 «오류로» 막는다 — 조용히 사라지지 않는다", async () => {
    await as(MEMBER);
    await expect(updateGroup(GROUP)).rejects.toThrow(/detail layout write requires owner or admin/u);
  });
});
