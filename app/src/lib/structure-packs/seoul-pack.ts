/**
 * 모아프리셋-정책자금1 — 서울경영지원센터 3보드 구조 팩 (PLAN-002/WO-1).
 *
 * SSOT 는 `supabase/migrations/031_newcust_structure_pack.sql` 이고 이 파일은
 * 앱이 쓰는 동일 데이터다. 둘이 어긋나면 `seoul-pack.test.ts` 가 실패한다.
 *
 * 이 팩이 WO-6 공용 프리셋 라이브러리의 초기 데이터가 된다
 * (아이템 프리셋 32종 = 신규업체 14 + 컨텍관리 7 + 업무관리 11).
 */

import { SEOUL_CONTACT_BOARD } from "./seoul-contact";
import { SEOUL_NEWCUST_BOARD } from "./seoul-newcust";
import { SEOUL_WORK_BOARD } from "./seoul-work";
import type { SectionPreset, StructurePack } from "./types";

export const SEOUL_PACK_KEY = "pack.seoul.policyfund1";

/** PLAN-002 §5 WO-6 이 부르는 기본 제공 프리셋 컬렉션 이름. */
export const SEOUL_PACK_NAME = "모아프리셋-정책자금1";

export const SEOUL_STRUCTURE_PACK: StructurePack = {
  key: SEOUL_PACK_KEY,
  name: SEOUL_PACK_NAME,
  source:
    "monday 서울경영지원센터(520253) 실측 2026-08-05 · boards 1816794539 / 1816794566 / 1814266449",
  boards: [SEOUL_NEWCUST_BOARD, SEOUL_CONTACT_BOARD, SEOUL_WORK_BOARD],
};

/**
 * 팩 전체의 아이템 프리셋(= 탭 안의 그룹) 목록. 보드 순서 → 그룹 순서.
 * WO-6 라이브러리가 이 목록을 그대로 초기 데이터로 쓴다.
 */
export function allSectionPresets(pack: StructurePack = SEOUL_STRUCTURE_PACK): SectionPreset[] {
  return pack.boards.flatMap((board) => board.sections);
}
