/**
 * 서류 체크리스트 순수 계산부 (BBE-110).
 *
 * 저장소·서버 액션과 분리한 이유는 BBE-47 의 `components/board/layout.ts` 와 같다 —
 * 판정 규칙이 순수 함수면 완료율이 "표의 셀"과 "상세 패널" 양쪽에서 **같은 함수 호출**로
 * 나오게 만들 수 있다(수용 기준 2). 두 곳이 각자 %를 계산하면 반올림·분모 처리가 갈라져도
 * 아무도 못 알아챈다 — 그래서 이 파일의 `completionOf` 가 유일한 계산 지점이다.
 */

import type { ChecklistCompletion, ChecklistItem, ChecklistPresetItem } from "./types";

/** "높음,보통,낮음" 류 CSV 파서와 동일 관례 — id 는 라벨에서 결정적으로 파생(순서 포함). */
function slugId(prefix: string, index: number, label: string): string {
  return `${prefix}-${index + 1}-${label.replace(/\s+/g, "")}`;
}

/**
 * 프리셋을 딜에 적용한다 — **딜의 기존 항목을 통째로 교체**한다.
 *
 * 부분 병합(겹치는 라벨만 유지 등)을 하지 않는 이유: "상품을 고르면 기본 항목이 채워진다"는
 * 요구가 곧 "그 상품의 정본 목록으로 다시 세팅한다"는 뜻이고, 병합 규칙을 넣는 순간 사용자가
 * 지웠던 항목이 상품을 바꿨다 되돌리면 되살아나는 등 예측 불가능해진다. 프리셋이 없는 상품이면
 * 빈 목록(사용자가 직접 추가)을 돌려준다 — 그 상품엔 아직 기본값이 없다는 뜻을 그대로 반영한다.
 */
export function applyPreset(preset: ChecklistPresetItem[] | null): ChecklistItem[] {
  if (!preset) return [];
  return preset
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item, i) => ({ id: item.id, label: item.label, order: i, checked: false }));
}

/** 항목 하나의 checked 를 뒤집는다. 없는 id 면 원본을 그대로 돌려준다(드롭 실패와 같은 관용). */
export function toggleItem(items: readonly ChecklistItem[], itemId: string): ChecklistItem[] {
  return items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
}

/** 항목 추가 — 목록 맨 끝, 미완료 상태로. 빈 라벨은 무시(빈 항목이 완료율 분모를 오염시키지 않게). */
export function addItem(items: readonly ChecklistItem[], label: string): ChecklistItem[] {
  const trimmed = label.trim();
  if (trimmed === "") return items.slice();
  const order = items.length;
  return [...items, { id: slugId("doc", order, trimmed), label: trimmed, order, checked: false }];
}

/** 항목 삭제 + 남은 항목 order 재정렬(구멍이 생기면 드래그·표시 순서가 흔들리므로). */
export function removeItem(items: readonly ChecklistItem[], itemId: string): ChecklistItem[] {
  return items
    .filter((it) => it.id !== itemId)
    .map((it, i) => ({ ...it, order: i }));
}

/**
 * 완료율의 유일한 계산 지점. total=0(항목이 아직 없음)일 때 percent=0 —
 * "다 했다(100%)"와 "아직 없다"를 혼동하지 않도록 total 을 항상 함께 노출한다.
 */
export function completionOf(items: readonly ChecklistItem[]): ChecklistCompletion {
  const total = items.length;
  const checked = items.filter((it) => it.checked).length;
  const percent = total === 0 ? 0 : Math.round((checked / total) * 100);
  return { checked, total, percent };
}

/** 딜의 현재 체크리스트를 프리셋 형태로 변환(checked 상태는 버린다) — "프리셋으로 저장". */
export function toPresetItems(items: readonly ChecklistItem[]): ChecklistPresetItem[] {
  return items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((it, i) => ({ id: it.id, label: it.label, order: i }));
}
