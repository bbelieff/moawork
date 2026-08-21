/**
 * 그룹별 컬럼 배치 오버라이드 저장소 (PLAN-002 WO-2 ⓑ).
 *
 * 저장하는 것은 **배치뿐**이다 — 컬럼 정의도, 셀 값도 여기 없다. 그래서 이 저장소가
 * 통째로 비어도 화면은 보드 기본 순서로 정상 렌더된다(원상복구 = 오버라이드 삭제).
 * 판정 규칙은 `@/components/board/layout` 의 `resolveColumnOrder` 가 단독으로 갖는다.
 *
 * 운영 정본은 `board_views.visible_columns_jsonb` 의 예약된 조직 공용 행이다. 저장소 포트가
 * 읽기와 쓰기를 함께 소유하므로 프로세스가 바뀌거나 여러 인스턴스가 떠도 같은 값을 본다.
 *
 * 호출부가 먼저 보드 접근을 확인하고, 운영 쓰기 RPC도 `structure.column_manage` 와 보드의
 * 조직을 다시 확인한다. 따라서 Data API를 직접 호출해도 타 조직·권한 밖 쓰기는 닫힌다.
 */

import type { GroupColumnOrder } from "@/components/board/layout";
import type { BoardsRepo } from "@/lib/boards/store";
import type { Ctx } from "@/lib/types";

/** 보드 한 장의 전체 오버라이드(그룹 키 → 컬럼 key 배열). 없으면 빈 객체. */
export async function getBoardColumnOrder(
  repo: BoardsRepo,
  ctx: Ctx,
  boardId: string,
): Promise<GroupColumnOrder> {
  return repo.getGroupColumnOrder(ctx, boardId);
}

/**
 * 그룹 하나의 배치를 저장한다. 빈 배열을 주면 오버라이드를 **지운다**
 * (= 그 그룹만 보드 기본 순서로 되돌리기).
 */
export async function setGroupColumnOrder(
  repo: BoardsRepo,
  ctx: Ctx,
  boardId: string,
  groupKey: string,
  columnKeys: readonly string[],
): Promise<void> {
  await repo.setGroupColumnOrder(ctx, boardId, groupKey, columnKeys);
}
