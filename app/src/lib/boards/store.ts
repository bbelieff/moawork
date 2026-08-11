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

export interface NewBoard {
  name: string;
  description?: string | null;
  icon?: string | null;
}
export type BoardPatch = Partial<NewBoard> & { sort_order?: number };

export interface NewColumn {
  key?: string;
  label: string;
  type: FieldType;
  options?: FieldOption[] | null;
  width?: number | null;
  /** D68~D70 이동 규칙. types.ts 의 BoardColumn.move_rule_jsonb 참고. */
  moveRule?: Record<string, string> | null;
  /** 손으로 못 고치는 칸. types.ts 의 BoardColumn.is_readonly 참고. */
  readOnly?: boolean;
}
export interface ColumnPatch {
  label?: string;
  options?: FieldOption[] | null;
  sort_order?: number;
  width?: number | null;
  moveRule?: Record<string, string> | null;
  readOnly?: boolean;
}

export interface NewGroup {
  name: string;
  color?: string | null;
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
  listBoards(ctx: Ctx): Board[];
  getBoard(ctx: Ctx, id: string): Board | undefined;
  createBoard(ctx: Ctx, input: NewBoard): Board;
  updateBoard(ctx: Ctx, id: string, patch: BoardPatch): Board | undefined;
  deleteBoard(ctx: Ctx, id: string): boolean;

  // 그룹(칸반 스윔레인)
  listGroups(ctx: Ctx, boardId: string): BoardGroup[];
  createGroup(ctx: Ctx, boardId: string, input: NewGroup): BoardGroup;
  deleteGroup(ctx: Ctx, id: string): boolean;

  // 컬럼
  listColumns(ctx: Ctx, boardId: string): BoardColumn[];
  createColumn(ctx: Ctx, boardId: string, input: NewColumn): BoardColumn;
  updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): BoardColumn | undefined;
  deleteColumn(ctx: Ctx, id: string): boolean;

  // 아이템(담당범위 적용)
  listItems(ctx: Ctx, boardId: string): BoardItem[];
  getItem(ctx: Ctx, id: string): BoardItem | undefined;
  createItem(ctx: Ctx, boardId: string, input: NewItem): BoardItem;
  updateItem(ctx: Ctx, id: string, patch: ItemPatch): BoardItem | undefined;
  deleteItem(ctx: Ctx, id: string): boolean;

  // 셀 값(EAV)
  listValues(ctx: Ctx, itemIds: string[]): ItemValue[];
  setValues(ctx: Ctx, itemId: string, patch: Record<string, CellValue>): void;

  // 뷰
  listViews(ctx: Ctx, boardId: string): BoardView[];
  getView(ctx: Ctx, id: string): BoardView | undefined;
  createView(ctx: Ctx, boardId: string, input: NewView): BoardView;
  updateView(ctx: Ctx, id: string, patch: ViewPatch): BoardView | undefined;
  deleteView(ctx: Ctx, id: string): boolean;
}
