import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { NEW_LEAD_TAB } from "@/lib/default-tabs";

export type NewcustEntryResolution =
  | { kind: "ready"; boardId: string }
  | { kind: "missing" }
  | { kind: "conflict" };

/**
 * 현재 조직의 신규리드 보드를 유일하게 찾는다.
 *
 * ⚠ **정본 정정(BBE-145 · A′ 판정 BBE-154)** — 예전엔 «구조 팩»(`SEOUL_NEWCUST_BOARD`, 먼데이
 * 원본 계보)의 이름으로 찾았다. A′ 로 그 팩은 **이관 매핑 사전**이 됐고, 워크스페이스 생성 시
 * 실제로 서는 보드는 **제품 기본 구조**(`NEW_LEAD_TAB`, `@/lib/default-tabs`)다(D76 —
 * `ensureDefaultTabs()` 가 생성 직후 심는다). 이 함수가 옛 이름으로 계속 찾으면 «관리자가
 * 구조 팩 설치를 완료하면」 이라는 막다른 안내만 영원히 뜬다 — belie 가 프로덕션에서 실제로
 * 부딪힌 화면이 이것이다(worklog BBE-46 항목).
 *
 * ⚠ **BBE-156 과의 조율** — 그 카드는 같은 함수를 «먼데이 복제 보드는 더 이상 추론하지
 * 않는다» 는 이유로 무조건 `missing` 을 반환하도록 임시로 끊어 뒀다(내 PR #170 이 미병합
 * 상태일 때 안전 우선으로 내린 판단 — 정당하다). 이 버전은 그 우려를 그대로 지키면서
 * (먼데이 이름을 다시는 보지 않는다) **실제 목적지(default-tabs 보드)로 마저 연결**한다.
 * 둘 중 하나를 버리는 게 아니라 BBE-156 이 끊어 둔 자리를 이어받는 것이다.
 *
 * GET 진입점은 조회·이동만 한다. 마지막 방문 기록이나 query/cookie는 보드 권한·선택 근거로
 * 쓰지 않는다.
 *
 * ⚠ 이름으로 찾는 한계는 여전하다 — 회사가 탭 이름을 바꾸면(D76·D77 이 허용) 못 찾는다.
 * 안정적인 식별자는 `default-tabs/install.ts` 의 같은 주석에 후속으로 남겨 뒀다.
 */
export function resolveExistingNewcustBoard(
  ctx: Ctx,
  repo: BoardsRepo = getBoardsRepo(),
): NewcustEntryResolution {
  const existing = repo
    .listBoards(ctx)
    .filter((board) => board.name === NEW_LEAD_TAB.name);

  if (existing.length === 1) return { kind: "ready", boardId: existing[0].id };
  return { kind: existing.length === 0 ? "missing" : "conflict" };
}
