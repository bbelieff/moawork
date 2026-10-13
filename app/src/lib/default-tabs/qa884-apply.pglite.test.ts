import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// QA #884 · migration 176 — 이미 깔린 기본 탭 보드에 이름·읽기 전용·이동 규칙을 «안 건드린 것만» 적용한다.
const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/176_default_tab_rev_qa884_apply.sql"), "utf8");
const id = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const B = { fresh: id("1"), custom: id("2"), work: id("3"), gone: id("4") };

const SCHEMA = `
  create table public.boards(id uuid primary key, source text, deleted_at timestamptz);
  create table public.board_groups(id uuid primary key default gen_random_uuid(), board_id uuid, name text, sort_order int);
  create table public.board_columns(id uuid primary key default gen_random_uuid(), board_id uuid, key text, label text, is_readonly boolean default false, move_rule_jsonb jsonb);
  create function public.begin_guarded_migration(p_logical_key text, p_file_name text, p_file_digest text, p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean) returns void language sql as $$ select $$;
  insert into public.boards values ('${B.fresh}','core.default-tab/contact',null),('${B.custom}','core.default-tab/contact',null),('${B.work}','core.default-tab/contract-work',null),('${B.gone}','core.default-tab/contact',now());
  insert into public.board_groups(board_id,name,sort_order) select b, n, o from (values
    ('${B.fresh}'::uuid,'💰 계약보류(온/오프)',3),('${B.fresh}'::uuid,'📍 미팅보류',4),('${B.fresh}'::uuid,'📍 미팅취소',5),('${B.fresh}'::uuid,'📍 계약취소',6),
    ('${B.custom}'::uuid,'📍 미팅취소',5)) v(b,n,o);
  insert into public.board_columns(board_id,key,label,is_readonly,move_rule_jsonb) values
    ('${B.fresh}','founded_year','창업년도',false,null),('${B.fresh}','meeting_at','전자계약 / 미팅일정',false,null),
    ('${B.fresh}','contract_status','계약상황',false,'{}'::jsonb),('${B.fresh}','contract_fee_status','계약금 완료여부',false,null),
    ('${B.custom}','founded_year','설립 연도',false,null),('${B.custom}','contract_status','계약상황',false,'{"계약취소":"x"}'::jsonb),
    ('${B.work}','annual_revenue','연 매출액',true,null),('${B.work}','contract_deposit_paid_on','계약금_입금일',false,null),
    ('${B.gone}','founded_year','창업년도',false,null);
`;

let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(SCHEMA); await db.exec(migration); });
afterAll(async () => { await db.close(); });
const col = async (board: string, key: string) =>
  (await db.query<{ label: string; is_readonly: boolean; move_rule_jsonb: Record<string, string> | null }>(
    `select label, is_readonly, move_rule_jsonb from board_columns where board_id=$1 and key=$2`, [board, key])).rows[0];

describe("migration 176 — 기본 탭 #884 적용", () => {
  it("예전 이름 그대로인 칸만 새 이름으로 바꾼다(회사가 바꾼 이름·지운 보드는 그대로)", async () => {
    expect((await col(B.fresh, "founded_year")).label).toBe("창업연도");
    expect((await col(B.fresh, "contract_fee_status")).label).toBe("계약금 입금여부");
    expect((await col(B.work, "annual_revenue")).label).toBe("매출");
    expect((await col(B.work, "contract_deposit_paid_on")).label).toBe("계약금 입금일");
    expect((await col(B.custom, "founded_year")).label).toBe("설립 연도");
    expect((await col(B.gone, "founded_year")).label).toBe("창업년도");
  });

  it("리드컨택 미팅 일시는 새 이름 + 읽기 전용", async () => {
    expect(await col(B.fresh, "meeting_at")).toMatchObject({ label: "미팅 일시", is_readonly: true });
  });

  it("비어 있던 계약상황 규칙만 4개 그룹으로 채우고, 회사 규칙은 그대로 둔다", async () => {
    const rule = (await col(B.fresh, "contract_status")).move_rule_jsonb ?? {};
    expect(Object.keys(rule).sort()).toEqual(["계약 보류", "계약취소", "미팅보류", "미팅취소"].sort());
    expect((await col(B.custom, "contract_status")).move_rule_jsonb).toEqual({ 계약취소: "x" });
  });
});
