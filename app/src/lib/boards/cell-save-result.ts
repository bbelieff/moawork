import type { CellError } from "@/lib/boards/service";
import type { CellValue, ItemWithValues } from "@/lib/boards/types";

/**
 * Issue 857 — 칸 저장 결과. 화면은 이것만으로 그 행을 고친다(전체를 다시 그리지 않는다).
 * ok 여도 errors 가 있을 수 있다 — setCells 는 틀린 칸만 빼고 저장하는 관대 정책이다.
 */
export type CellSaveResult =
  | { ok: true; item: ItemWithValues; errors: CellError[]; notices: CellError[] }
  | { ok: false; errors: CellError[] };

/** 이 칸의 저장 뒤 칸 아래에 보일 한 줄. 없으면 null(지난 오류도 지운다). */
export function cellSaveMessage(result: CellSaveResult, columnKey: string): string | null {
  const pick = (list: readonly CellError[]) => list.find((entry) => entry.key === columnKey) ?? list[0];
  const error = pick(result.errors);
  if (error) return error.message;
  return result.ok ? pick(result.notices)?.message ?? null : null;
}

/** 서버가 돌려준 행으로 화면의 행을 고친다. 값·그룹(규칙 이동)·정렬 위치만 서버를 따른다. */
export function mergeSavedItem(row: ItemWithValues, saved: ItemWithValues): ItemWithValues {
  return {
    ...row,
    group_id: saved.group_id,
    sort_order: saved.sort_order,
    values: { ...row.values, ...saved.values },
    value_statuses: saved.value_statuses ?? row.value_statuses,
  };
}

/** 서버가 돌려준 행들을 화면 행에 얹는다. 다른 보드로 간 행은 이 화면에서 뺀다. */
export function applySavedItems(rows: ItemWithValues[], saved: Readonly<Record<string, ItemWithValues>>): ItemWithValues[] {
  if (Object.keys(saved).length === 0) return rows;
  return rows.flatMap((row) => {
    const item = saved[row.id];
    if (!item) return [row];
    return item.board_id !== row.board_id ? [] : [mergeSavedItem(row, item)];
  });
}

/** 저장이 끝나기 전 화면에 먼저 그릴 값. */
export function patchCellValue(rows: ItemWithValues[], patch: { itemId: string; key: string; value: CellValue }): ItemWithValues[] {
  return rows.map((row) => row.id === patch.itemId ? { ...row, values: { ...row.values, [patch.key]: patch.value } } : row);
}
