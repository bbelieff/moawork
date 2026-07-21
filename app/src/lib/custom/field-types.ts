/**
 * 필드 타입 레지스트리 (T05 core.custom) — 엔진의 심장.
 *
 * 001_schema_v1.sql 의 `field_type` ENUM 13종 각각을 하나의 FieldTypeSpec 으로 규정한다.
 * 값 처리 전반(입력검증·저장·필터·정렬)이 이 레지스트리 한 곳을 참조한다.
 * 순수 모듈 — 영속성/프레임워크 의존 없음. 스키마(./domain-types)만 참조.
 */

import { FIELD_TYPES, type FieldType, type FieldOption } from "./domain-types";

/** value_jsonb 에 저장 가능한 JSON 값. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

/** 저장뷰 필터 연산자(T02 규약과 동일 집합). */
export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

export const FILTER_OPERATORS: readonly FilterOperator[] = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "is_not_empty",
];

/** 입력 검증 실패. API 라우트에서 400 으로 매핑. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** normalize 시 타입이 참조하는 문맥(select/multiselect 옵션 등). */
export interface NormalizeCtx {
  /** select/multiselect: 유효 옵션 목록(보통 field_def.options_jsonb.options). */
  options?: FieldOption[];
}

export interface FieldTypeSpec {
  type: FieldType;
  /** select/multiselect 만 true — options_jsonb 필요. */
  supportsOptions: boolean;
  /** 이 타입에 허용되는 필터 연산자. */
  operators: readonly FilterOperator[];
  /**
   * 원시 입력을 검증하고 value_jsonb 저장형으로 정규화.
   * 빈 값은 null(=빈 셀). 형식 오류는 ValidationError.
   */
  normalize(raw: unknown, ctx?: NormalizeCtx): JsonValue | null;
  /** 빈 값 판정(is_empty 필터 / 필수검사). */
  isEmpty(v: JsonValue | null): boolean;
  /** 필터·정렬용 스칼라 투영. */
  comparable(v: JsonValue | null): number | string;
}

// ── 공용 헬퍼 ───────────────────────────────────────────────

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** 기본 빈 값 판정: null/undefined/빈문자열/빈배열. */
function emptyDefault(v: JsonValue | null): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** 기본 비교 투영(T02 views.ts 규약과 호환). */
function comparableDefault(v: JsonValue | null): number | string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(",");
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : s;
}

function asString(raw: unknown, field: string, max: number): string | null {
  if (isBlank(raw)) return null;
  if (typeof raw !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return t;
}

const TEXT_OPS: readonly FilterOperator[] = [
  "eq",
  "neq",
  "contains",
  "is_empty",
  "is_not_empty",
];
const NUM_OPS: readonly FilterOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "is_not_empty",
];
const SET_OPS: readonly FilterOperator[] = ["eq", "neq", "is_empty", "is_not_empty"];

// ── 타입별 스펙 ─────────────────────────────────────────────

function textSpec(type: FieldType, max: number): FieldTypeSpec {
  return {
    type,
    supportsOptions: false,
    operators: TEXT_OPS,
    normalize: (raw) => asString(raw, type, max),
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  };
}

/** 옵션 id 멤버십 검증(옵션 목록이 주어졌을 때만 — 없으면 관용적으로 통과). */
function assertOption(id: string, ctx: NormalizeCtx | undefined): void {
  const options = ctx?.options ?? [];
  if (options.length === 0) return; // 옵션 미주입 시 검증 생략(service 가 주입 책임)
  const ok = options.some((o) => o.id === id && !o.archived);
  if (!ok) throw new ValidationError(`select: 선택지에 없거나 보관된 옵션입니다(${id})`);
}

const SPECS: Record<FieldType, FieldTypeSpec> = {
  text: textSpec("text", 500),
  longtext: textSpec("longtext", 20000),
  phone: {
    type: "phone",
    supportsOptions: false,
    operators: TEXT_OPS,
    normalize: (raw) => {
      const s = asString(raw, "phone", 40);
      if (s === null) return null;
      if (!/^[0-9+()\-.\s]+$/.test(s)) throw new ValidationError("phone: 전화번호 형식이 아닙니다");
      return s;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  email: {
    type: "email",
    supportsOptions: false,
    operators: TEXT_OPS,
    normalize: (raw) => {
      const s = asString(raw, "email", 200);
      if (s === null) return null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        throw new ValidationError("email: 이메일 형식이 아닙니다");
      return s.toLowerCase();
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  url: {
    type: "url",
    supportsOptions: false,
    operators: TEXT_OPS,
    normalize: (raw) => {
      const s = asString(raw, "url", 2000);
      if (s === null) return null;
      if (!/^https?:\/\/\S+$/i.test(s))
        throw new ValidationError("url: http(s):// 로 시작해야 합니다");
      return s;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  number: {
    type: "number",
    supportsOptions: false,
    operators: NUM_OPS,
    normalize: (raw) => {
      if (isBlank(raw)) return null;
      if (typeof raw !== "number" && typeof raw !== "string")
        throw new ValidationError("number: 숫자여야 합니다");
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new ValidationError("number: 유효한 숫자가 아닙니다");
      return n;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  checkbox: {
    type: "checkbox",
    supportsOptions: false,
    operators: ["eq", "neq"],
    normalize: (raw) => {
      if (raw === null || raw === undefined || raw === "") return null;
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new ValidationError("checkbox: 불리언이어야 합니다");
    },
    isEmpty: (v) => v === null || v === undefined,
    comparable: comparableDefault,
  },
  date: {
    type: "date",
    supportsOptions: false,
    operators: NUM_OPS,
    normalize: (raw) => {
      const s = asString(raw, "date", 10);
      if (s === null) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw new ValidationError("date: YYYY-MM-DD 형식이어야 합니다");
      const d = new Date(`${s}T00:00:00Z`);
      // 재확인(달력상 유효 + 정규화 후 동일).
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
        throw new ValidationError("date: 존재하지 않는 날짜입니다");
      return s;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  datetime: {
    type: "datetime",
    supportsOptions: false,
    operators: NUM_OPS,
    normalize: (raw) => {
      const s = asString(raw, "datetime", 40);
      if (s === null) return null;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) throw new ValidationError("datetime: 유효한 일시가 아닙니다");
      return d.toISOString();
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  select: {
    type: "select",
    supportsOptions: true,
    operators: SET_OPS,
    normalize: (raw, ctx) => {
      if (isBlank(raw)) return null;
      if (typeof raw !== "string") throw new ValidationError("select: 옵션 id(문자열)여야 합니다");
      assertOption(raw, ctx);
      return raw;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  multiselect: {
    type: "multiselect",
    supportsOptions: true,
    operators: ["contains", "is_empty", "is_not_empty"],
    normalize: (raw, ctx) => {
      if (raw === null || raw === undefined || raw === "") return null;
      if (!Array.isArray(raw)) throw new ValidationError("multiselect: 옵션 id 배열이어야 합니다");
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string")
          throw new ValidationError("multiselect: 각 항목은 옵션 id(문자열)여야 합니다");
        if (seen.has(item)) continue; // 중복 제거
        assertOption(item, ctx);
        seen.add(item);
        out.push(item);
      }
      return out.length === 0 ? null : out;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  person: {
    type: "person",
    supportsOptions: false,
    operators: ["eq", "neq", "contains", "is_empty", "is_not_empty"],
    // 멤버십 검증(user.id 가 org 멤버인지)은 T03 연동 후. 지금은 형식만.
    normalize: (raw) => {
      if (raw === null || raw === undefined || raw === "") return null;
      if (Array.isArray(raw)) {
        const out = raw.filter((x): x is string => typeof x === "string" && x !== "");
        return out.length === 0 ? null : out;
      }
      if (typeof raw !== "string") throw new ValidationError("person: user id 여야 합니다");
      return raw;
    },
    isEmpty: emptyDefault,
    comparable: comparableDefault,
  },
  file: {
    type: "file",
    supportsOptions: false,
    operators: ["is_empty", "is_not_empty"],
    // 실제 업로드/서명 URL 은 core.files(T04). 여기선 Storage 참조 배열 형태만 검증.
    normalize: (raw) => {
      if (raw === null || raw === undefined || raw === "") return null;
      if (!Array.isArray(raw)) throw new ValidationError("file: 첨부 배열이어야 합니다");
      const out: JsonValue[] = [];
      for (const f of raw) {
        if (typeof f !== "object" || f === null || Array.isArray(f))
          throw new ValidationError("file: 각 첨부는 객체여야 합니다");
        const rec = f as Record<string, unknown>;
        if (typeof rec.path !== "string" || rec.path === "")
          throw new ValidationError("file: path 가 필요합니다");
        out.push({
          path: rec.path,
          name: typeof rec.name === "string" ? rec.name : rec.path,
          size: typeof rec.size === "number" ? rec.size : 0,
          mime: typeof rec.mime === "string" ? rec.mime : "application/octet-stream",
        });
      }
      return out.length === 0 ? null : out;
    },
    isEmpty: emptyDefault,
    comparable: (v) => (Array.isArray(v) ? v.length : comparableDefault(v)),
  },
};

// ── 비-throw 검증 계약 (기획2 판정 2026-07-21) ───────────────

/**
 * 검증 결과. **엔진은 던지지 않고 결과를 반환**하고, 던질지 흘릴지는 호출부(정책)가 정한다.
 * - 기본 정책 = 관대 + 인라인 피드백(먼데이 파리티): 틀린 값은 저장하지 않고 `error` 를 화면에 표시.
 * - ⛔ 조용히 null 로 수렴시키지 말 것(데이터 유실).
 * - 예외적 엄격 = 무결성 필드(§`INTEGRITY_FIELD_KEYS`)만 하드 거부.
 */
export interface ValidationResult {
  ok: boolean;
  /** ok=true 일 때만 의미 있는 저장값. 실패 시 null(저장하지 말 것). */
  normalized: JsonValue | null;
  /** ok=false 일 때 사용자에게 보여줄 사유. */
  error?: string;
}

/**
 * 값 검증 — 던지지 않는다. 공개 진입점.
 * (내부적으로는 타입 스펙의 normalize 를 쓰고 예외를 결과로 변환한다.)
 */
export function validateValue(
  type: FieldType,
  raw: unknown,
  ctx?: NormalizeCtx,
): ValidationResult {
  try {
    return { ok: true, normalized: getFieldTypeSpec(type).normalize(raw, ctx) };
  } catch (err) {
    return {
      ok: false,
      normalized: null,
      error: err instanceof Error ? err.message : "값을 해석할 수 없습니다",
    };
  }
}

/**
 * 무결성 필드 key — 정산 generated column(fee_amount/total_revenue/d180/d365)이
 * 이 값들에 의존하므로 **틀린 값을 흘리면 조용히 잘못된 금액·일자가 산출**된다.
 * 따라서 이 필드만 관대 정책의 예외로 하드 거부한다(기획2 판정).
 * 값 출처: `lib/presets/policyfund.ts` 프리셋 키.
 */
export const INTEGRITY_FIELD_KEYS: ReadonlySet<string> = new Set([
  "exec_amount", // 실행액
  "fee_pct", // 수수료(%)
  "fee_paid_at", // 수수료 입금일 — D+180/365 기산일
]);

export function isIntegrityField(fieldKey: string): boolean {
  return INTEGRITY_FIELD_KEYS.has(fieldKey);
}

/** 타입 스펙 조회. 미지원 타입은 예외. */
export function getFieldTypeSpec(type: FieldType): FieldTypeSpec {
  const spec = SPECS[type];
  if (!spec) throw new ValidationError(`알 수 없는 필드 타입: ${type}`);
  return spec;
}

/** 값 정규화 단축 헬퍼. */
export function normalizeValue(
  type: FieldType,
  raw: unknown,
  ctx?: NormalizeCtx,
): JsonValue | null {
  return getFieldTypeSpec(type).normalize(raw, ctx);
}

/** 문자열이 유효한 field_type 인지. */
export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

/** 해당 타입에서 연산자가 허용되는지. */
export function operatorAllowed(type: FieldType, op: FilterOperator): boolean {
  return getFieldTypeSpec(type).operators.includes(op);
}
