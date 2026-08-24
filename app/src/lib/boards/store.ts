/**
 * 임의 보드 저장소 포트 (T02b · 003).
 *
 * ⚠ 공용 계약 `@/lib/repo/index.ts` 는 변경하지 않는다(T03 합의 필요 — 단독 선행 PR).
 * 대신 보드 엔진 전용 포트를 여기 두고, 로컬 구현은 `@/lib/repo/local/boardsRepo.ts`.
 * Supabase 연결 시 같은 포트에 SupabaseBoardsRepo 를 끼운다.
 *
 * 담당범위(scope): items 는 003 RLS 와 동일 규칙 —
 *   owner/admin 또는 scope='all' → 보드의 전체 아이템,
 *   member+assigned → assigned_to = 본인 인 아이템만.
 * 보드/컬럼/그룹/뷰는 조직 멤버면 접근(003 정책과 동일).
 */

import type { Ctx, FieldOption, FieldType } from "@/lib/types";
import type { FieldSource } from "@/lib/field/source";
import type {
  Board,
  BoardColumn,
  BoardGroup,
  BoardItem,
  BoardView,
  BoardViewKind,
  CellValue,
  ItemValue,
} from "./types";
import type { DetailLayoutEntry } from "./detail-layout";

export interface NewBoard {
  name: string;
  description?: string | null;
  icon?: string | null;
  source?: string | null;
}
export type BoardPatch = Partial<NewBoard> & { sort_order?: number };

export interface DefaultDefinitionState {
  revision: number;
  columns: Record<string, {
    label: string;
    readOnly: boolean;
    rightPinned: boolean;
    sortOrder: number;
  }>;
}

export interface NewColumn {
  key?: string;
  label: string;
  type: FieldType;
  /** 미지정이면 "in"(직접 입력) — BoardsRepo 가 기본값을 채운다. */
  source?: FieldSource;
  rightPinned?: boolean;
  options?: FieldOption[] | null;
  width?: number | null;
  /** D68~D70 이동 규칙. types.ts 의 BoardColumn.move_rule_jsonb 참고. */
  moveRule?: Record<string, string> | null;
  /** 손으로 못 고치는 칸. types.ts 의 BoardColumn.is_readonly 참고. */
  readOnly?: boolean;
  /** Reconcile callers pass the next durable position so repeated GETs cannot reuse a stale length. */
  sortOrder?: number;
}
export interface ColumnPatch {
  label?: string;
  source?: FieldSource;
  rightPinned?: boolean;
  options?: FieldOption[] | null;
  sort_order?: number;
  width?: number | null;
  moveRule?: Record<string, string> | null;
  readOnly?: boolean;
}

export interface NewGroup {
  name: string;
  color?: string | null;
  sortOrder?: number;
}

export interface NewItem {
  title: string;
  group_id?: string | null;
  assigned_to?: string | null;
  values?: Record<string, CellValue>;
}
export interface ItemPatch {
  title?: string;
  group_id?: string | null;
  assigned_to?: string | null;
  sort_order?: number;
}

export interface NewView {
  name: string;
  kind: BoardViewKind;
  filters?: Record<string, unknown>;
  sort?: unknown[];
  visibleColumns?: unknown[];
  shared?: boolean;
}

/** 뷰 부분 수정 — board_id/user_id 는 이동 불가(소유·소속 고정). */
export type ViewPatch = Partial<NewView>;

export interface BoardsRepo {
  // 보드
  listBoards(ctx: Ctx): Promise<Board[]>;
  getBoard(ctx: Ctx, id: string): Promise<Board | undefined>;
  createBoard(ctx: Ctx, input: NewBoard, requestId?: string): Promise<Board>;
  updateBoard(ctx: Ctx, id: string, patch: BoardPatch): Promise<Board | undefined>;
  reorderBoards(ctx: Ctx, boardIds: readonly string[], requestId: string): Promise<Board[]>;
  /** Product-default baseline stored as system metadata, never as customer business values. */
  getDefaultDefinitionState?(ctx: Ctx, boardId: string): Promise<DefaultDefinitionState | null>;
  setDefaultDefinitionState?(ctx: Ctx, boardId: string, state: DefaultDefinitionState): Promise<void>;
  deleteBoard(ctx: Ctx, id: string): Promise<boolean>;
  setBoardDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[]): Promise<Board | undefined>;

  // 그룹(칸반 스윔레인)
  listGroups(ctx: Ctx, boardId: string): Promise<BoardGroup[]>;
  createGroup(ctx: Ctx, boardId: string, input: NewGroup): Promise<BoardGroup>;
  reorderGroups(ctx: Ctx, boardId: string, groupIds: readonly string[]): Promise<BoardGroup[]>;
  deleteGroup(ctx: Ctx, id: string): Promise<boolean>;
  setGroupDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[] | null): Promise<BoardGroup | undefined>;

  // 컬럼
  listColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]>;
  listArchivedColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]>;
  createColumn(ctx: Ctx, boardId: string, input: NewColumn): Promise<BoardColumn>;
  updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): Promise<BoardColumn | undefined>;
  deleteColumn(ctx: Ctx, id: string): Promise<boolean>;
  deleteColumn(ctx: Ctx, boardId: string, id: string): Promise<boolean>;
  restoreColumn(ctx: Ctx, boardId: string, id: string): Promise<BoardColumn | undefined>;

  // 아이템(담당범위 적용)
  listItems(ctx: Ctx, boardId: string): Promise<BoardItem[]>;
  listDeletedItems(ctx: Ctx, boardId: string): Promise<BoardItem[]>;
  getItem(ctx: Ctx, id: string): Promise<BoardItem | undefined>;
  createItem(ctx: Ctx, boardId: string, input: NewItem): Promise<BoardItem>;
  updateItem(ctx: Ctx, id: string, patch: ItemPatch): Promise<BoardItem | undefined>;
  deleteItem(ctx: Ctx, boardId: string, id: string): Promise<boolean>;
  restoreItem(ctx: Ctx, boardId: string, id: string): Promise<BoardItem | undefined>;

  // 셀 값(EAV)
  listValues(ctx: Ctx, itemIds: string[]): Promise<ItemValue[]>;
  setValues(ctx: Ctx, itemId: string, patch: Record<string, CellValue>): Promise<void>;

  // 뷰
  listViews(ctx: Ctx, boardId: string): Promise<BoardView[]>;
  getView(ctx: Ctx, id: string): Promise<BoardView | undefined>;
  createView(ctx: Ctx, boardId: string, input: NewView): Promise<BoardView>;
  updateView(ctx: Ctx, id: string, patch: ViewPatch): Promise<BoardView | undefined>;
  deleteView(ctx: Ctx, id: string): Promise<boolean>;

  // 그룹별 컬럼 배치(board_views 의 예약된 조직 공용 행)
  getGroupColumnOrder(ctx: Ctx, boardId: string): Promise<Record<string, string[]>>;
  setGroupColumnOrder(
    ctx: Ctx,
    boardId: string,
    groupKey: string,
    columnKeys: readonly string[],
  ): Promise<void>;
}
