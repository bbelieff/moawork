// T09 · 보드 컬럼 추출 — 먼데이 보드(예: 업무관리 31컬럼)를 UI 표현으로.
//
// 원본 board_columns(002_seed) → BoardColumn[]. select 옵션은 전역 프리셋 참조(ref),
// 인라인 옵션, 비공개(redacted) 중 하나로 해석.

import type {
  BoardColumn,
  PolicyfundPresets,
  RawBoardColumn,
} from "./types";

/** 정책자금 보드 화면의 기본 대상: 업무관리(31컬럼). */
export const WORK_BOARD = "업무관리";

/** 최상위 보드 이름 목록(회계_연도차이 같은 중첩 보드 포함). */
export function listBoards(presets: PolicyfundPresets): string[] {
  return Object.keys(presets.board_columns ?? {});
}

function rawColumnsOf(
  presets: PolicyfundPresets,
  board: string,
  year?: string,
): RawBoardColumn[] {
  const entry = presets.board_columns?.[board];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  if (year && Array.isArray(entry[year])) return entry[year];
  return [];
}

/** 원본 컬럼 1개를 앱 BoardColumn 으로 변환. */
function toBoardColumn(col: RawBoardColumn, index: number): BoardColumn {
  const out: BoardColumn = { index, label: col.label, type: col.type };
  if (col.formula) out.formula = col.formula;
  const opts = col.options;
  if (Array.isArray(opts)) {
    out.inlineOptions = opts;
  } else if (opts && typeof opts === "object") {
    if ("ref" in opts) out.optionRef = opts.ref;
    else if ("redacted" in opts) out.redacted = true;
  }
  return out;
}

/**
 * 보드의 컬럼을 순서대로 BoardColumn[] 로 반환.
 * @param year 회계_연도차이 등 중첩 보드의 연도(예: "25년").
 */
export function getBoardColumns(
  presets: PolicyfundPresets,
  board: string,
  year?: string,
): BoardColumn[] {
  return rawColumnsOf(presets, board, year).map(toBoardColumn);
}

/** 정책자금 보드 화면(업무관리 31컬럼) 컬럼을 반환. */
export function getWorkBoardColumns(presets: PolicyfundPresets): BoardColumn[] {
  return getBoardColumns(presets, WORK_BOARD);
}

/** 보드의 파이프라인 단계 이름 목록(단계 필터/정렬 순서로 사용). */
export function pipelineStageNames(presets: PolicyfundPresets): string[] {
  return (presets.pipeline_stages ?? []).map((s) => s.name);
}
