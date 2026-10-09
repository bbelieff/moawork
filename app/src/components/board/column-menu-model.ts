/**
 * 칸(컬럼) 메뉴의 글자와 숫자 — #845 5단계(2026-10-08 대표 결정).
 *
 * 머리글에는 칸 이름만 남기고(출처 기호 ▼ ⇄ ✎ ƒ · ⋯ 단추를 걷었다) 그 칸이 어떤 칸인지는
 * 이름을 눌러 여는 메뉴 맨 위 회색 한 줄(「날짜 · 18/24 채움」)로만 말한다.
 * 대표: "설명이 너무 많아 메뉴는 간결하게" — 항목은 한 줄, 둘째 줄·예시·풀이 문단을 두지 않는다.
 * 결과(값이 함께 지워짐·계산이 멈춤)는 지우기 확인 창에서만 말한다.
 */
import type { BoardColumn, CellValue, ItemWithValues } from "@/lib/boards/types";
import { isEmptyCell } from "@/lib/boards/cells";
import { isSourceEditable } from "@/lib/field/source";

export type ColumnSortDirection = "asc" | "desc";

/**
 * 칸 메뉴 「보기 · 나만」 이 보드에 올리는 요청. 표는 상태를 들지 않고 BoardWorkspace 가 처리한다.
 *   · sort   — 이 칸 하나로 줄 세우기(direction null = 원래 순서로)
 *   · filter — 「골라 보기…」: 이 칸의 골라 보기 화면을 연다
 *   · hide   — 「숨기기」: 이 뷰의 보이는 칸에서 뺀다
 *   · group  — 「{칸}별로 나눠 보기」(#845 7단계): on=false 면 보드별로 되돌린다
 */
export type ColumnViewRequest =
  | { kind: "sort"; columnKey: string; direction: ColumnSortDirection | null }
  | { kind: "filter"; columnKey: string }
  | { kind: "hide"; columnKey: string }
  | { kind: "group"; columnKey: string; on: boolean };

/** 메뉴 글자 — 한 줄씩, 쉬운 말. */
export const COLUMN_MENU_TEXT = {
  view: "보기",
  viewTag: "나만",
  manage: "칸",
  manageTag: "모두",
  sortReset: "원래 순서로",
  filter: "골라 보기…",
  hide: "숨기기",
  rename: "이름 바꾸기",
  editOptions: "선택지 고치기",
  editType: "입력 방식 바꾸기",
  moveLeft: "왼쪽으로",
  moveRight: "오른쪽으로",
  addRight: "오른쪽에 칸 추가",
  duplicate: "복사하기",
  remove: "지우기",
  readOnly: "고칠 수 없음",
  sendsMessage: "문자 발송",
} as const;

/**
 * 칸 종류 한 낱말 — 날짜/목록/사람/글자/금액/숫자/계산/연결.
 * 체크·파일 칸만 따로 부른다(글자라고 부르면 틀린 말이 된다).
 */
export function columnKindWord(column: Pick<BoardColumn, "type" | "source">): string {
  if (column.type === "calc" || column.source === "calc") return "계산";
  if (column.source === "lk") return "연결";
  switch (column.type) {
    case "date":
    case "datetime":
      return "날짜";
    case "select":
    case "multiselect":
    case "status":
    case "other_info":
      return "목록";
    case "person":
    case "people":
      return "사람";
    case "money":
      return "금액";
    case "number":
      return "숫자";
    case "checkbox":
      return "체크";
    case "file":
      return "파일";
    default:
      return "글자";
  }
}

/** 손으로 못 고치는 칸 — 계산 칸·읽기 전용 칸. */
export function columnIsReadOnly(column: Pick<BoardColumn, "source" | "type" | "is_readonly">): boolean {
  return column.is_readonly === true || column.type === "calc" || !isSourceEditable(column.source);
}

/** ✉ 발송 칸 — 값을 바꾸면 고객에게 문자가 나간다. 머리글 기호가 빠졌으므로 회색 줄 끝에 짧게 단다. */
export function columnSendsMessage(column: Pick<BoardColumn, "source">): boolean {
  return column.source === "msg";
}

function isFilled(column: Pick<BoardColumn, "type">, value: CellValue | undefined): boolean {
  if (column.type === "checkbox") return value === true;
  return !isEmptyCell(value ?? null);
}

/** 이 칸이 채워진 행 수 — 넘겨받은 행 기준. */
export function columnFillCount(
  column: Pick<BoardColumn, "key" | "type">,
  rows: readonly Pick<ItemWithValues, "values">[],
): { filled: number; total: number } {
  let filled = 0;
  for (const row of rows) if (isFilled(column, row.values[column.key])) filled += 1;
  return { filled, total: rows.length };
}

/**
 * 메뉴 맨 위 회색 한 줄의 조각 — 「날짜 · 18/24 채움」 · 「계산 · 고칠 수 없음」.
 * 계산 칸은 채움 수를 말하지 않는다(사람이 채우는 칸이 아니다). 발송 표시는 화면이 따로 붙인다.
 */
export function columnMetaParts(
  column: Pick<BoardColumn, "type" | "source" | "is_readonly">,
  fill: { filled: number; total: number } | null,
): string[] {
  const kind = columnKindWord(column);
  const parts = [kind];
  if (fill && kind !== "계산") parts.push(`${fill.filled}/${fill.total} 채움`);
  if (columnIsReadOnly(column)) parts.push(COLUMN_MENU_TEXT.readOnly);
  return parts;
}

/* ── 줄 세우기 ─────────────────────────────────────────────────────────────── */

export type ColumnSortOption = Readonly<{ direction: ColumnSortDirection; label: string }>;

const pair = (
  first: ColumnSortDirection,
  firstLabel: string,
  secondLabel: string,
): ColumnSortOption[] => [
  { direction: first, label: firstLabel },
  { direction: first === "asc" ? "desc" : "asc", label: secondLabel },
];

/**
 * 칸 종류에 맞는 줄 세우기(자주 쓰는 쪽이 위). 목록 칸은 선택지 이름으로, 사람 칸은 이름으로
 * 줄 세운다(filters.applyFilters 의 sortableCell). 파일 칸은 줄 세울 말이 없어 내지 않는다.
 */
export function columnSortOptions(column: Pick<BoardColumn, "type">): ColumnSortOption[] {
  switch (column.type) {
    case "date":
    case "datetime":
      return pair("asc", "가까운 날짜순", "먼 날짜순");
    case "money":
      return pair("desc", "큰 금액순", "작은 금액순");
    case "number":
      return pair("desc", "큰 숫자순", "작은 숫자순");
    case "checkbox":
      return pair("desc", "체크한 것 먼저", "안 한 것 먼저");
    case "calc":
      return pair("asc", "작은 값순", "큰 값순");
    case "person":
    case "people":
      return [{ direction: "asc", label: "이름순" }];
    case "file":
    case "other_info":
      return [];
    default:
      return pair("asc", "가나다순", "가나다 역순");
  }
}

/** 「선택지 고치기」(목록 칸) 또는 「입력 방식 바꾸기」 — 같은 설정 창을 연다. */
export function columnEditLabel(column: Pick<BoardColumn, "type">): string {
  return column.type === "select" || column.type === "multiselect" || column.type === "status"
    ? COLUMN_MENU_TEXT.editOptions
    : COLUMN_MENU_TEXT.editType;
}

/* ── 계산 칸이 이 칸을 쓰는가 ──────────────────────────────────────────────── */

/** ƒ(계산 표시)를 뗀 부르는 이름. */
export function columnPlainName(label: string): string {
  return label.replace(/^ƒ\s*/u, "").trim() || label;
}

/** 062 계산 함수(bbe153_normalized_label)와 같은 규칙 — ƒ·빈칸·밑줄을 뗀다. */
function normalizedLabel(label: string): string {
  return label.replace(/ƒ/gu, "").replace(/[\s_]/gu, "");
}

/**
 * 계산 칸 → 그 계산이 읽는 칸(이름 기준). 정본은 supabase/migrations/062_board_calculated_values.sql 의
 * bbe153_recalculate_item 이다 — 그 함수가 칸을 «이름» 으로 찾으므로 여기서도 이름으로 맞춘다.
 * 여기에 없는 계산 칸은 «모름» 이다(확인 창에서 말하지 않는다).
 */
const CALC_INPUTS: Readonly<Record<string, readonly string[]>> = {
  "재신청안내일": ["조달일"],
  "수수료(원)": ["실행액", "수수료(%)", "수수료%"],
  "심사D-day": ["예상심사종료"],
  "D+180": ["수수료입금일"],
  "읽음": ["대상", "읽은사람", "readuserids"],
};

/** 이 칸을 읽는 같은 탭 계산 칸들의 부르는 이름(「심사 D-day」). 모르면 빈 배열. */
export function calcConsumersOf(
  column: Pick<BoardColumn, "key" | "label">,
  catalog: readonly Pick<BoardColumn, "key" | "label" | "type" | "source" | "is_readonly">[],
): string[] {
  const own = normalizedLabel(column.label);
  const names: string[] = [];
  for (const candidate of catalog) {
    if (candidate.key === column.key) continue;
    const computed = candidate.type === "calc" || candidate.source === "calc" || candidate.is_readonly === true;
    if (!computed) continue;
    const inputs = CALC_INPUTS[normalizedLabel(candidate.label)];
    if (inputs?.includes(own)) names.push(columnPlainName(candidate.label));
  }
  return [...new Set(names)];
}

/**
 * 지우기 확인 창의 한두 줄. 칸은 휴지통으로 옮겨지고 값·설정은 보존되며, 보드의 「되돌리기」 로 살린다.
 * 탭과 달리 칸에는 «7일 뒤 영구 삭제» 경로가 없어서(169 는 탭만 비운다) 보관 기간을 약속하지 않는다.
 */
export function columnDeleteLines(filled: number, consumers: readonly string[]): { main: string; calc: string | null } {
  const main = filled > 0
    ? `값 ${filled}건이 함께 휴지통으로 가요 · 바로 「되돌리기」로 살릴 수 있어요`
    : "휴지통으로 가요 · 바로 「되돌리기」로 살릴 수 있어요";
  const calc = consumers.length > 0
    ? `${consumers.map((name) => `「${name}」`).join("·")} 계산이 멈춰요`
    : null;
  return { main, calc };
}
