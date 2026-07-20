/**
 * 입력 검증 (T02). 의존성 없는 경량 검증기.
 * API 라우트에서 요청 바디를 도메인 입력으로 좁힌다.
 */

import type { CellValue, ColumnType, ViewConfig, ViewFilter, ViewSort } from "./types";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, field: string, { max = 500 } = {}): string {
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  const trimmed = v.trim();
  if (trimmed === "") throw new ValidationError(`${field}: 비어 있을 수 없습니다`);
  if (trimmed.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return trimmed;
}

function optionalString(v: unknown, field: string, { max = 2000 } = {}): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  if (v.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return v;
}

export interface CreateBoardInput {
  name: string;
  description?: string;
}

export function parseCreateBoard(body: unknown): CreateBoardInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return {
    name: requireString(body.name, "name", { max: 200 }),
    description: optionalString(body.description, "description"),
  };
}

export interface UpdateBoardInput {
  name?: string;
  description?: string;
  archived?: boolean;
}

export function parseUpdateBoard(body: unknown): UpdateBoardInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const out: UpdateBoardInput = {};
  if (body.name !== undefined) out.name = requireString(body.name, "name", { max: 200 });
  if (body.description !== undefined)
    out.description = optionalString(body.description, "description");
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean")
      throw new ValidationError("archived: 불리언이어야 합니다");
    out.archived = body.archived;
  }
  if (Object.keys(out).length === 0) throw new ValidationError("변경할 필드가 없습니다");
  return out;
}

const COLUMN_TYPES: ColumnType[] = ["text", "number", "date", "status", "people", "formula"];

/** 셀 값 검증 — 타입만 대략 확인(도메인 유연성 유지). */
export function parseCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v as CellValue;
  if (isObject(v)) return v as CellValue;
  throw new ValidationError("값: 지원하지 않는 형식입니다");
}

export interface CreateItemInput {
  name: string;
  stageKey?: string;
  values?: Record<string, CellValue>;
}

export function parseCreateItem(body: unknown): CreateItemInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const out: CreateItemInput = {
    name: requireString(body.name, "name", { max: 500 }),
  };
  if (body.stageKey !== undefined) out.stageKey = requireString(body.stageKey, "stageKey");
  if (body.values !== undefined) out.values = parseValuesMap(body.values);
  return out;
}

export interface UpdateItemInput {
  name?: string;
  values?: Record<string, CellValue>;
}

export function parseUpdateItem(body: unknown): UpdateItemInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const out: UpdateItemInput = {};
  if (body.name !== undefined) out.name = requireString(body.name, "name", { max: 500 });
  if (body.values !== undefined) out.values = parseValuesMap(body.values);
  if (Object.keys(out).length === 0) throw new ValidationError("변경할 필드가 없습니다");
  return out;
}

export function parseValuesMap(v: unknown): Record<string, CellValue> {
  if (!isObject(v)) throw new ValidationError("values: 객체여야 합니다");
  const out: Record<string, CellValue> = {};
  for (const [k, raw] of Object.entries(v)) out[k] = parseCellValue(raw);
  return out;
}

export interface MoveStageInput {
  stageKey: string;
}

export function parseMoveStage(body: unknown): MoveStageInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return { stageKey: requireString(body.stageKey, "stageKey") };
}

// ── 저장뷰 ─────────────────────────────────────────────

const FILTER_OPS = new Set([
  "eq", "neq", "contains", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty",
]);

function parseFilter(v: unknown, i: number): ViewFilter {
  if (!isObject(v)) throw new ValidationError(`filters[${i}]: 객체여야 합니다`);
  const columnKey = requireString(v.columnKey, `filters[${i}].columnKey`);
  if (typeof v.operator !== "string" || !FILTER_OPS.has(v.operator))
    throw new ValidationError(`filters[${i}].operator: 지원하지 않는 연산자`);
  const filter: ViewFilter = { columnKey, operator: v.operator as ViewFilter["operator"] };
  if (v.value !== undefined) filter.value = parseCellValue(v.value);
  return filter;
}

function parseSort(v: unknown, i: number): ViewSort {
  if (!isObject(v)) throw new ValidationError(`sorts[${i}]: 객체여야 합니다`);
  const columnKey = requireString(v.columnKey, `sorts[${i}].columnKey`);
  if (v.direction !== "asc" && v.direction !== "desc")
    throw new ValidationError(`sorts[${i}].direction: asc|desc`);
  return { columnKey, direction: v.direction };
}

export function parseViewConfig(v: unknown): ViewConfig {
  if (!isObject(v)) throw new ValidationError("config: 객체여야 합니다");
  const filtersRaw = v.filters ?? [];
  const sortsRaw = v.sorts ?? [];
  if (!Array.isArray(filtersRaw)) throw new ValidationError("config.filters: 배열이어야 합니다");
  if (!Array.isArray(sortsRaw)) throw new ValidationError("config.sorts: 배열이어야 합니다");
  const config: ViewConfig = {
    filters: filtersRaw.map(parseFilter),
    sorts: sortsRaw.map(parseSort),
  };
  if (v.visibleColumns !== undefined) {
    if (!Array.isArray(v.visibleColumns) || !v.visibleColumns.every((c) => typeof c === "string"))
      throw new ValidationError("config.visibleColumns: 문자열 배열이어야 합니다");
    config.visibleColumns = v.visibleColumns as string[];
  }
  return config;
}

export interface CreateViewInput {
  name: string;
  config: ViewConfig;
  isDefault?: boolean;
}

export function parseCreateView(body: unknown): CreateViewInput {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const out: CreateViewInput = {
    name: requireString(body.name, "name", { max: 200 }),
    config: parseViewConfig(body.config ?? {}),
  };
  if (body.isDefault !== undefined) {
    if (typeof body.isDefault !== "boolean")
      throw new ValidationError("isDefault: 불리언이어야 합니다");
    out.isDefault = body.isDefault;
  }
  return out;
}

/** 컬럼 타입 유효성(외부에서 컬럼 정의 받을 때). */
export function isColumnType(v: unknown): v is ColumnType {
  return typeof v === "string" && (COLUMN_TYPES as string[]).includes(v);
}
