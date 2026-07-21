/**
 * 임의 보드 입력 검증 (T02b). 의존성 없는 경량 검증기.
 */

import { FIELD_TYPES, type FieldOption, type FieldType } from "@/lib/types";
import { BOARD_VIEW_KINDS, type BoardViewKind, type CellValue } from "./types";
import type { NewBoard, NewColumn, NewGroup, NewItem } from "./store";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(v: unknown, field: string, max = 300): string {
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  const t = v.trim();
  if (t === "") throw new ValidationError(`${field}: 비어 있을 수 없습니다`);
  if (t.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return t;
}

function optString(v: unknown, field: string, max = 1000): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  if (v.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return v;
}

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

export function isBoardViewKind(v: unknown): v is BoardViewKind {
  return typeof v === "string" && (BOARD_VIEW_KINDS as readonly string[]).includes(v);
}

export function parseNewBoard(body: unknown): NewBoard {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return {
    name: reqString(body.name, "name", 100),
    description: optString(body.description, "description"),
    icon: optString(body.icon, "icon", 16),
  };
}

function parseOptions(v: unknown): FieldOption[] {
  if (!Array.isArray(v)) throw new ValidationError("options: 배열이어야 합니다");
  return v.map((raw, i) => {
    if (!isObject(raw)) throw new ValidationError(`options[${i}]: 객체여야 합니다`);
    const label = reqString(raw.label, `options[${i}].label`, 100);
    // id 는 저장값의 안정성 근거 — 없으면 파생 생성(라벨 변경돼도 값 유지).
    const id = typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : `opt-${i + 1}-${Date.now().toString(36)}`;
    const opt: FieldOption = { id, label };
    if (typeof raw.color === "string") opt.color = raw.color;
    opt.order = typeof raw.order === "number" ? raw.order : i;
    return opt;
  });
}

export function parseNewColumn(body: unknown): NewColumn {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const label = reqString(body.label, "label", 100);
  if (!isFieldType(body.type))
    throw new ValidationError(`type: 지원하지 않는 필드 타입입니다(13종 중 하나)`);
  const type = body.type;
  const col: NewColumn = { label, type };
  if (typeof body.key === "string" && body.key.trim() !== "") col.key = body.key.trim();
  if (body.options !== undefined && body.options !== null) {
    col.options = parseOptions(body.options);
  }
  if (type === "select" || type === "multiselect") {
    if (!col.options || col.options.length === 0)
      throw new ValidationError("select/multiselect 컬럼은 선택지가 1개 이상 필요합니다");
  }
  if (body.width !== undefined && body.width !== null) {
    const w = Number(body.width);
    if (!Number.isFinite(w)) throw new ValidationError("width: 숫자여야 합니다");
    col.width = w;
  }
  return col;
}

export function parseNewGroup(body: unknown): NewGroup {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return {
    name: reqString(body.name, "name", 100),
    color: optString(body.color, "color", 32),
  };
}

/** 셀 값 원시 입력(정규화는 service 가 컬럼 타입으로 수행). */
export function parseCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => String(x));
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v as CellValue;
  throw new ValidationError("값: 지원하지 않는 형식입니다");
}

export function parseValuesMap(v: unknown): Record<string, CellValue> {
  if (!isObject(v)) throw new ValidationError("values: 객체여야 합니다");
  const out: Record<string, CellValue> = {};
  for (const [k, raw] of Object.entries(v)) out[k] = parseCellValue(raw);
  return out;
}

export function parseNewItem(body: unknown): NewItem {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const item: NewItem = { title: reqString(body.title, "title", 300) };
  if (body.group_id !== undefined) item.group_id = optString(body.group_id, "group_id", 64);
  if (body.assigned_to !== undefined)
    item.assigned_to = optString(body.assigned_to, "assigned_to", 64);
  if (body.values !== undefined) item.values = parseValuesMap(body.values);
  return item;
}
