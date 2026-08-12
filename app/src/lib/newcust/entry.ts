import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";

export type NewcustEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

/**
 * 현재 조직의 기존 031 신규업체 보드를 유일하게 찾는다.
 *
 * GET 진입점은 조회·이동만 한다. 구조 팩 설치는 owner-only로 별도 승인된 경로에서만
 * 수행해야 하며, 마지막 방문 기록이나 query/cookie는 보드 권한·선택 근거로 쓰지 않는다.
 */
export function resolveExistingNewcustBoard(
  _ctx: Ctx,
  _repo?: BoardsRepo,
): NewcustEntryResolution {
  void _ctx;
  void _repo;
  // BBE-156: 먼데이 복제 보드는 제품 기본 진입 대상으로 더 이상 추론하지 않는다.
  return { kind: "missing" };
}
