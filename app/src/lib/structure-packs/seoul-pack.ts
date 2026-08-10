/**
 * 모아프리셋-정책자금1 — 서울경영지원센터 3보드 구조 팩 (PLAN-002/WO-1).
 *
 * SSOT 는 `supabase/migrations/031_newcust_structure_pack.sql` 이고 이 파일은
 * 앱이 쓰는 동일 데이터다. 둘이 어긋나면 `seoul-pack.test.ts` 가 실패한다.
 *
 * 이 팩이 WO-6 공용 프리셋 라이브러리의 초기 데이터가 된다
 * (아이템 프리셋 32종 = 신규업체 14 + 컨텍관리 7 + 업무관리 11).
 */

import type { FieldOption } from "@/lib/types";
import { regionOptions } from "./region-options";
import { SEOUL_CONTACT_BOARD } from "./seoul-contact";
import { SEOUL_NEWCUST_BOARD } from "./seoul-newcust";
import { SEOUL_WORK_BOARD } from "./seoul-work";
import type { SectionPreset, StructurePack } from "./types";

/** 002 `field_presets.biz_reg_type` 와 같은 6종. 두 보드가 공유한다. */
const BIZ_REG_TYPES = ["개인/면세", "개인/간이", "개인/일반", "개인/성실", "법인", "법인/성실"];

/**
 * 보드가 공유하는 선택지 세트 — `optionRef` 의 실체.
 *
 * `region` 은 시드 확정 ② 로 정규화한 공용 1세트다(`region-options.ts`).
 * `biz_reg_type` 은 002 프리셋과 같은 값이다 — 먼데이 원본은 보드마다 8·9종이고
 * `개인사업자`·`법인사업자` 처럼 앞 항목과 의미가 겹치는 라벨이 섞여 있어
 * 002 가 이미 정리해 둔 6종을 그대로 쓴다(중복 정의를 만들지 않는다).
 */
export const SEOUL_OPTION_SETS: Record<string, FieldOption[]> = {
  region: regionOptions(),
  biz_reg_type: BIZ_REG_TYPES.map((label, order) => ({ id: label, label, order })),
};

export const SEOUL_PACK_KEY = "pack.seoul.policyfund1";

/** PLAN-002 §5 WO-6 이 부르는 기본 제공 프리셋 컬렉션 이름. */
export const SEOUL_PACK_NAME = "모아프리셋-정책자금1";

export const SEOUL_STRUCTURE_PACK: StructurePack = {
  key: SEOUL_PACK_KEY,
  name: SEOUL_PACK_NAME,
  source:
    "monday 서울경영지원센터(520253) 실측 2026-08-05 · boards 1816794539 / 1816794566 / 1814266449 · 시드 확정 3건 반영 2026-08-09",
  optionSets: SEOUL_OPTION_SETS,
  boards: [SEOUL_NEWCUST_BOARD, SEOUL_CONTACT_BOARD, SEOUL_WORK_BOARD],
};

/**
 * 팩 전체의 아이템 프리셋(= 탭 안의 그룹) 목록. 보드 순서 → 그룹 순서.
 * WO-6 라이브러리가 이 목록을 그대로 초기 데이터로 쓴다.
 */
export function allSectionPresets(pack: StructurePack = SEOUL_STRUCTURE_PACK): SectionPreset[] {
  return pack.boards.flatMap((board) => board.sections);
}
