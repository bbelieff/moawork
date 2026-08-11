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
import { resolveMoveTarget } from "./moveRules";
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

/**
 * 되돌리기 스냅샷 — 편집 직전 상태. 그대로 `undoCells()` 에 넘기면 원복된다.
 * 값 자체를 재검증해 이동 규칙을 다시 태우는 방식(재기입)이 아니라, 이전 group_id 를
 * **명시적으로 복원**한다 — 재기입 방식은 "이동 규칙이 없던 값"(예: 빈 값)에서
 * "규칙 있는 값"으로 바뀐 편집을 되돌릴 때 원래 그룹을 못 찾는 결함이 있다.
 */
export interface CellEditUndo {
  /** 이번 호출에서 실제로 저장된 키들의 **편집 전** 값. */
  values: Record<string, CellValue>;
  /** 편집 전 group_id(이동이 없었어도 항상 채운다 — 복원은 그냥 대입이라 안전하다). */
  group_id: string | null;
}

/** 셀 편집 결과 — 통과분은 저장됐고, 실패분은 errors 로 보고된다. */
export interface SetCellsResult {
  item: ItemWithValues;
  errors: CellError[];
  /** 저장된 값이 하나도 없으면(전부 실패) null. */
  undo: CellEditUndo | null;
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
    // 생성은 **인라인 피드백 지면이 없다**(고칠 셀이 화면에 아직 없음).
    // 따라서 통과분만 조용히 싣지 않고 **거부한다** — 값을 말없이 버리는 것은
    // 관대 정책이 막으려던 데이터 유실 그 자체다. (편집은 setCells 가 errors 로 돌려준다.)
    let values: Record<string, CellValue> | undefined;
    if (input.values) {
      const res = this.validateValues(detail.columns, input.values);
      if (res.errors.length > 0) {
        throw new BoardRuleError(res.errors.map((e) => `${e.label}: ${e.message}`).join(", "));
      }
      values = res.values;
    }
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
   *
   * D68~D70: 저장된 값이 "조작 열"(move_rule_jsonb 를 가진 컬럼)의 값이고 그 값이
   * 이동 규칙에 걸리면, 값 저장과 **같은 호출 안에서** 아이템의 group_id 도 옮긴다
   * (별도 API 왕복이 없다 — "저장했더니 카드가 안 옮겨갔다"는 사고를 원천 차단).
   * 여러 조작 열이 한 번에 바뀌면 나중 키가 이긴다(패치 순서 = 마지막이 최종 상태).
   *
   * 되돌리기: 쓰기 **전** 값과 group_id 를 스냅샷해 `undo` 로 돌려준다.
   * 호출부는 이걸 그대로 `undoCells()` 에 넘기면 된다.
   */
  setCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    patch: Record<string, CellValue>,
  ): SetCellsResult {
    const detail = this.requireEditableBoardDetail(ctx, boardId);
    const before = this.repo.getItem(ctx, itemId);
    if (!before) throw new NotFoundError("아이템을 찾을 수 없습니다");

    const { values, errors } = this.validateValues(detail.columns, patch);
    const writtenKeys = Object.keys(values);
    if (writtenKeys.length === 0) {
      return { item: this.getItem(ctx, boardId, itemId), errors, undo: null };
    }

    // 되돌리기용 이전 값 스냅샷 — 실제 쓰기 전에 떠 둔다.
    const beforeValues = this.getItem(ctx, boardId, itemId).values;
    const undo: CellEditUndo = {
      values: Object.fromEntries(writtenKeys.map((k) => [k, beforeValues[k] ?? null])),
      group_id: before.group_id,
    };

    this.repo.setValues(ctx, itemId, values);

    // 조작 열 이동 — 패치 순서상 나중 키가 최종 목적지를 정한다.
    const byKey = new Map(detail.columns.map((c) => [c.key, c]));
    let target: string | null = null;
    for (const key of writtenKeys) {
      const col = byKey.get(key);
      if (!col) continue;
      const resolved = resolveMoveTarget(col, values[key]);
      if (resolved !== null) target = resolved;
    }
    if (target !== null && target !== before.group_id) {
      this.repo.updateItem(ctx, itemId, { group_id: target });
    }

    return { item: this.getItem(ctx, boardId, itemId), errors, undo };
  }

  /**
   * `setCells()` 가 돌려준 `undo` 를 그대로 적용해 편집 직전 상태로 되돌린다.
   * 값·group_id 를 **명시 복원**한다(이동 규칙 재평가에 기대지 않는다 — 이유는
   * `CellEditUndo` 주석 참고). 검증은 다시 하지 않는다 — 그 값들은 이미 한 번
   * 통과한 값이다.
   */
  undoCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    undo: CellEditUndo,
  ): ItemWithValues {
    this.requireEditableBoard(ctx, boardId);
    if (!this.repo.getItem(ctx, itemId)) throw new NotFoundError("아이템을 찾을 수 없습니다");
    if (Object.keys(undo.values).length > 0) this.repo.setValues(ctx, itemId, undo.values);
    this.repo.updateItem(ctx, itemId, { group_id: undo.group_id });
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
   * - **읽기 전용 칸**(`col.is_readonly`, 목업 개정 ④): 값의 형식과 무관하게 **모든** 쓰기를
   *   errors 로 되돌린다(throw 아님 — 사용자가 실수로 클릭했을 뿐 무결성 위협은 아니다).
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
      // 손으로 못 고치는 칸(목업 개정 ④) — 값의 형식과 무관하게 편집 자체를 막는다.
      // isIntegrityField 와는 다른 축: 저건 "형식이 틀리면 거부", 이건 "형식과 무관하게 항상 거부".
      if (col.is_readonly) {
        errors.push({
          key,
          label: col.label,
          message: "자동 계산되는 칸이라 손으로 고칠 수 없습니다",
        });
        continue;
      }
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
