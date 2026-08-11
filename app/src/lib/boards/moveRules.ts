/**
 * 아이템 자동 이동 규칙 (D68~D70) — 값이 바뀌면 아이템이 그룹을 옮겨간다.
 *
 * 목업 실측(dump-mockup.mjs new): "상담 상황" 이 «상담 전»이면 💡신규고객,
 * «거절»이면 🚫거절 그룹으로 — 같은 매커니즘이 리드컨택·계약업체 실무의
 * "다음으로 넘기는 조작 열"(D69, 우측 고정)에도 그대로 쓰인다.
 * 규칙은 특정 컬럼명에 하드코딩하지 않는다 — 어느 select 컬럼이든
 * `move_rule_jsonb`(선택지 id → 목표 group id)를 가지면 이 컬럼이 곧 "조작 열"이다.
 *
 * 순수 함수만 담는다(도메인 규칙과 저장 부수효과를 분리 — service.ts 가 조합).
 */

import type { BoardColumn, CellValue } from "./types";

/**
 * 컬럼의 이동 규칙과 새 값으로 목표 그룹을 정한다.
 * - 규칙이 없는 컬럼(일반 컬럼) → null(이동 안 함)
 * - 값이 선택지 배열(multiselect)이면 이동 규칙 대상이 아니다 → null
 *   (여러 그룹을 동시에 가리킬 수 없다 — "다음 단계"는 단일 목적지여야 한다)
 * - 값이 규칙에 없는 선택지(또는 빈 값)면 → null(그 값은 이동을 유발하지 않음)
 */
export function resolveMoveTarget(
  column: Pick<BoardColumn, "move_rule_jsonb">,
  newValue: CellValue,
): string | null {
  const rule = column.move_rule_jsonb;
  if (!rule) return null;
  if (Array.isArray(newValue)) return null;
  if (newValue === null || newValue === undefined) return null;
  const key = String(newValue);
  return rule[key] ?? null;
}

/** 이 컬럼이 "조작 열"(이동 규칙을 가진 컬럼)인가 — UI/서비스가 분기용으로 쓴다. */
export function isMoveColumn(column: Pick<BoardColumn, "move_rule_jsonb">): boolean {
  return Boolean(column.move_rule_jsonb && Object.keys(column.move_rule_jsonb).length > 0);
}
