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
import { isSourceEditable } from "@/lib/field/source";
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
  private readonly repo: Promise<BoardsRepo>;
  constructor(repo?: BoardsRepo) { this.repo = repo ? Promise.resolve(repo) : getBoardsRepo(); }

  // ── 보드 ──
  async listBoards(ctx: Ctx): Promise<Board[]> {
    return (await this.repo).listBoards(ctx);
  }

  // BBE-214 — 세 읽기는 서로를 «입력으로 쓰지 않는다». 줄 세우면 왕복 지연이 3배로 쌓인다.
  // 실측(page.roundtrips.test.tsx): 이 메서드가 한 화면에서 3번 불리므로 직렬 3단계 × 3 = 9단계였다.
  // 병렬로 바꿔도 관측되는 동작은 같다 — 보드가 없으면 여전히 NotFoundError 를 던진다.
  // (없는 보드에도 columns·groups 질의가 나가지만 org 범위 안의 빈 결과라 부작용이 없다.)
  async getBoardDetail(ctx: Ctx, boardId: string): Promise<BoardDetail> {
    const repo = await this.repo;
    const [board, columns, groups] = await Promise.all([
      repo.getBoard(ctx, boardId),
      repo.listColumns(ctx, boardId),
      repo.listGroups(ctx, boardId),
    ]);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    return { board, columns, groups };
  }

  /** 사용자 보드 생성 — 기본 컬럼 2~3개를 함께 프로비저닝. */
  async createBoard(ctx: Ctx, input: NewBoard): Promise<BoardDetail> {
    const repo = await this.repo;
    const board = await repo.createBoard(ctx, input);
    for (const col of DEFAULT_NEW_BOARD_COLUMNS) {
      await repo.createColumn(ctx, board.id, col);
    }
    return this.getBoardDetail(ctx, board.id);
  }

  async updateBoard(ctx: Ctx, boardId: string, patch: BoardPatch): Promise<Board> {
    const board = await this.requireEditableBoard(ctx, boardId);
    const updated = await (await this.repo).updateBoard(ctx, board.id, patch);
    if (!updated) throw new NotFoundError("보드를 찾을 수 없습니다");
    return updated;
  }

  async deleteBoard(ctx: Ctx, boardId: string): Promise<void> {
    await this.requireEditableBoard(ctx, boardId);
    if (!await (await this.repo).deleteBoard(ctx, boardId)) throw new NotFoundError("보드를 찾을 수 없습니다");
  }

  // ── 컬럼 ──
  async addColumn(ctx: Ctx, boardId: string, input: NewColumn): Promise<BoardColumn> {
    await this.requireEditableBoard(ctx, boardId);
    return (await this.repo).createColumn(ctx, boardId, input);
  }

  // BBE-196 — requireEditableBoard 는 «boardId 를 편집할 수 있는가» 만 본다.
  // columnId 가 «그 boardId 소속인가» 는 별개 질문이라, 편집 가능한 보드 아무거나 하나만
  // 있으면 그것을 통행증 삼아 다른 보드의 컬럼을 지울 수 있었다(실증됨). 삭제 전에
  // 반드시 소속을 확인한다 — repo 층이 board_id 없이 id 만으로 지우기 때문에 이 층이
  // 유일한 방어선이다.
  private async requireColumnInBoard(ctx: Ctx, boardId: string, columnId: string): Promise<void> {
    const columns = await (await this.repo).listColumns(ctx, boardId);
    if (!columns.some((c) => c.id === columnId))
      throw new NotFoundError("컬럼을 찾을 수 없습니다");
  }

  async updateColumn(ctx: Ctx, boardId: string, columnId: string, patch: ColumnPatch): Promise<BoardColumn> {
    await this.requireEditableBoard(ctx, boardId);
    await this.requireColumnInBoard(ctx, boardId, columnId);
    const col = await (await this.repo).updateColumn(ctx, columnId, patch);
    if (!col) throw new NotFoundError("컬럼을 찾을 수 없습니다");
    return col;
  }

  async deleteColumn(ctx: Ctx, boardId: string, columnId: string): Promise<void> {
    await this.requireEditableBoard(ctx, boardId);
    await this.requireColumnInBoard(ctx, boardId, columnId);
    if (!await (await this.repo).deleteColumn(ctx, columnId)) throw new NotFoundError("컬럼을 찾을 수 없습니다");
  }

  // ── 그룹 ──
  async addGroup(ctx: Ctx, boardId: string, input: NewGroup) {
    await this.requireEditableBoard(ctx, boardId);
    return (await this.repo).createGroup(ctx, boardId, input);
  }

  // ── 아이템 + 셀 ──
  // BBE-214 — 보드 메타(컬럼)와 아이템 목록은 서로 독립이다. 같이 발행한다.
  // 보드가 없으면 getBoardDetail 이 거부하므로 NotFoundError 는 그대로 나간다.
  async listItems(ctx: Ctx, boardId: string): Promise<ItemWithValues[]> {
    const [detail, items] = await Promise.all([
      this.getBoardDetail(ctx, boardId),
      this.repo.then((repo) => repo.listItems(ctx, boardId)),
    ]);
    return this.compose(ctx, items, detail.columns);
  }

  async listDeletedItems(ctx: Ctx, boardId: string): Promise<ItemWithValues[]> {
    const [detail, items] = await Promise.all([
      this.getBoardDetail(ctx, boardId),
      this.repo.then((repo) => repo.listDeletedItems(ctx, boardId)),
    ]);
    return this.compose(ctx, items, detail.columns);
  }

  async getItem(ctx: Ctx, boardId: string, itemId: string): Promise<ItemWithValues> {
    const detail = await this.getBoardDetail(ctx, boardId);
    const item = await (await this.repo).getItem(ctx, itemId);
    if (!item || item.board_id !== boardId)
      throw new NotFoundError("아이템을 찾을 수 없습니다");
    return (await this.compose(ctx, [item], detail.columns))[0];
  }

  async createItem(ctx: Ctx, boardId: string, input: NewItem): Promise<ItemWithValues> {
    const detail = await this.requireEditableBoardDetail(ctx, boardId);
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
    const item = await (await this.repo).createItem(ctx, boardId, { ...input, values });
    return (await this.compose(ctx, [item], detail.columns))[0];
  }

  async updateItem(ctx: Ctx, boardId: string, itemId: string, patch: ItemPatch): Promise<ItemWithValues> {
    await this.requireEditableBoard(ctx, boardId);
    const item = await (await this.repo).updateItem(ctx, itemId, patch);
    if (!item) throw new NotFoundError("아이템을 찾을 수 없습니다");
    return this.getItem(ctx, boardId, itemId);
  }

  async deleteItem(ctx: Ctx, boardId: string, itemId: string): Promise<void> {
    await this.requireEditableBoard(ctx, boardId);
    const repo = await this.repo;
    if (await repo.deleteItem(ctx, boardId, itemId)) return;
    const alreadyDeleted = (await repo.listDeletedItems(ctx, boardId)).some((item) => item.id === itemId);
    if (!alreadyDeleted) throw new NotFoundError("아이템을 찾을 수 없습니다");
  }

  async restoreItem(ctx: Ctx, boardId: string, itemId: string): Promise<ItemWithValues> {
    await this.requireEditableBoard(ctx, boardId);
    const repo = await this.repo;
    const restored = await repo.restoreItem(ctx, boardId, itemId);
    if (restored) return this.getItem(ctx, boardId, itemId);
    const active = await repo.getItem(ctx, itemId);
    if (!active || active.board_id !== boardId) throw new NotFoundError("휴지통에서 항목을 찾을 수 없습니다");
    return this.getItem(ctx, boardId, itemId);
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
  async setCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    patch: Record<string, CellValue>,
  ): Promise<SetCellsResult> {
    const detail = await this.requireEditableBoardDetail(ctx, boardId);
    const before = await this.getItem(ctx, boardId, itemId);

    const { values, errors } = this.validateValues(detail.columns, patch, true);
    const writtenKeys = Object.keys(values);
    if (writtenKeys.length === 0) {
      return { item: await this.getItem(ctx, boardId, itemId), errors, undo: null };
    }

    // 되돌리기용 이전 값 스냅샷 — 실제 쓰기 전에 떠 둔다.
    const beforeValues = (await this.getItem(ctx, boardId, itemId)).values;
    const undo: CellEditUndo = {
      values: Object.fromEntries(writtenKeys.map((k) => [k, beforeValues[k] ?? null])),
      group_id: before.group_id,
    };

    await (await this.repo).setValues(ctx, itemId, values);

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
      await (await this.repo).updateItem(ctx, itemId, { group_id: target });
    }

    return { item: await this.getItem(ctx, boardId, itemId), errors, undo };
  }

  /**
   * `setCells()` 가 돌려준 `undo` 를 그대로 적용해 편집 직전 상태로 되돌린다.
   * 값·group_id 를 **명시 복원**한다(이동 규칙 재평가에 기대지 않는다 — 이유는
   * `CellEditUndo` 주석 참고). 검증은 다시 하지 않는다 — 그 값들은 이미 한 번
   * 통과한 값이다.
   */
  async undoCells(
    ctx: Ctx,
    boardId: string,
    itemId: string,
    undo: CellEditUndo,
  ): Promise<ItemWithValues> {
    await this.requireEditableBoard(ctx, boardId);
    await this.getItem(ctx, boardId, itemId);
    if (
      undo.group_id !== null &&
      !(await (await this.repo).listGroups(ctx, boardId)).some((group) => group.id === undo.group_id)
    ) {
      throw new NotFoundError("그룹을 찾을 수 없습니다");
    }
    if (Object.keys(undo.values).length > 0) await (await this.repo).setValues(ctx, itemId, undo.values);
    await (await this.repo).updateItem(ctx, itemId, { group_id: undo.group_id });
    return this.getItem(ctx, boardId, itemId);
  }

  /**
   * 칸반 그룹핑 — groupBy 가 컬럼 key 면 그 select 값 기준, 아니면 board_groups 기준.
   * 빈 그룹도 반환(칸반 컬럼 유지).
   */
  async kanban(
    ctx: Ctx,
    boardId: string,
    groupBy?: string,
  ): Promise<{ key: string; label: string; color: string | null; items: ItemWithValues[] }[]> {
    const detail = await this.getBoardDetail(ctx, boardId);
    const items = await this.listItems(ctx, boardId);

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
  private async compose(ctx: Ctx, items: BoardItem[], columns: BoardColumn[]): Promise<ItemWithValues[]> {
    if (items.length === 0) return [];
    const keys = new Set(columns.map((c) => c.key));
    const values = await (await this.repo).listValues(ctx, items.map((i) => i.id));
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
  async listViews(ctx: Ctx, boardId: string): Promise<BoardView[]> {
    await this.requireBoard(ctx, boardId);
    return (await this.repo).listViews(ctx, boardId);
  }

  /**
   * 기본 뷰 — 규약: shared 우선 → name ASC → id ASC.
   * `board_views` 에 created_at/is_default 가 없어 확정된 결정적 규약(기획2 OQ-4 재판정).
   * T05 `lib/custom/views.ts` 의 `pickDefaultView` 를 그대로 재사용한다(2중 구현 금지).
   */
  async getDefaultView(ctx: Ctx, boardId: string): Promise<BoardView | null> {
    return pickDefaultView(await this.listViews(ctx, boardId));
  }

  async createView(ctx: Ctx, boardId: string, input: NewView): Promise<BoardView> {
    await this.requireBoard(ctx, boardId);
    return (await this.repo).createView(ctx, boardId, input);
  }

  async updateView(ctx: Ctx, viewId: string, patch: ViewPatch): Promise<BoardView> {
    const view = await (await this.repo).updateView(ctx, viewId, patch);
    if (!view) throw new NotFoundError("뷰를 찾을 수 없습니다");
    return view;
  }

  async deleteView(ctx: Ctx, viewId: string): Promise<void> {
    if (!await (await this.repo).deleteView(ctx, viewId)) throw new NotFoundError("뷰를 찾을 수 없습니다");
  }

  /** 보드 존재·가시성 확인(뷰는 시스템 보드에서도 허용 — 구조 편집이 아니므로). */
  private async requireBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const board = await (await this.repo).getBoard(ctx, boardId);
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
    enforceReadOnlySource = false,
  ): { values: Record<string, CellValue>; errors: CellError[] } {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const values: Record<string, CellValue> = {};
    const errors: CellError[] = [];

    for (const [key, raw] of Object.entries(patch)) {
      const col = byKey.get(key);
      if (!col) continue; // 정의되지 않은 컬럼은 무시(EAV 오염 방지)
      if (enforceReadOnlySource && !isSourceEditable(col.source)) {
        errors.push({ key, label: col.label, message: "자동으로 채워지는 칸은 직접 바꿀 수 없습니다" });
        continue;
      }
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
  private async requireEditableBoard(ctx: Ctx, boardId: string): Promise<Board> {
    const board = await (await this.repo).getBoard(ctx, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    if (board.is_system)
      throw new BoardRuleError(
        "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다",
      );
    return board;
  }

  private async requireEditableBoardDetail(ctx: Ctx, boardId: string): Promise<BoardDetail> {
    await this.requireEditableBoard(ctx, boardId);
    return this.getBoardDetail(ctx, boardId);
  }
}
