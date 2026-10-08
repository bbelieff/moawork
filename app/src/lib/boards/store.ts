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
  BoardNavSection,
  BoardTrashImpact,
  BoardView,
  BoardViewKind,
  CellValue,
  DefaultTabDismissal,
  ItemValue,
} from "./types";
import type { DetailLayoutEntry } from "./detail-layout";
import type { BoardSummarySettingsReceipt, BoardSummarySettingsRequest } from "./summary-settings";

export interface NewBoard {
  name: string;
  description?: string | null;
  icon?: string | null;
  source?: string | null;
  /** 사용자 탭만: 사이드바 자리. 비우면 '계약 후'. source 가 있으면 무시된다. */
  nav_section?: BoardNavSection | null;
}
export type BoardPatch = Partial<Omit<NewBoard, "source">> & { sort_order?: number; source?: string | null };

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
export interface GroupPatch { name?: string; color?: string | null; }

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

export interface RowMoveRequest {
  itemId: string;
  targetGroupId: string | null;
  /** Insert immediately before this active target-group item; null appends. */
  beforeItemId: string | null;
  expectedVersion: number;
  requestId: string;
}

export interface RowMoveReceipt {
  itemId: string;
  targetGroupId: string | null;
  beforeItemId: string | null;
  version: number;
  replayed: boolean;
}

export interface AtomicValueMoveRequest extends RowMoveRequest {
  values: Record<string, CellValue>;
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
  // #849 휴지통 — 169. 지우기 = 휴지통(7일) → 완전 삭제. 기본 탭도 같다.
  /** 휴지통으로 보낸다. 이미 휴지통이면 그대로 돌려준다. 권한: danger.bulk_edit_delete. */
  trashBoard(ctx: Ctx, id: string): Promise<Board>;
  /** 휴지통에서 그대로 되살린다. 같은 기본 탭이 이미 다시 설치돼 있으면 막는다. */
  restoreBoard(ctx: Ctx, id: string): Promise<Board>;
  /** 휴지통 탭을 지금 완전히 지운다. 정리할 저장소 파일 수를 돌려준다. */
  purgeBoard(ctx: Ctx, id: string): Promise<number>;
  /** 7일 지난 휴지통 탭을 지운다(탭 관리 권한). 지운 탭 수. */
  purgeExpiredBoards(ctx: Ctx): Promise<number>;
  listTrashedBoards(ctx: Ctx): Promise<Board[]>;
  readBoardTrashImpact(ctx: Ctx, id: string): Promise<BoardTrashImpact>;
  listDefaultTabDismissals(ctx: Ctx): Promise<DefaultTabDismissal[]>;
  /** 지운 기본 탭 기록을 지운다(다시 설치 전 단계). 기록이 있었으면 true. */
  clearDefaultTabDismissal(ctx: Ctx, source: string): Promise<boolean>;
  listStoragePurgeQueue(ctx: Ctx, limit?: number): Promise<string[]>;
  ackStoragePurge(ctx: Ctx, paths: readonly string[]): Promise<number>;
  setBoardDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[]): Promise<Board | undefined>;
  applyBoardSummarySettings(ctx: Ctx, boardId: string, request: BoardSummarySettingsRequest): Promise<BoardSummarySettingsReceipt>;

  // 그룹(칸반 스윔레인)
  listGroups(ctx: Ctx, boardId: string): Promise<BoardGroup[]>;
  createGroup(ctx: Ctx, boardId: string, input: NewGroup): Promise<BoardGroup>;
  updateGroup(ctx: Ctx, boardId: string, id: string, patch: GroupPatch): Promise<BoardGroup | undefined>;
  reorderGroups(ctx: Ctx, boardId: string, groupIds: readonly string[]): Promise<BoardGroup[]>;
  deleteGroup(ctx: Ctx, id: string): Promise<boolean>;
  setGroupDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[] | null): Promise<BoardGroup | undefined>;

  // 컬럼
  listColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]>;
  listArchivedColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]>;
  createColumn(ctx: Ctx, boardId: string, input: NewColumn): Promise<BoardColumn>;
  updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): Promise<BoardColumn | undefined>;
  reorderColumns(ctx: Ctx, boardId: string, columnIds: readonly string[]): Promise<BoardColumn[]>;
  deleteColumn(ctx: Ctx, id: string): Promise<boolean>;
  deleteColumn(ctx: Ctx, boardId: string, id: string): Promise<boolean>;
  restoreColumn(ctx: Ctx, boardId: string, id: string): Promise<BoardColumn | undefined>;

  // 아이템(담당범위 적용)
  // listItems/getItem/updateItem/deleteItem/setValues 는 보관 행을 다루지 않는다
  // (보관은 listArchivedItems/getArchivedItem + 보관 RPC로만 읽고 되돌린다).
  listItems(ctx: Ctx, boardId: string): Promise<BoardItem[]>;
  listDeletedItems(ctx: Ctx, boardId: string): Promise<BoardItem[]>;
  listArchivedItems(ctx: Ctx, boardId: string): Promise<BoardItem[]>;
  getItem(ctx: Ctx, id: string): Promise<BoardItem | undefined>;
  getArchivedItem(ctx: Ctx, id: string): Promise<BoardItem | undefined>;
  createItem(ctx: Ctx, boardId: string, input: NewItem): Promise<BoardItem>;
  updateItem(ctx: Ctx, id: string, patch: ItemPatch): Promise<BoardItem | undefined>;
  moveRowAtomic(ctx: Ctx, boardId: string, request: RowMoveRequest): Promise<RowMoveReceipt>;
  setValuesAndMoveAtomic(ctx: Ctx, boardId: string, request: AtomicValueMoveRequest): Promise<RowMoveReceipt>;
  reconcileDefinitionItemGroup(ctx: Ctx, boardId: string, itemId: string, expectedSourceGroupId: string | null, targetGroupId: string): Promise<void>;
  deleteItem(ctx: Ctx, boardId: string, id: string): Promise<boolean>;
  restoreItem(ctx: Ctx, boardId: string, id: string): Promise<BoardItem | undefined>;

  /**
   * Issue 857 — 행과 그 셀 값을 한 번에(한 왕복) 읽는다. 보드 화면 스냅샷만 쓴다.
   * 없으면(로컬 저장소) 서비스가 행 → 값 두 번으로 읽는다. 범위는 listItems/listDeletedItems/listArchivedItems 와 같다.
   */
  listItemsWithValues?(ctx: Ctx, boardId: string, scope: "active" | "deleted" | "archived"): Promise<{ items: BoardItem[]; values: ItemValue[] }>;

  // 셀 값(EAV)
  listValues(ctx: Ctx, itemIds: string[]): Promise<ItemValue[]>;
  setValues(ctx: Ctx, itemId: string, patch: Record<string, CellValue>): Promise<void>;
  /**
   * 이 보드·칸에 켜진 발송 규칙(041 `messaging_trigger_rules`)이 하나라도 있는가 — 2026-10-06(#845).
   * 값을 «암묵적으로» 쓰는 경로(드래그 → 단계 역동기화)가 고객 발송을 일으키지 않게 미리 본다.
   * 읽지 못하면 던진다(호출부가 «있다» 로 닫는다). 구현이 없는 저장소도 호출부는 «있다» 로 본다.
   */
  hasEnabledMessagingTriggerRules?(ctx: Ctx, boardId: string, columnKey: string): Promise<boolean>;

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
