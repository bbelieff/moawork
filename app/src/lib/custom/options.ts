/**
 * 선택지(옵션) 관리 (T05 core.custom) — select/multiselect 의 options_jsonb.
 *
 * 핵심 불변식: **저장값은 옵션 id 를 참조**(라벨 아님). 라벨/색/순서를 바꿔도
 * 저장된 field_values 는 그대로 유지된다(먼데이 동작 재현). 그래서 모든 편집 연산은
 * id 를 보존하며, 삭제는 기본 금지(보관=archive)한다.
 *
 * 순수 모듈 — 배열 in/out. 영속성 없음.
 */

import type { FieldOption } from "./domain-types";
import { ValidationError } from "./field-types";

export interface AddOptionInput {
  label: string;
  color?: string;
}

/** 다음 order 값(말미 추가용). */
function nextOrder(options: FieldOption[]): number {
  return options.reduce((max, o) => Math.max(max, o.order ?? 0), 0) + 1;
}

function requireLabel(label: unknown): string {
  if (typeof label !== "string") throw new ValidationError("option.label: 문자열이어야 합니다");
  const t = label.trim();
  if (t === "") throw new ValidationError("option.label: 비어 있을 수 없습니다");
  if (t.length > 200) throw new ValidationError("option.label: 200자를 초과했습니다");
  return t;
}

/**
 * 옵션 추가 — 불투명 id 발급(라벨 slug 아님, 중복 라벨/개명 안전).
 * genId 주입으로 결정적 테스트(T02/T09 패턴).
 */
export function addOption(
  options: FieldOption[],
  input: AddOptionInput,
  genId: () => string,
): FieldOption[] {
  const label = requireLabel(input.label);
  const opt: FieldOption = {
    id: genId(),
    label,
    order: nextOrder(options),
  };
  if (input.color !== undefined) opt.color = input.color;
  return [...options, opt];
}

/** 라벨 변경 — 저장값 무영향(id 고정). */
export function renameOption(
  options: FieldOption[],
  optionId: string,
  label: string,
): FieldOption[] {
  const next = requireLabel(label);
  let found = false;
  const out = options.map((o) => {
    if (o.id !== optionId) return o;
    found = true;
    return { ...o, label: next };
  });
  if (!found) throw new ValidationError(`option: 없는 옵션 id(${optionId})`);
  return out;
}

/** 색 변경 — 저장값 무영향. */
export function recolorOption(
  options: FieldOption[],
  optionId: string,
  color: string | undefined,
): FieldOption[] {
  let found = false;
  const out = options.map((o) => {
    if (o.id !== optionId) return o;
    found = true;
    const next: FieldOption = { ...o };
    if (color === undefined) delete next.color;
    else next.color = color;
    return next;
  });
  if (!found) throw new ValidationError(`option: 없는 옵션 id(${optionId})`);
  return out;
}

/**
 * 순서 재배치 — orderedIds 순서대로 order 를 0..n 재부여.
 * orderedIds 에 없는 옵션은 뒤에 원래 상대순서 유지로 붙인다(부분 재배치 허용).
 */
export function reorderOptions(options: FieldOption[], orderedIds: string[]): FieldOption[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  let order = 0;
  for (const id of orderedIds) {
    const o = byId.get(id);
    if (!o || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...o, order: order++ });
  }
  // 남은 옵션(재배치 목록 밖) — 기존 순서 유지하며 말미로.
  for (const o of options) {
    if (seen.has(o.id)) continue;
    out.push({ ...o, order: order++ });
  }
  return out;
}

/** 보관(소프트) — 신규 선택 불가, 기존 저장값은 유지. */
export function archiveOption(options: FieldOption[], optionId: string): FieldOption[] {
  let found = false;
  const out = options.map((o) => {
    if (o.id !== optionId) return o;
    found = true;
    return { ...o, archived: true };
  });
  if (!found) throw new ValidationError(`option: 없는 옵션 id(${optionId})`);
  return out;
}

/** 보관 해제. */
export function unarchiveOption(options: FieldOption[], optionId: string): FieldOption[] {
  let found = false;
  const out = options.map((o) => {
    if (o.id !== optionId) return o;
    found = true;
    const next: FieldOption = { ...o };
    delete next.archived;
    return next;
  });
  if (!found) throw new ValidationError(`option: 없는 옵션 id(${optionId})`);
  return out;
}

/** 활성(비보관) 옵션만 — 신규 선택 UI 용. */
export function activeOptions(options: FieldOption[]): FieldOption[] {
  return options
    .filter((o) => !o.archived)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * 고아 값 진단 — 존재하지 않는(또는 이 필드에 없는) 옵션 id 를 참조하는 저장값 탐지.
 * select 는 string, multiselect 는 string[] 저장형. lint/T10 검증용.
 * @returns 정의에 없는 옵션 id 집합.
 */
export function findOrphanOptionIds(
  options: FieldOption[],
  usedIds: Iterable<string>,
): string[] {
  const known = new Set(options.map((o) => o.id));
  const orphans = new Set<string>();
  for (const id of usedIds) if (!known.has(id)) orphans.add(id);
  return [...orphans];
}
