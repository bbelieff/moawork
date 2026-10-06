import type { BoardColumn, CellValue } from "./types";
import type { FieldType } from "@/lib/types";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { workflowDetailHiddenKeys, workflowKindForSource } from "@/lib/workflow/progress";

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
 * 기본 탭 보드(신규리드·계약업체 실무)는 설치된 활성 컬럼 자체가 제품 기본 상세 배치다.
 * DB의 역사적 기본값 `[]`만으로는 "아직 초기화되지 않음"과 "사용자가 비움"을
 * 구분할 수 없으므로 이 fallback은 아래 canonical source에만 한정한다. 임의 보드의
 * 빈 배열은 BBE-107 계약대로 계속 의도적인 빈 배치다.
 *
 * ★ 진행현황 원본 키(단계·옛 이동 컬럼)는 fallback에서 뺀다. 화면은 이 칸들을
 *   진행현황 하나로만 보여 주는데, 서버 호출부(배치 저장·상세 필드 추가)는 숨기기 전
 *   전체 컬럼을 넘긴다. 여기서 같이 거르지 않으면 관리자가 처음 저장하는 순간 원본
 *   단계 칸이 배치에 박제되어 모든 상세 화면에 날것으로 드러난다 (2026-10-06).
 */
const COLUMN_FALLBACK_SOURCES: ReadonlySet<string> = new Set([
  NEW_LEAD_TAB_SOURCE,
  CONTRACT_WORK_TAB_SOURCE,
]);

/**
 * 구성원 칸(담당자 `person` · 여러 명 `people`). 값은 구성원 id 다.
 *
 * ★ 상세의 일반 자동저장 입력은 글자를 그대로 저장한다. 이 칸이 거기로 가면 담당자 자리에
 *   구성원 id 가 날것으로 보이고, 이름·오타가 그대로 담당자로 박제된다 — 표의 담당자 선택·
 *   담당자 필터·업체관리 현황이 모두 이 칸을 읽는다 (2026-10-06 검토 P1).
 */
export function isMemberFieldType(type: string | null | undefined): boolean {
  return type === "person" || type === "people";
}

export function resolveBoardDetailLayout(
  boardSource: string | null,
  boardLayout: unknown,
  activeColumns: readonly BoardColumn[],
): DetailLayoutEntry[] {
  const normalized = normalizeDetailLayout(boardLayout);
  if (!boardSource || !COLUMN_FALLBACK_SOURCES.has(boardSource) || normalized.length > 0) {
    return normalized;
  }
  const kind = workflowKindForSource(boardSource);
  const hidden: ReadonlySet<string> = kind ? workflowDetailHiddenKeys(kind) : new Set();
  // 신규리드 상세에는 담당자 전용 편집기(「담당자 흐름」)가 있다. 그 밖의 기본 탭은 담당자를
  // 연관담당 줄의 「담당자」로 이미 보여 주므로, 기본 배치의 회사 정보에 구성원 칸을 넣지 않는다.
  const keepMemberColumns = boardSource === NEW_LEAD_TAB_SOURCE;
  return activeColumns
    .filter((column) => !hidden.has(column.key))
    .filter((column) => keepMemberColumns || !isMemberFieldType(column.type))
    .map((column) => ({
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

/**
 * 한 행의 상세 배치 — «그 행이 실제로 속한 그룹» 으로 푼다 (#654).
 *
 * ★ 상세 패널의 추가·저장 폼은 `row.group_id` 로 쓴다. 그러니 읽기도 `row.group_id` 여야 한다.
 *   상담 단계 보기처럼 행을 «가상 묶음» 으로 다시 묶는 화면은 묶음에 물리 그룹이 없어서
 *   (block.group === null) 보드 기본 배치를 읽고 있었다. 그러면 그룹 배치에 저장된 필드는
 *   DB 에는 있는데 그 화면에서는 영영 안 보인다 — 「추가」를 눌러도 아무 일도 없는 것처럼 보인다.
 */
export function resolveRowDetailLayout(
  boardLayout: unknown,
  groups: readonly { id: string; detail_layout_jsonb?: unknown }[],
  groupId: string | null | undefined,
): { entries: DetailLayoutEntry[]; inherited: boolean } {
  const group = groupId ? groups.find((candidate) => candidate.id === groupId) : undefined;
  return resolveDetailLayout(boardLayout, group?.detail_layout_jsonb);
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
