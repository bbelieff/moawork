/**
 * 2026-09-26 — 보드 셀 드롭다운의 «라벨 검색 및 만들기» 정본.
 *
 * 월요일 사용자 요청(「라벨 검색 및 만들기」)에 따라 일반 select/status/multiselect 셀에서
 * 기존값을 검색해 고르거나, 없으면 새 라벨을 만든다. 이 파일은 화면·서버가 공유하는
 * «순수» 규칙만 담는다 — 정규화·중복 판정·생성 가능 여부. 저장은 서버 액션
 * (`app/src/app/(app)/boards/label-option-actions.ts`)이 기존 컬럼 업데이트 서비스
 * (`BoardsService.updateColumn`)로 수행한다.
 *
 * ★ 정본은 하나다 — 선택지는 항상 컬럼의 `options_jsonb` 다. 여기서 별도 목록을 만들지 않고,
 *   저장 뒤에는 같은 보드를 다시 읽어(revalidate) 다른 셀도 같은 값을 본다.
 */

import type { FieldOption } from "@/lib/types";
import { BULK_BLOCKED_COLUMN_KEYS } from "@/components/board/bulk-selection";

/** 만들기를 막는 컬럼 key — 정본 전환·승인 게이트(일괄 차단과 같은 눈). */
const TRANSITION_BLOCKED_KEYS: ReadonlySet<string> = BULK_BLOCKED_COLUMN_KEYS;

/**
 * 워크플로 단계 컬럼 — 보드 간 전이(`transitions`·`WORKFLOW_PROGRESS` 사양)의 문지기다.
 * 새 값을 넣으면 «다음으로 넘기기» 값과 섞여 전이 의미가 흐려진다.
 */
const WORKFLOW_STAGE_KEYS: ReadonlySet<string> = new Set(["consult_status", "contract_status"]);

/**
 * 이동 규칙(`move_rule_jsonb`)을 가진 컬럼의 단계값 — 새 라벨에는 규칙이 없어
 * «골랐는데 카드가 안 움직이는» 상태가 된다. 규칙 없는 새 값은 워크플로 의미를 깨뜨리므로
 * 만들기를 막는다(검색·선택은 그대로 된다).
 */
const MOVE_RULE_STAGE_KEYS: ReadonlySet<string> = new Set(["progress_status"]);

/**
 * 종속 카탈로그 지역 — 시도·시군구는 «알려진 목록» 이라 새로 만들 수 없다.
 * 시군구는 시도에 종속되므로(dependent catalog) 낱개 생성이 목록을 깬다.
 */
const REGION_CATALOG_KEYS: ReadonlySet<string> = new Set(["sido", "sigungu"]);

/** 만들기가 허용되는 셀 타입 — 검색·선택은 모든 타입에서 된다. */
const CREATABLE_TYPES: ReadonlySet<string> = new Set(["select", "status", "multiselect"]);

export type LabelColumnHead = Readonly<{
  key: string;
  type: string;
  source: string;
  is_readonly?: boolean | null;
  move_rule_jsonb?: Record<string, string> | null;
}>;

/**
 * 공백·대소문자 정규화 — «같은 라벨» 판정의 눈이다. 표시 라벨은 손대지 않고
 * 비교할 때만 쓴다(합치는 용도가 아니라 중복 판정 용도 — 자동 병합 없음).
 */
export function normalizeLabelKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 저장될 표시 라벨 — 앞뒤 공백·연속 공백만 정리한다. */
export function normalizeLabelDisplay(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

export type LabelGuard = Readonly<
  | { allowed: true }
  | { allowed: false; reason: string }
>;

/**
 * 이 컬럼에서 새 라벨을 «만들어도» 되는가.
 *
 * 막히는 경우(어느 하나라도 해당):
 *   · 전환·승인 게이트 컬럼(`contact_move`·`work_move`·`seal_*` — 일괄 차단과 같은 눈)
 *   · 워크플로 단계 컬럼(`consult_status`·`contract_status` — 전이 값이 섞인다)
 *   · 이동 규칙 단계 컬럼(`progress_status` — 규칙 없는 값은 카드를 안 움직인다)
 *   · 지역 카탈로그(`sido`·`sigungu` — 종속된 알려진 목록)
 *   · 읽기 전용·수식·연동 출처(`is_readonly`·`calc`·`lk` — 정본이 다른 곳에 있다)
 *   · select/status/multiselect 가 아닌 타입
 *
 * ★ 검색·기존값 선택은 여기서 막지 않는다 — 만들기만 막는다.
 *   권한(컬럼 관리)은 서버 액션이 별도로 본다.
 */
export function canCreateLabelForColumn(column: LabelColumnHead): LabelGuard {
  if (!CREATABLE_TYPES.has(column.type)) {
    return { allowed: false, reason: "이 칸에서는 새 값을 만들 수 없습니다." };
  }
  if (TRANSITION_BLOCKED_KEYS.has(column.key)) {
    return { allowed: false, reason: "다음 업무로 넘기는 열에서는 새 값을 만들 수 없습니다." };
  }
  if (WORKFLOW_STAGE_KEYS.has(column.key)) {
    return { allowed: false, reason: "업무 단계 열에서는 새 값을 만들 수 없습니다." };
  }
  if (MOVE_RULE_STAGE_KEYS.has(column.key)) {
    return { allowed: false, reason: "진행상황 값은 정해진 단계에서만 고를 수 있습니다." };
  }
  if (REGION_CATALOG_KEYS.has(column.key)) {
    return { allowed: false, reason: "지역은 정해진 목록에서만 고를 수 있습니다." };
  }
  if (column.is_readonly === true || column.type === "calc" || column.source === "calc") {
    return { allowed: false, reason: "자동으로 채워지는 칸에서는 새 값을 만들 수 없습니다." };
  }
  if (column.source === "lk") {
    return { allowed: false, reason: "연동된 정보에서는 새 값을 만들 수 없습니다." };
  }
  if (column.move_rule_jsonb && Object.keys(column.move_rule_jsonb).length > 0) {
    return { allowed: false, reason: "카드를 옮기는 열에서는 새 값을 만들 수 없습니다." };
  }
  return { allowed: true };
}

export type LabelMerge =
  | { created: true; options: FieldOption[]; optionId: string }
  | { created: false; options: FieldOption[]; optionId: string; duplicateOf: string };

/**
 * 기존 선택지 배열에 새 라벨을 «덧붙인다».
 *
 *   · 기존 항목의 id·label·color·order 는 그대로 둔다(덮어쓰기 없음).
 *   · 새 항목의 id 는 정리된 표시 라벨과 같다(기존 `id === label` 관례).
 *   · id 또는 정규화 라벨이 이미 있으면 만들지 않고 기존 id 를 돌려준다(충돌).
 *   · 빈 라벨은 `null` 을 돌려준다 — 호출부가 메시지로 막는다.
 *
 * 동시 추가는 «같은 입력 → 같은 결과» 라 수렴한다. 다른 라벨의 경합은 서버 액션이
 * 다시 읽고 한 번 더 합쳐서 메꾼다(`label-option-actions.ts`).
 */
export function mergeLabelOption(
  existing: readonly FieldOption[],
  label: string,
): LabelMerge | null {
  const display = normalizeLabelDisplay(label);
  if (display === "") return null;
  const wanted = normalizeLabelKey(display);
  const duplicate = existing.find(
    (option) => option.id === display || normalizeLabelKey(option.label) === wanted,
  );
  if (duplicate) {
    return { created: false, options: [...existing], optionId: duplicate.id, duplicateOf: duplicate.label };
  }
  const order = existing.reduce((next, option) => Math.max(next, option.order ?? -1), -1) + 1;
  return {
    created: true,
    options: [...existing, { id: display, label: display, order }],
    optionId: display,
  };
}

/**
 * 만들기 요청의 추적 열쇠 — 서버 액션이 빈 값을 거절하므로 제출 직전에 찍는다.
 * `crypto.randomUUID` 는 secure context 에만 있어 http 모바일에서 없을 수 있다 —
 * intake 폼(`ContractWorkIntakeForm.newRequestId`)과 같은 대체 경로를 쓴다.
 */
export function newLabelRequestId(): string {
  const api = globalThis.crypto as Pick<Crypto, "randomUUID" | "getRandomValues"> | undefined;
  if (typeof api?.randomUUID === "function") return api.randomUUID();
  const bytes = new Uint8Array(16);
  api?.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 드롭다운 검색 — 대소문자 무시 부분 일치(label·id). 빈 쿼리면 전체를 돌려준다.
 * 선택지 정의가 없는 컬럼이면 빈 배열이다(검색할 것이 없다).
 */
export function filterLabelOptions(
  options: readonly FieldOption[] | null | undefined,
  query: string,
): FieldOption[] {
  const list = options ?? [];
  const wanted = normalizeLabelKey(query);
  if (wanted === "") return [...list];
  return list.filter(
    (option) =>
      normalizeLabelKey(option.label).includes(wanted) || normalizeLabelKey(option.id).includes(wanted),
  );
}
