/**
 * 나눠 보기 — #845 7단계(2026-10-08 대표 결정, 목업 ViewModel · ViewBar).
 *
 * 메인 표는 기본으로 «보드별»(탭 안의 그룹 = 단계)로 나눠 보인다. 보기 조건 「나눠 보기」 로
 * 사람 칸(담당자 등)이나 목록·상태 칸(진행기관 등)을 고르면, 모든 보드의 행을 그 칸의 값별 묶음으로
 * 다시 나눈다. 묶음 순서는 선택지 순서(목록·상태) · 구성원 순서(사람)이고, 값이 없는 행은 맨 끝
 * 「(없음)」 에 모인다.
 *
 * 이 파일은 화면이 없는 순수 규칙이다. 화면(BoardWorkspace)과 서버(setGroupValueAction ·
 * addItemAction)가 같은 규칙을 쓴다 — 어떤 칸으로 나눌 수 있나, 행이 어느 묶음에 드나,
 * 다른 묶음으로 끌어 놓으면 값이 무엇이 되나, 묶음에서 새 행을 만들면 무엇을 미리 넣나.
 */

import type { BoardColumn, CellValue, ItemWithValues } from "@/lib/boards/types";
import { isSourceEditable, sourceRequiresConfirm } from "@/lib/field/source";
import { WORKFLOW_PROGRESS_KEY, workflowKindForSource } from "@/lib/workflow/progress";

/** 표를 나눌 수 있는 칸의 종류 — 한 행이 한 값(사람 여럿은 첫 사람)을 갖는 칸. */
export const TABLE_GROUP_TYPES: ReadonlySet<string> = new Set(["person", "people", "select", "status"]);

/** 화면 전용 가상 칸 — 값이 행에 저장되지 않아 나눌 수 없다. */
const VIRTUAL_COLUMN_KEYS: ReadonlySet<string> = new Set([WORKFLOW_PROGRESS_KEY, "consultation_progress"]);

/** 메인 표의 「나눠 보기」 로 고를 수 있는 칸인가. */
export function isTableGroupColumn(column: Pick<BoardColumn, "key" | "type">): boolean {
  return TABLE_GROUP_TYPES.has(column.type) && !VIRTUAL_COLUMN_KEYS.has(column.key);
}

export const BOARD_GROUP_CHOICE_LABEL = "보드별로 나눠 보기";
export const GROUP_NONE_LABEL = "(없음)";

/** 「진행기관별로 나눠 보기」 — 칸 메뉴와 보기 조건 칸이 같은 글자를 쓴다. */
export function groupByChoiceLabel(columnLabel: string): string {
  return `${columnLabel}별로 나눠 보기`;
}

/**
 * 담당자(owner) 칸이 «배정» 으로 관리되는 보드 — 값이 행의 assigned_to 에 있고, 바꾸려면 배정 흐름을
 * 거쳐야 한다(GroupTable 의 담당 칸과 같은 규칙).
 *   · always — 신규리드(정본): 모든 행
 *   · deal   — 리드컨택·계약업체 실무: 딜에 묶인 행
 *   · never  — 그 밖의 보드
 */
export type AssignmentOwnerMode = "always" | "deal" | "never";

/** 보드 출처 → 담당자 칸을 읽는 방식(신규리드 정본 · 리드컨택 · 계약업체 실무만 배정). */
export function ownerModeForSource(source: string | null): AssignmentOwnerMode {
  const kind = workflowKindForSource(source);
  return kind === "new-lead" ? "always" : kind === "contact" || kind === "work" ? "deal" : "never";
}

export function ownerReadsAssignment(
  column: Pick<BoardColumn, "key">,
  row: Pick<ItemWithValues, "deal_id">,
  mode: AssignmentOwnerMode,
): boolean {
  if (column.key !== "owner") return false;
  return mode === "always" || (mode === "deal" && Boolean(row.deal_id));
}

/** 이 행이 드는 묶음의 값 — 목록·상태·사람은 값 그대로, 사람 여럿은 첫 사람. 없으면 null. */
export function groupValueOf(
  column: Pick<BoardColumn, "key" | "type">,
  row: Pick<ItemWithValues, "values" | "assigned_to" | "deal_id">,
  ownerMode: AssignmentOwnerMode = "never",
): string | null {
  if (ownerReadsAssignment(column, row, ownerMode)) {
    return typeof row.assigned_to === "string" && row.assigned_to ? row.assigned_to : null;
  }
  const raw = row.values[column.key];
  if (typeof raw === "string") return raw === "" ? null : raw;
  if (Array.isArray(raw)) {
    const first = raw.find((entry): entry is string => typeof entry === "string" && entry !== "");
    return first ?? null;
  }
  return null;
}

/**
 * 다른 묶음으로 끌어 놓았을 때의 새 값. target null = 「(없음)」.
 * 사람 여럿 칸은 «첫 사람» 만 바꾸고 나머지 사람은 그대로 둔다(묶음이 첫 사람으로 정해지므로).
 * 「(없음)」 으로 옮기면 칸을 비운다.
 */
export function movedGroupValue(
  column: Pick<BoardColumn, "type">,
  current: CellValue,
  target: string | null,
): CellValue {
  if (target === null) return null;
  if (column.type !== "people") return target;
  const members = Array.isArray(current)
    ? current.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : typeof current === "string" && current ? [current] : [];
  const rest = members.slice(1).filter((member) => member !== target);
  return [target, ...rest];
}

/** 묶음의 ＋ 로 만든 새 행에 미리 넣을 값. */
export function prefillGroupValue(column: Pick<BoardColumn, "type">, target: string): CellValue {
  return column.type === "people" ? [target] : target;
}

/**
 * 이 칸의 값을 «묶음 사이 끌기» · «묶음에서 새 행» 으로 바꿀 수 없는 까닭(짧은 한 줄). 바꿀 수 있으면 null.
 * 화면은 끌기·＋ 를 감추는 데, 서버는 거절하는 데 같은 답을 쓴다.
 *
 * editPolicyAllows — 칸의 편집 제한(edit_policy_jsonb, 예: 「관리자만」)이 이 사람에게 열려 있는가.
 *   판정은 부르는 쪽이 한다(서버 columnPolicyAllows · 화면은 서버가 넘긴 결과). 이 파일은 화면도 읽으므로
 *   서버 서비스를 import 하지 않는다. 닫혀 있으면 DB(itemvals_insert)가 값 쓰기를 거부한다 — ＋ 로 만들면
 *   행만 생기고 값은 빠진 «반쯤 만든 행» 이 남으므로 먼저 막는다.
 */
export function groupValueEditBlock(
  column: Pick<BoardColumn, "key" | "type" | "source" | "is_readonly">,
  {
    canonicalNewLead = false,
    ownerMode = "never",
    editPolicyAllows = true,
  }: { canonicalNewLead?: boolean; ownerMode?: AssignmentOwnerMode; editPolicyAllows?: boolean } = {},
): string | null {
  if (!isTableGroupColumn(column)) return "이 칸으로는 나눌 수 없어요.";
  if (column.is_readonly === true || !isSourceEditable(column.source)) return "고칠 수 없는 칸이에요.";
  if (!editPolicyAllows) return "이 칸을 고칠 권한이 없어요.";
  // ✉ 발송 칸 — 값을 바꾸면 문자가 나간다. 칸의 확인 창을 거쳐야 한다.
  if (sourceRequiresConfirm(column.source)) return "문자가 나가는 칸은 칸에서 바꿔요.";
  // 신규리드 정본 — 칸마다 따로 기록되는 길(딜 필드·넘기기)이 있어 칸에서만 바꾼다.
  if (canonicalNewLead) return "이 탭에서는 칸에서 바꿔요.";
  if (column.key === "owner" && ownerMode !== "never") return "담당은 담당 칸에서 바꿔요.";
  return null;
}

/** 칸의 확인 흐름을 거쳐야 하는 «넘기기» 값 — 묶음 사이 끌기로는 쓰지 않는다(setCellAction 의 넘기기와 같은 값). */
export function isTransitionGroupValue(columnKey: string, value: CellValue): boolean {
  return (columnKey === "contact_move" && value === "컨택 이동")
    || (columnKey === "consult_status" && value === "리드컨택으로 넘기기");
}

/**
 * 서버로 보낸 묶음 값(JSON) → 셀 값. 칸 종류에 맞지 않으면 undefined.
 *   사람·목록·상태: 문자열 또는 null · 사람 여럿: 문자열 배열 또는 null
 */
export function parseGroupCellValue(type: string, raw: string): CellValue | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null) return null;
  if (type === "people") {
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string" && entry !== "")) return undefined;
    const unique = [...new Set(parsed as string[])];
    return unique.length > 0 ? unique : null;
  }
  return typeof parsed === "string" && parsed !== "" ? parsed : undefined;
}

/** 사람 칸 값에 든 계정 id — 서버가 «이 회사의 구성원인가» 를 확인할 대상. */
export function personIdsOf(value: CellValue): string[] {
  if (typeof value === "string") return value ? [value] : [];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "") : [];
}
