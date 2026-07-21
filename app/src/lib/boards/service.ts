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
  NewView,
  ViewPatch,
} from "./store";
import type {
  Board,
  BoardColumn,
  BoardDetail,
  BoardItem,
  BoardView,
  CellValue,
  ItemWithValues,
} from "./types";
import { compareCells, isEmptyCell, validateCell } from "./cells";
import { isIntegrityField } from "@/lib/custom/field-types";
import { pickDefaultView } from "@/lib/custom/views";

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

/** 저장되지 않은 셀 1건의 사유 — 화면에 인라인으로 표시한다. */
export interface CellError {
  key: string;
  label: string;
  message: string;
}

/** 셀 편집 결과 — 통과분은 저장됐고, 실패분은 errors 로 보고된다. */
export interface SetCellsResult {
  item: ItemWithValues;
  errors: CellError[];
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
    // 생성 시점엔 인라인 피드백 지면이 없으므로, 통과분만 싣는다(무결성 필드 오류는 throw).
    const values = input.values
      ? this.validateValues(detail.columns, input.values).values
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

  /**
   * 셀 인라인 편집 — 검증 훅 통과분만 저장하고, 실패분은 `errors` 로 돌려준다.
   * (관대 정책: 한 셀이 틀려도 나머지는 저장된다. 무결성 필드 오류만 throw.)
   */
  setCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    patch: Record<string, CellValue>,
  ): SetCellsResult {
    const detail = this.requireEditableBoardDetail(ctx, boardId);
    if (!this.repo.getItem(ctx, itemId)) throw new NotFoundError("아이템을 찾을 수 없습니다");
    const { values, errors } = this.validateValues(detail.columns, patch);
    if (Object.keys(values).length > 0) this.repo.setValues(ctx, itemId, values);
    return { item: this.getItem(ctx, boardId, itemId), errors };
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

  // ── 저장뷰(board_views · 003) ────────────────────────────────

  /** 보드의 뷰 목록 — 공유뷰 ∪ 내 개인뷰(가시성은 repo 가 적용). */
  listViews(ctx: Ctx, boardId: string): BoardView[] {
    this.requireBoard(ctx, boardId);
    return this.repo.listViews(ctx, boardId);
  }

  /**
   * 기본 뷰 — 규약: shared 우선 → name ASC → id ASC.
   * `board_views` 에 created_at/is_default 가 없어 확정된 결정적 규약(기획2 OQ-4 재판정).
   * T05 `lib/custom/views.ts` 의 `pickDefaultView` 를 그대로 재사용한다(2중 구현 금지).
   */
  getDefaultView(ctx: Ctx, boardId: string): BoardView | null {
    return pickDefaultView(this.listViews(ctx, boardId));
  }

  createView(ctx: Ctx, boardId: string, input: NewView): BoardView {
    this.requireBoard(ctx, boardId);
    return this.repo.createView(ctx, boardId, input);
  }

  updateView(ctx: Ctx, viewId: string, patch: ViewPatch): BoardView {
    const view = this.repo.updateView(ctx, viewId, patch);
    if (!view) throw new NotFoundError("뷰를 찾을 수 없습니다");
    return view;
  }

  deleteView(ctx: Ctx, viewId: string): void {
    if (!this.repo.deleteView(ctx, viewId)) throw new NotFoundError("뷰를 찾을 수 없습니다");
  }

  /** 보드 존재·가시성 확인(뷰는 시스템 보드에서도 허용 — 구조 편집이 아니므로). */
  private requireBoard(ctx: Ctx, boardId: string): Board {
    const board = this.repo.getBoard(ctx, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    return board;
  }

  /**
   * 셀 검증 훅 — 쓰기 경로의 단일 관문(기획2 판정 2026-07-21).
   *
   * 정책:
   * - **기본 = 관대 + 인라인 피드백**(먼데이 파리티). 형식이 틀린 값은 **저장하지 않고**
   *   `errors` 로 돌려보내 사용자가 그 자리서 고치게 한다. 나머지 정상 값은 정상 저장.
   * - ⛔ 조용히 null 로 수렴시키지 않는다(데이터 유실 금지).
   * - **엄격 예외 = 무결성 필드**(`isIntegrityField`): 정산 generated column 이 의존하므로
   *   틀린 값이면 흘리지 않고 하드 거부(throw)한다.
   */
  private validateValues(
    columns: BoardColumn[],
    patch: Record<string, CellValue>,
  ): { values: Record<string, CellValue>; errors: CellError[] } {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const values: Record<string, CellValue> = {};
    const errors: CellError[] = [];

    for (const [key, raw] of Object.entries(patch)) {
      const col = byKey.get(key);
      if (!col) continue; // 정의되지 않은 컬럼은 무시(EAV 오염 방지)
      const options: FieldOption[] | null = col.options_jsonb?.options ?? null;
      const res = validateCell(col.type, raw, options);

      if (res.ok) {
        values[key] = res.value;
        continue;
      }
      const message = res.error ?? "값을 해석할 수 없습니다";
      // 무결성 필드는 관대 정책의 예외 — 잘못된 값이 정산 수식에 흘러들면 안 된다.
      if (isIntegrityField(col.key)) {
        throw new BoardRuleError(`${col.label}: ${message}`);
      }
      errors.push({ key, label: col.label, message });
    }
    return { values, errors };
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
