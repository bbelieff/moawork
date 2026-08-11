// 퀘스트 판정 — D45b: «했다고 체크»가 아니라 실제 조작을 본다.
//
// judge_kind 는 고정 어휘다(자유 SQL/코드 실행 아님) — supabase/migrations/048_onboarding.sql
// 의 `onboarding_quest_defs.judge_kind` 값과 여기 JUDGES 의 key 가 1:1 이어야 한다.
// BBE-113(GT07)이 자동화 규칙을 퀘스트로 바꿀 때도 이 어휘 안에서만 새 퀘스트 행을 만든다 —
// 새 조작 종류가 필요하면 여기 새 judge_kind 를 추가하는 협의가 먼저다.
//
// 판정은 003 boards/items 를 SQL 로 직접 읽지 않는다 — 그 테이블은 현재 런타임에서
// 쓰이지 않는다(`getBoardsRepo()` 가 LocalBoardsRepo 인메모리 싱글턴만 반환). 실제 상태는
// `BoardsRepo` 포트로만 보인다. 포트를 거치므로 나중에 Supabase 백엔드가 붙어도 이 코드는
// 그대로 간다.

import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";

export type QuestDef = {
  questKey: string;
  title: string;
  description: string | null;
  judgeKind: string;
  judgeParams: Record<string, unknown>;
};

export type QuestJudge = (ctx: Ctx, repo: BoardsRepo, params: Record<string, unknown>) => boolean;

/** 아무 보드에나 항목을 하나 만들었는가. */
function itemCreated(ctx: Ctx, repo: BoardsRepo): boolean {
  return repo.listBoards(ctx).some((board) => repo.listItems(ctx, board.id).length > 0);
}

/**
 * 항목을 보드의 «첫 그룹»이 아닌 다른 그룹으로 옮긴 적이 있는가.
 * 이동 이력을 따로 기록하지 않으므로, 지금 그 그룹에 있다는 사실 자체로 판정한다
 * (첫 그룹이 sort_order 최솟값 — 목업의 «상담 전»·«준비단계» 같은 시작 상태와 대응).
 */
function itemInNonDefaultGroup(ctx: Ctx, repo: BoardsRepo): boolean {
  for (const board of repo.listBoards(ctx)) {
    const groups = repo.listGroups(ctx, board.id);
    if (groups.length === 0) continue;
    const defaultGroupId = groups.reduce((min, g) => (g.sort_order < min.sort_order ? g : min)).id;
    const items = repo.listItems(ctx, board.id);
    if (items.some((item) => item.group_id !== null && item.group_id !== defaultGroupId)) {
      return true;
    }
  }
  return false;
}

/** 어떤 항목이든 컬럼 값을 하나라도 채운 적이 있는가(빈 문자열·null 제외). */
function columnValueSet(ctx: Ctx, repo: BoardsRepo): boolean {
  for (const board of repo.listBoards(ctx)) {
    const items = repo.listItems(ctx, board.id);
    if (items.length === 0) continue;
    const values = repo.listValues(ctx, items.map((i) => i.id));
    if (values.some((v) => v.value_jsonb !== null && v.value_jsonb !== "" && v.value_jsonb !== undefined)) {
      return true;
    }
  }
  return false;
}

export const JUDGES: Record<string, QuestJudge> = {
  item_created: (ctx, repo) => itemCreated(ctx, repo),
  item_in_group: (ctx, repo) => itemInNonDefaultGroup(ctx, repo),
  column_value_set: (ctx, repo) => columnValueSet(ctx, repo),
};

export function isKnownJudgeKind(judgeKind: string): boolean {
  return judgeKind in JUDGES;
}

/** 퀘스트 하나를 판정한다. 알 수 없는 judge_kind 는 실패(false)로 닫는다 — 지어내지 않는다. */
export function judgeQuest(ctx: Ctx, repo: BoardsRepo, quest: QuestDef): boolean {
  const judge = JUDGES[quest.judgeKind];
  if (!judge) return false;
  return judge(ctx, repo, quest.judgeParams);
}
