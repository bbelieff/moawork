/**
 * 체크리스트용 "진행 상품" 목록 (BBE-110 재배정 지시 — "목업의 «진행 상품» 선택지를
 * 그대로 쓴다. dump 출력에서 확인해라").
 *
 * ⚠ `@/lib/policyfund/presets` 의 `product`(59종)와는 **다른 세대**다. 그건
 * `002_seed_policyfund.sql`(field_presets.product)에 박힌 **구 먼데이 스크레이핑 원본**이고,
 * 이 7종은 v6 목업이 재설계한 **신규 체크리스트용 상품 목록**이다. 리스가 서로 달라
 * (presets.ts 는 리스 밖·구세대 59종 그대로 유지) 병합하지 않았다 — 섞으면 어느 쪽도
 * 정본이 아니게 된다.
 *
 * 실측 명령(목업이 바뀌면 이 상수도 다시 대조):
 *   node docs/design/dump-mockup.mjs work
 * → "계약업체 실무" 탭 "선택지" 절의 "진행 상품" 줄을 그대로 옮겼다(2026-08-11 실측).
 */

import type { OptionCategory, PresetOption } from "@/lib/policyfund";

/** v6 목업 "계약업체 실무" 탭 "진행 상품" 선택지 원문 순서 그대로. */
export const CHECKLIST_PRODUCT_LABELS: readonly string[] = [
  "혁신성장 일반",
  "혁신성장 혁신형",
  "소공인 대리대출",
  "기보 혁신리딩",
  "신보 유동화",
  "경기신보 특례",
  "벤처기업 인증",
];

const OPTIONS: PresetOption[] = CHECKLIST_PRODUCT_LABELS.map((label, order) => ({
  id: label,
  label,
  order,
}));

/** `ChecklistPanel`/`ProductChecklistAdmin` 의 `productCategory` prop 에 바로 넘길 수 있는 형태. */
export const CHECKLIST_PRODUCT_CATEGORY: OptionCategory = {
  id: "product",
  label: "진행 상품",
  options: OPTIONS,
};
