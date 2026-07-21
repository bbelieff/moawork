/**
 * 입력 검증/파싱 (T05 core.custom). 의존성 없는 경량 파서.
 * API 라우트에서 요청 바디를 도메인 입력으로 좁힌다(T02 validation.ts 규약).
 */

import { FIELD_ENTITIES, type FieldEntity } from "./domain-types";
import {
  FILTER_OPERATORS,
  ValidationError,
  isFieldType,
  operatorAllowed,
  type FilterOperator,
  type JsonValue,
} from "./field-types";
import type { NewFieldDef } from "./store";
import type { ViewConfig, ViewFilter, ViewSort } from "./views";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  const t = v.trim();
  if (t === "") throw new ValidationError(`${field}: 비어 있을 수 없습니다`);
  if (t.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return t;
}

function parseEntity(v: unknown): FieldEntity {
  if (typeof v !== "string" || !(FIELD_ENTITIES as readonly string[]).includes(v))
    throw new ValidationError(`entity: ${FIELD_ENTITIES.join("|")} 중 하나여야 합니다`);
  return v as FieldEntity;
}

/** 코어 컬럼과 충돌하면 안 되는 예약 key. */
const RESERVED_KEYS = new Set([
  "id",
  "org_id",
  "title",
  "name",
  "amount",
  "stage",
  "stage_id",
  "status_note",
  "applied_on",
  "created_at",
  "updated_at",
  "custom",
  "__stage__",
]);

/**
 * label → key slug 파생. 유니코드 문자/숫자 보존(한국어 라벨 지원 — 이 프로젝트 기본).
 * 예: "진행 상태" → "진행_상태", "Deal Stage" → "deal_stage".
 * 문자·숫자가 하나도 없으면(기호/이모지만) 예외.
 */
export function deriveKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (slug === "") throw new ValidationError("label 에서 key 를 만들 수 없습니다(문자/숫자 필요)");
  return slug;
}

/** 기존 key 목록과 충돌 없는 유니크 key 생성(예약어 회피 + _2, _3…). */
export function uniqueKey(label: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = deriveKey(label);
  let candidate = base;
  let n = 2;
  while (taken.has(candidate) || RESERVED_KEYS.has(candidate)) {
    candidate = `${base}_${n++}`;
  }
  return candidate;
}

export interface CreateFieldDefInput {
  entity: FieldEntity;
  label: string;
  type: NewFieldDef["type"];
  /** 정본 key 명시(프리셋·알려진 필드). 생략 시 label 에서 파생. */
  key?: string;
  /** select/multiselect 초기 라벨(옵션 id 는 서비스가 발급). */
  optionLabels?: string[];
}

/** 필드 정의 생성 요청 파싱(key/옵션 id 발급은 서비스가 수행). */
export function parseCreateFieldDef(body: unknown): CreateFieldDefInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const entity = parseEntity(body.entity);
  const label = requireString(body.label, "label");
  if (!isFieldType(body.type)) throw new ValidationError("type: 지원하지 않는 필드 타입입니다");
  const out: CreateFieldDefInput = { entity, label, type: body.type };
  // 한글 라벨을 조회 key 로 쓰지 않도록, 알려진 필드는 정본 key 를 명시할 수 있다.
  if (body.key !== undefined) out.key = requireString(body.key, "key", 100);
  if (body.optionLabels !== undefined) {
    if (!Array.isArray(body.optionLabels))
      throw new ValidationError("optionLabels: 배열이어야 합니다");
    out.optionLabels = body.optionLabels.map((l, i) => requireString(l, `optionLabels[${i}]`));
  }
  return out;
}

export interface UpdateFieldDefInput {
  label?: string;
}

export function parseUpdateFieldDef(body: unknown): UpdateFieldDefInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const out: UpdateFieldDefInput = {};
  if (body.label !== undefined) out.label = requireString(body.label, "label");
  if (Object.keys(out).length === 0) throw new ValidationError("변경할 필드가 없습니다");
  return out;
}

/** 값 맵 파싱(정규화는 서비스가 각 필드 타입 스펙으로 수행). */
export function parseValuesPatch(body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const values = isObject(body.values) ? body.values : body;
  return { ...values };
}

// ── 저장뷰 ─────────────────────────────────────────────────

function parseFilter(v: unknown, i: number): ViewFilter {
  if (!isObject(v)) throw new ValidationError(`filters[${i}]: 객체여야 합니다`);
  const fieldKey = requireString(v.fieldKey, `filters[${i}].fieldKey`);
  if (typeof v.operator !== "string" || !FILTER_OPERATORS.includes(v.operator as FilterOperator))
    throw new ValidationError(`filters[${i}].operator: 지원하지 않는 연산자`);
  const f: ViewFilter = { fieldKey, operator: v.operator as FilterOperator };
  if (v.value !== undefined) f.value = v.value as JsonValue;
  return f;
}

function parseSort(v: unknown, i: number): ViewSort {
  if (!isObject(v)) throw new ValidationError(`sorts[${i}]: 객체여야 합니다`);
  const fieldKey = requireString(v.fieldKey, `sorts[${i}].fieldKey`);
  if (v.direction !== "asc" && v.direction !== "desc")
    throw new ValidationError(`sorts[${i}].direction: asc|desc`);
  return { fieldKey, direction: v.direction };
}

export function parseViewConfig(v: unknown): ViewConfig {
  if (!isObject(v)) throw new ValidationError("config: 객체여야 합니다");
  const filtersRaw = v.filters ?? [];
  const sortsRaw = v.sorts ?? [];
  const columnsRaw = v.columns ?? [];
  if (!Array.isArray(filtersRaw)) throw new ValidationError("config.filters: 배열이어야 합니다");
  if (!Array.isArray(sortsRaw)) throw new ValidationError("config.sorts: 배열이어야 합니다");
  if (!Array.isArray(columnsRaw)) throw new ValidationError("config.columns: 배열이어야 합니다");
  return {
    filters: filtersRaw.map(parseFilter),
    sorts: sortsRaw.map(parseSort),
    columns: columnsRaw.map((c, i) => requireString(c, `config.columns[${i}]`, 100)),
  };
}

export interface CreateViewInput {
  entity: FieldEntity;
  name: string;
  config: ViewConfig;
  shared: boolean;
}

export function parseCreateView(body: unknown): CreateViewInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return {
    entity: parseEntity(body.entity),
    name: requireString(body.name, "name"),
    config: parseViewConfig(body.config ?? {}),
    shared: body.shared === true,
  };
}

/** 필터의 연산자가 필드 타입에 맞는지 확인(타입 조회 함수 주입). */
export function assertFilterOperators(
  config: ViewConfig,
  typeOf: (fieldKey: string) => NewFieldDef["type"] | undefined,
): void {
  for (const f of config.filters) {
    const t = typeOf(f.fieldKey);
    if (t && !operatorAllowed(t, f.operator))
      throw new ValidationError(`filters: ${t} 타입에 ${f.operator} 연산자는 허용되지 않습니다`);
  }
}
