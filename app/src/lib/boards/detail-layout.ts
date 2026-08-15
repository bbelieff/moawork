import type { CellValue } from "./types";
import type { FieldType } from "@/lib/types";

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

export function detailKeyFromLabel(label: string): string {
  const base = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "");
  return `detail_${base || "field"}`.slice(0, 80);
}
