/**
 * 셀 값 처리 (T02b) — 001 field_type 13종에 대한 정규화·판정·비교.
 * item_values.value_jsonb 에 저장되기 전/후로 이 함수들을 통과한다.
 *
 * 참고: T05(core.custom)가 `lib/custom/field-types.ts` 에 동일 성격의 레지스트리를
 * 보유. 두 모듈이 각자 브랜치에서 병행 개발 중이라 지금은 독립 구현하고,
 * 머지 정착 후 공용화한다(followup).
 */

import type { FieldOption, FieldType } from "@/lib/types";
import type { CellValue } from "./types";

/** 선택지를 갖는 타입. */
export function hasOptions(type: FieldType): boolean {
  return type === "select" || type === "multiselect";
}

function toTrimmedOrNull(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v);
  const t = v.trim();
  return t === "" ? null : t;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 원시 입력을 컬럼 타입에 맞는 저장값으로 정규화.
 * 파싱 불가·빈값은 null(멀티셀렉트는 [], 체크박스는 false)로 수렴한다.
 */
export function normalizeCellValue(type: FieldType, raw: unknown): CellValue {
  switch (type) {
    case "checkbox":
      return raw === true || raw === "true" || raw === 1;

    case "number": {
      if (raw === null || raw === undefined || raw === "") return null;
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s₩]/g, ""));
      return Number.isFinite(n) ? n : null;
    }

    case "date": {
      const s = toTrimmedOrNull(raw);
      if (s === null) return null;
      if (DATE_RE.test(s)) return s;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }

    case "datetime": {
      const s = toTrimmedOrNull(raw);
      if (s === null) return null;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    case "multiselect": {
      if (raw === null || raw === undefined || raw === "") return [];
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.map((x) => String(x)).filter((x) => x !== "");
    }

    // text · longtext · select · phone · email · url · file · person
    default:
      return toTrimmedOrNull(raw);
  }
}

/** 빈 셀 판정(필터 is_empty 등). */
export function isEmptyCell(value: CellValue): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * 선택지 검증 — select 는 옵션 id 하나, multiselect 는 부분집합이어야 한다.
 * 옵션 정의가 없으면(느슨한 보드) 통과시킨다.
 */
export function validateAgainstOptions(
  type: FieldType,
  value: CellValue,
  options: FieldOption[] | null | undefined,
): boolean {
  if (!hasOptions(type) || !options || options.length === 0) return true;
  const ids = new Set(options.map((o) => o.id));
  if (type === "select") return value === null || (typeof value === "string" && ids.has(value));
  if (Array.isArray(value)) return value.every((v) => ids.has(v));
  return isEmptyCell(value);
}

/** 정렬/비교용 스칼라. 빈값은 항상 뒤로 가도록 호출측에서 처리. */
export function comparableCell(value: CellValue): number | string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.join(",");
  return value;
}

/**
 * 두 셀 비교(오름차순). 빈값은 뒤로.
 */
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
  if (type === "checkbox") return value ? "✓" : "";
  if (hasOptions(type) && options) {
    const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
    if (Array.isArray(value)) return value.map(label).join(", ");
    if (typeof value === "string") return label(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
