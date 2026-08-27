/**
 * 셀 값 처리 (T02b 보드) — **검증 엔진은 T05 레지스트리로 단일화**(기획2 판정 2026-07-21).
 *
 * 이 파일은 더 이상 자체 정규화 로직을 갖지 않고 `@/lib/custom/field-types` 에 위임한다.
 * (2중/3중 구현 금지 — 001 field_type 13종의 정본 판정은 그 레지스트리 하나다.)
 *
 * 정책 요약:
 * - 엔진은 **던지지 않고 결과를 반환**한다: `validateCell() → {ok, value, error?}`.
 * - 던질지 흘릴지는 **호출부(service)** 가 정한다 — 기본은 관대 + 인라인 피드백,
 *   무결성 필드만 하드 거부(`isIntegrityField`).
 * - ⛔ 형식 오류를 조용히 null 로 수렴시키지 않는다(데이터 유실).
 */

import type { FieldOption, FieldType } from "@/lib/types";
import { getFieldTypeSpec, validateValue } from "@/lib/custom/field-types";
// `@/lib/format`(배럴)은 동명의 형제 파일 `lib/format.ts`(날짜 포맷 전용)에 가려 조용히
// 엉뚱한 모듈로 리졸브된다(지금까지 이 배럴의 실제 소비자가 0곳이라 아무도 못 봤다) —
// 파일을 직접 가리켜 우회한다.
import { analyzePhone, formatPhone } from "@/lib/format/phone";
import {
  canonicalNumberString,
  formatDecimal,
} from "@/lib/format/number";
import type { CellValue } from "./types";
import {
  checkedOtherInfoCount,
  isOtherInfoValue,
  otherInfoCountLabel,
  otherInfoSearchText,
} from "./structured-field";

/** 선택지를 갖는 타입. */
export function hasOptions(type: FieldType): boolean {
  return getFieldTypeSpec(type).supportsOptions;
}

/** 셀 검증 결과 — 실패해도 던지지 않는다. */
export interface CellValidation {
  ok: boolean;
  /** ok=true 일 때만 저장할 값. 실패 시 null(저장 금지). */
  value: CellValue;
  /** ok=false 일 때 사용자에게 보여줄 사유. */
  error?: string;
}

/** jsonb 값을 보드 셀 표현(CellValue)으로 좁힌다. */
function toCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return String(v);
}

/**
 * 셀 값 검증·정규화 — 보드 쓰기 경로의 유일한 진입점.
 * 옵션 목록이 없으면(느슨한 보드) 선택지 검증은 생략된다(엔진 규약).
 */
export function validateCell(
  type: FieldType,
  raw: unknown,
  options?: FieldOption[] | null,
): CellValidation {
  const res = validateValue(type, raw, options ? { options } : undefined);
  if (!res.ok) return { ok: false, value: null, error: res.error };

  // This board adapter is the shared write consumer for both local fixtures
  // and the request-scoped Supabase repository. Normalize before persistence.
  if (type === "phone" && typeof res.normalized === "string") {
    const phone = analyzePhone(res.normalized);
    if (phone.status === "needs_review") {
      return { ok: false, value: null, error: "phone: 확인이 필요한 전화번호입니다" };
    }
    return { ok: true, value: phone.normalized || null };
  }

  if (type === "other_info") {
    return isOtherInfoValue(res.normalized)
      ? { ok: true, value: res.normalized }
      : { ok: false, value: null, error: "other_info: 저장 형식이 올바르지 않습니다" };
  }

  return { ok: true, value: toCellValue(res.normalized) };
}

/** 빈 셀 판정(필터 is_empty 등). 타입 무관 공통 규약. */
export function isEmptyCell(value: CellValue): boolean {
  return getFieldTypeSpec("text").isEmpty(value as never);
}

/**
 * 정렬/비교용 raw 스칼라. 문자열을 숫자로 추측하지 않는다.
 * 숫자 컬럼은 저장 경계(validateCell)에서 이미 number가 되어야 하며, 이 원칙이 식별 문자열의
 * 선행 0과 version/request id를 보존한다.
 */
export function comparableCell(value: CellValue): number | string {
  if (isOtherInfoValue(value)) return checkedOtherInfoCount(value);
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.join(",");
  return String(value ?? "");
}

/** 두 셀 비교(오름차순). 빈값은 뒤로. */
export function compareCells(a: CellValue, b: CellValue): number {
  const ae = isEmptyCell(a);
  const be = isEmptyCell(b);
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  const av = comparableCell(a);
  const bv = comparableCell(b);
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/** 화면 표시용 문자열(옵션 id → 라벨 치환). */
export function formatCell(
  type: FieldType,
  value: CellValue,
  options?: FieldOption[] | null,
): string {
  if (isEmptyCell(value)) return "";
  if (type === "other_info") return otherInfoCountLabel(value);
  if (type === "checkbox") return value ? "✓" : "";
  if (type === "number" && typeof value === "number") return formatDecimal(value);
  if (type === "money" && typeof value === "number") return formatDecimal(value);
  if (type === "phone" && typeof value === "string") return formatPhone(value);
  if (hasOptions(type) && options) {
    const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
    if (Array.isArray(value)) return value.map(label).join(", ");
    if (typeof value === "string") return label(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * 검색 소비자가 쓸 표시+raw 문자열. UI 필터 파일과 분리된 순수 seam이라 검색 UI가 바뀌어도
 * `1234`와 `1,234` 동등 계약을 독립 검증할 수 있다.
 */
export function cellSearchText(
  type: FieldType,
  value: CellValue,
  options?: FieldOption[] | null,
): string {
  if (type === "other_info") return otherInfoSearchText(value);
  const display = formatCell(type, value, options);
  if ((type === "number" || type === "money") && typeof value === "number") {
    const raw = canonicalNumberString(value);
    return raw === display ? raw : `${raw} ${display}`;
  }
  return display;
}
