/**
 * 딜 상세 화면 게이트 (BBE-16).
 *
 * ★ 왜 별도 함수인가 — 화면 게이트와 저장 계층 게이트가 «어긋나면 무음 실패» 가 된다.
 *
 * `localRepo.updateDeal` · `supabaseCrmSource.updateDeal` 은 둘 다
 *   if (assigned_to !== undefined && canSeeAll(ctx)) ...
 * 로 재배정을 거른다. 조건이 안 맞으면 값을 **조용히 버리고** 성공을 돌려준다
 * (권한 상승 방지 목적이라 예외를 던지지 않는다).
 *
 * 그래서 화면이 그보다 넓은 조건으로 셀렉트를 열어 주면, 사용자는 바꿨는데
 * 새로고침하면 되돌아가고 아무 안내도 못 받는다. 실제로 «본인이 담당자면 편집 가능»
 * (canEdit)을 재배정에 그대로 쓰다가 그 상태가 됐다.
 *
 * 이 함수는 저장 계층과 **같은 규칙**을 한 곳에 못 박아 재발을 막는다.
 */

import { canSeeAll } from "@/lib/repo/supabase/source";
import type { Ctx } from "@/lib/types";

/**
 * 담당자 재배정 가능 여부.
 * 저장 계층의 `canSeeAll` 과 반드시 같아야 한다 — 넓히면 무음 실패, 좁히면 기능 손실.
 */
export function canReassignDeal(ctx: Ctx): boolean {
  return canSeeAll(ctx);
}
