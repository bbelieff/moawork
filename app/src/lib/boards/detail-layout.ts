import type { BoardColumn, CellValue } from "./types";
import type { FieldType } from "@/lib/types";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";

export type DetailLayoutSource = "column" | "detail";

export interface DetailLayoutEntry {
  key: string;
  source: DetailLayoutSource;
  /** 060의 validator는 부가 metadata를 허용한다. 상세 전용 필드는 여기서 이름과 타입을 보존한다. */
  label?: string;
  type?: FieldType;
}

const SAFE_KEY = /^[\p{L}\p{N}_-]{1,80}$/u;

export function normalizeDetailLayout(value: unknown): DetailLayoutEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: DetailLayoutEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const source = row.source === "column" || row.source === "detail" ? row.source : null;
    if (!source || !SAFE_KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      source,
      ...(typeof row.label === "string" && row.label.trim() ? { label: row.label.trim().slice(0, 120) } : {}),
      ...(typeof row.type === "string" ? { type: row.type as FieldType } : {}),
    });
  }
  return result;
}

/**
 * Canonical 신규리드 보드는 설치된 활성 컬럼 자체가 제품 기본 상세 배치다.
 * DB의 역사적 기본값 `[]`만으로는 "아직 초기화되지 않음"과 "사용자가 비움"을
 * 구분할 수 없으므로 이 fallback은 canonical source에만 한정한다. 임의 보드의
 * 빈 배열은 BBE-107 계약대로 계속 의도적인 빈 배치다.
 */
export function resolveBoardDetailLayout(
  boardSource: string | null,
  boardLayout: unknown,
  activeColumns: readonly BoardColumn[],
): DetailLayoutEntry[] {
  const normalized = normalizeDetailLayout(boardLayout);
  if (boardSource !== NEW_LEAD_TAB_SOURCE || normalized.length > 0) return normalized;
  return activeColumns.map((column) => ({
    key: column.key,
    source: "column",
    label: column.label,
    type: column.type,
  }));
}

/** null/undefined인 그룹만 보드 기본을 상속한다. []는 의도적인 빈 오버라이드다. */
export function resolveDetailLayout(
  boardLayout: unknown,
  groupLayout: unknown,
): { entries: DetailLayoutEntry[]; inherited: boolean } {
  if (groupLayout === null || groupLayout === undefined) {
    return { entries: normalizeDetailLayout(boardLayout), inherited: true };
  }
  return { entries: normalizeDetailLayout(groupLayout), inherited: false };
}

export function moveDetailEntry(
  entries: readonly DetailLayoutEntry[],
  key: string,
  direction: -1 | 1,
): DetailLayoutEntry[] {
  const next = normalizeDetailLayout(entries);
  const from = next.findIndex((entry) => entry.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function unplacedDetailKeys(
  values: Readonly<Record<string, CellValue>>,
  entries: readonly DetailLayoutEntry[],
): string[] {
  const placed = new Set(entries.map((entry) => entry.key));
  return Object.entries(values)
    .filter(([key, value]) => !placed.has(key) && value !== null && value !== "")
    .map(([key]) => key)
    .sort();
}

/**
 * 상세 전용 필드로 «태어난» 칸의 key 접두 (#657).
 *
 * ★ 이게 「표에서 내리기」의 경계다. 표로 올린 것을 되돌릴 수 있어야 하지만,
 *   원래부터 표 컬럼이던 것(owner·industry …)까지 내리면 그건 구조 축소다.
 *   표에서 잠깐 감추는 일은 「표시 컬럼」이 이미 한다 — 그쪽은 값을 안 건드린다.
 */
export const DETAIL_FIELD_KEY_PREFIX = "detail_";

export function detailKeyFromLabel(label: string): string {
  const base = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "");
  return `${DETAIL_FIELD_KEY_PREFIX}${base || "field"}`.slice(0, 80);
}

/** 표로 올렸다가 «다시 내릴 수 있는» 칸인가. */
export function isDemotableDetailKey(key: string): boolean {
  return key.startsWith(DETAIL_FIELD_KEY_PREFIX);
}
