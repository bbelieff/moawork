/**
 * 임의 보드 서비스 (T02b · ADR-0003).
 * 포트(BoardsRepo) 위에서 보드/컬럼/아이템/셀 오케스트레이션.
 *
 * 두 갈래 구분:
 *  - 시스템 보드(is_system, source='core.crm.pipeline') = 정책자금 파이프라인.
 *    데이터는 001 deals/stages 에 있고 여기선 **메타만** 다룬다 → 컬럼/아이템 편집 금지.
 *  - 사용자 보드 = 003 boards/items EAV. 자유롭게 컬럼·행 추가/편집.
 */

import type { Ctx, FieldOption } from "@/lib/types";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import type {
  BoardPatch,
  BoardsRepo,
  ColumnPatch,
  ItemPatch,
  NewBoard,
  NewColumn,
  NewGroup,
  NewItem,
} from "./store";
import type {
  Board,
  BoardColumn,
  BoardDetail,
  BoardItem,
  CellValue,
  ItemWithValues,
} from "./types";
import { compareCells, isEmptyCell, normalizeCellValue, validateAgainstOptions } from "./cells";

export class NotFoundError extends Error {
  constructor(message = "찾을 수 없습니다") {
    super(message);
    this.name = "NotFoundError";
  }
}
export class BoardRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardRuleError";
  }
}

/** 새 보드에 기본 제공되는 컬럼(빈 보드가 바로 쓸 수 있도록). */
export const DEFAULT_NEW_BOARD_COLUMNS: NewColumn[] = [
  {
    key: "status",
    label: "상태",
    type: "select",
    options: [
      { id: "opt-todo", label: "대기", color: "#c4c4c4", order: 0 },
      { id: "opt-doing", label: "진행중", color: "#fdab3d", order: 1 },
      { id: "opt-done", label: "완료", color: "#00c875", order: 2 },
    ],
  },
  { key: "owner", label: "담당", type: "person" },
  { key: "due", label: "마감일", type: "date" },
];

export class BoardsService {
  constructor(private readonly repo: BoardsRepo = getBoardsRepo()) {}

  // ── 보드 ──
  listBoards(ctx: Ctx): Board[] {
    return this.repo.listBoards(ctx);
  }

  getBoardDetail(ctx: Ctx, boardId: string): BoardDetail {
    const board = this.repo.getBoard(ctx, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    return {
      board,
      columns: this.repo.listColumns(ctx, boardId),
      groups: this.repo.listGroups(ctx, boardId),
    };
  }

  /** 사용자 보드 생성 — 기본 컬럼 2~3개를 함께 프로비저닝. */
  createBoard(ctx: Ctx, input: NewBoard): BoardDetail {
    const board = this.repo.createBoard(ctx, input);
    for (const col of DEFAULT_NEW_BOARD_COLUMNS) {
      this.repo.createColumn(ctx, board.id, col);
    }
    return this.getBoardDetail(ctx, board.id);
  }

  updateBoard(ctx: Ctx, boardId: string, patch: BoardPatch): Board {
    const board = this.requireEditableBoard(ctx, boardId);
    const updated = this.repo.updateBoard(ctx, board.id, patch);
    if (!updated) throw new NotFoundError("보드를 찾을 수 없습니다");
    return updated;
  }

  deleteBoard(ctx: Ctx, boardId: string): void {
    this.requireEditableBoard(ctx, boardId);
    if (!this.repo.deleteBoard(ctx, boardId)) throw new NotFoundError("보드를 찾을 수 없습니다");
  }

  // ── 컬럼 ──
  addColumn(ctx: Ctx, boardId: string, input: NewColumn): BoardColumn {
    this.requireEditableBoard(ctx, boardId);
    return this.repo.createColumn(ctx, boardId, input);
  }

  updateColumn(ctx: Ctx, boardId: string, columnId: string, patch: ColumnPatch): BoardColumn {
    this.requireEditableBoard(ctx, boardId);
    const col = this.repo.updateColumn(ctx, columnId, patch);
    if (!col) throw new NotFoundError("컬럼을 찾을 수 없습니다");
    return col;
  }

  deleteColumn(ctx: Ctx, boardId: string, columnId: string): void {
    this.requireEditableBoard(ctx, boardId);
    if (!this.repo.deleteColumn(ctx, columnId)) throw new NotFoundError("컬럼을 찾을 수 없습니다");
  }

  // ── 그룹 ──
  addGroup(ctx: Ctx, boardId: string, input: NewGroup) {
    this.requireEditableBoard(ctx, boardId);
    return this.repo.createGroup(ctx, boardId, input);
  }

  // ── 아이템 + 셀 ──
  listItems(ctx: Ctx, boardId: string): ItemWithValues[] {
    const detail = this.getBoardDetail(ctx, boardId);
    const items = this.repo.listItems(ctx, boardId);
    return this.compose(ctx, items, detail.columns);
  }

  getItem(ctx: Ctx, boardId: string, itemId: string): ItemWithValues {
    const detail = this.getBoardDetail(ctx, boardId);
    const item = this.repo.getItem(ctx, itemId);
    if (!item || item.board_id !== boardId)
      throw new NotFoundError("아이템을 찾을 수 없습니다");
    return this.compose(ctx, [item], detail.columns)[0];
  }

  createItem(ctx: Ctx, boardId: string, input: NewItem): ItemWithValues {
    const detail = this.requireEditableBoardDetail(ctx, boardId);
    const values = input.values
      ? this.normalizeValues(detail.columns, input.values)
      : undefined;
    const item = this.repo.createItem(ctx, boardId, { ...input, values });
    return this.compose(ctx, [item], detail.columns)[0];
  }

  updateItem(ctx: Ctx, boardId: string, itemId: string, patch: ItemPatch): ItemWithValues {
    this.requireEditableBoard(ctx, boardId);
    const item = this.repo.updateItem(ctx, itemId, patch);
    if (!item) throw new NotFoundError("아이템을 찾을 수 없습니다");
    return this.getItem(ctx, boardId, itemId);
  }

  deleteItem(ctx: Ctx, boardId: string, itemId: string): void {
    this.requireEditableBoard(ctx, boardId);
    if (!this.repo.deleteItem(ctx, itemId)) throw new NotFoundError("아이템을 찾을 수 없습니다");
  }

  /** 셀 인라인 편집 — 컬럼 타입으로 정규화 + 선택지 검증 후 저장. */
  setCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    patch: Record<string, CellValue>,
  ): ItemWithValues {
    const detail = this.requireEditableBoardDetail(ctx, boardId);
    if (!this.repo.getItem(ctx, itemId)) throw new NotFoundError("아이템을 찾을 수 없습니다");
    this.repo.setValues(ctx, itemId, this.normalizeValues(detail.columns, patch));
    return this.getItem(ctx, boardId, itemId);
  }

  /**
   * 칸반 그룹핑 — groupBy 가 컬럼 key 면 그 select 값 기준, 아니면 board_groups 기준.
   * 빈 그룹도 반환(칸반 컬럼 유지).
   */
  kanban(
    ctx: Ctx,
    boardId: string,
    groupBy?: string,
  ): { key: string; label: string; color: string | null; items: ItemWithValues[] }[] {
    const detail = this.getBoardDetail(ctx, boardId);
    const items = this.listItems(ctx, boardId);

    const col = groupBy ? detail.columns.find((c) => c.key === groupBy) : undefined;
    if (col && (col.type === "select" || col.type === "multiselect")) {
      const options = col.options_jsonb?.options ?? [];
      const lanes = options.map((o) => ({
        key: o.id,
        label: o.label,
        color: o.color ?? null,
        items: items.filter((i) => {
          const v = i.values[col.key];
          return Array.isArray(v) ? v.includes(o.id) : v === o.id;
        }),
      }));
      lanes.push({
        key: "",
        label: "미지정",
        color: null,
        items: items.filter((i) => isEmptyCell(i.values[col.key] ?? null)),
      });
      return lanes;
    }

    // 기본: board_groups 기준
    const lanes = detail.groups.map((g) => ({
      key: g.id,
      label: g.name,
      color: g.color,
      items: items.filter((i) => i.group_id === g.id),
    }));
    lanes.push({
      key: "",
      label: "미지정",
      color: null,
      items: items.filter((i) => i.group_id === null),
    });
    return lanes;
  }

  /** 테이블 정렬(컬럼 key 기준). 빈값은 뒤로. */
  sortItems(items: ItemWithValues[], columnKey: string, dir: "asc" | "desc" = "asc") {
    const sorted = [...items].sort((a, b) =>
      compareCells(a.values[columnKey] ?? null, b.values[columnKey] ?? null),
    );
    return dir === "asc" ? sorted : sorted.reverse();
  }

  // ── 내부 ──
  private compose(ctx: Ctx, items: BoardItem[], columns: BoardColumn[]): ItemWithValues[] {
    if (items.length === 0) return [];
    const keys = new Set(columns.map((c) => c.key));
    const values = this.repo.listValues(ctx, items.map((i) => i.id));
    const byItem = new Map<string, Record<string, CellValue>>();
    for (const v of values) {
      if (!keys.has(v.column_key)) continue; // 삭제된 컬럼의 잔여값 무시
      const bag = byItem.get(v.item_id) ?? {};
      bag[v.column_key] = v.value_jsonb;
      byItem.set(v.item_id, bag);
    }
    return items.map((i) => ({ ...i, values: byItem.get(i.id) ?? {} }));
  }

  private normalizeValues(
    columns: BoardColumn[],
    patch: Record<string, CellValue>,
  ): Record<string, CellValue> {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const out: Record<string, CellValue> = {};
    for (const [key, raw] of Object.entries(patch)) {
      const col = byKey.get(key);
      if (!col) continue; // 정의되지 않은 컬럼은 무시(EAV 오염 방지)
      const value = normalizeCellValue(col.type, raw);
      const options: FieldOption[] | null = col.options_jsonb?.options ?? null;
      if (!validateAgainstOptions(col.type, value, options))
        throw new BoardRuleError(`${col.label}: 허용되지 않은 선택지입니다`);
      out[key] = value;
    }
    return out;
  }

  /** 시스템 보드는 구조/데이터 편집 금지(정책자금은 deals 화면에서). */
  private requireEditableBoard(ctx: Ctx, boardId: string): Board {
    const board = this.repo.getBoard(ctx, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    if (board.is_system)
      throw new BoardRuleError(
        "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다",
      );
    return board;
  }

  private requireEditableBoardDetail(ctx: Ctx, boardId: string): BoardDetail {
    this.requireEditableBoard(ctx, boardId);
    return this.getBoardDetail(ctx, boardId);
  }
}
