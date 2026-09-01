/**
 * 003 임의 보드 엔진 — 로컬(인메모리) 어댑터. (T02b · ADR-0003)
 * 포트: `@/lib/boards/store`. 저장소: 공용 `db()` (repo/local/store.ts 확장분).
 * Supabase 연결 후 SupabaseBoardsRepo 로 교체(포트 뒤 스왑).
 */

import type { Ctx } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import type {
  Board,
  BoardColumn,
  BoardGroup,
  BoardItem,
  BoardView,
  CellValue,
  ItemValue,
} from "@/lib/boards/types";
import { isSectionPresetSource } from "@/lib/presets/section-presets";
import { normalizeDetailLayout, type DetailLayoutEntry } from "@/lib/boards/detail-layout";
import {
  decodeGroupColumnOrder,
  encodeGroupColumnOrder,
  GROUP_LAYOUT_MARKER,
  GROUP_LAYOUT_VIEW_NAME,
  isGroupLayoutView,
} from "@/lib/boards/group-layout-store";
import type {
  AtomicValueMoveRequest,
  BoardPatch,
  BoardsRepo,
  GroupPatch,
  ColumnPatch,
  DefaultDefinitionState,
  ItemPatch,
  NewBoard,
  NewColumn,
  NewGroup,
  NewItem,
  NewView,
  RowMoveReceipt,
  RowMoveRequest,
  ViewPatch,
} from "@/lib/boards/store";
import { db } from "./store";
import {
  applyBoardSummarySettingsIntent,
  type BoardSummarySettingsRequest,
  type BoardSummarySettingsReceipt,
} from "@/lib/boards/summary-settings";

function now(): string {
  return new Date().toISOString();
}

/** 담당범위: owner/admin 또는 scope='all' → 전체, member+assigned → 본인 것만. */
function canSeeAll(ctx: Ctx): boolean {
  return isManager(ctx.role) || ctx.scope === "all";
}

/** 라벨 → 컬럼 key slug(유니코드 보존). 보드 내 유일성은 호출측에서 보장. */
export function slugifyKey(label: string): string {
  const base = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
  return base === "" ? "col" : base;
}

export class LocalBoardsRepo {
  private readonly createdBoardRequests = new Map<string, { input: string; boardId: string }>();
  private readonly reorderedBoardRequests = new Map<string, string>();
  private readonly summaryRequests = new Map<string, { actorId: string; payload: string; result: BoardSummarySettingsReceipt }>();
  private readonly rowMoveRequests = new Map<string, { actorId: string; payload: string; result: RowMoveReceipt }>();
  // ── 보드 ──
  listBoards(ctx: Ctx): Board[] {
    return db()
      .boards.filter((b) => b.org_id === ctx.org.id && !isSectionPresetSource(b.source))
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  listSectionPresetBoards(ctx: Ctx): Board[] {
    return db()
      .boards.filter((b) => b.org_id === ctx.org.id && isSectionPresetSource(b.source))
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  getBoard(ctx: Ctx, id: string): Board | undefined {
    return db().boards.find((b) => b.id === id && b.org_id === ctx.org.id);
  }

  createBoard(ctx: Ctx, input: NewBoard, requestId = crypto.randomUUID()): Board {
    const requestKey = `${ctx.org.id}:${requestId}`;
    const payload = JSON.stringify(input);
    const prior = this.createdBoardRequests.get(requestKey);
    if (prior) {
      if (prior.input !== payload) throw new Error("보드 생성 요청을 다시 확인해 주세요.");
      const replayed = this.getBoard(ctx, prior.boardId);
      if (!replayed) throw new Error("생성한 보드를 찾을 수 없습니다.");
      return replayed;
    }
    const ts = now();
    const board: Board = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      is_system: false,
      source: input.source ?? null,
      sort_order: db().boards.filter((b) => b.org_id === ctx.org.id).length,
      created_by: ctx.user.id,
      created_at: ts,
      updated_at: ts,
      summary_config_jsonb: [],
      row_order_version: 0,
    };
    db().boards.push(board);
    this.createdBoardRequests.set(requestKey, { input: payload, boardId: board.id });
    return board;
  }

  updateBoard(ctx: Ctx, id: string, patch: BoardPatch): Board | undefined {
    const b = this.getBoard(ctx, id);
    if (!b) return undefined;
    Object.assign(b, patch);
    b.updated_at = now();
    return b;
  }

  applyBoardSummarySettings(ctx: Ctx, boardId: string, request: BoardSummarySettingsRequest): BoardSummarySettingsReceipt {
    const board = this.getBoard(ctx, boardId);
    if (!board || board.is_system) throw new Error("보드를 찾을 수 없습니다.");
    const requestKey = `${ctx.org.id}:${request.requestId}`;
    const payload = JSON.stringify({ boardId, intent: request.intent });
    const prior = this.summaryRequests.get(requestKey);
    if (prior) {
      if (prior.actorId !== ctx.user.id || prior.payload !== payload) throw new Error("요약 설정 요청 식별자가 다른 변경에 사용되었습니다.");
      return { config: prior.result.config.map((entry) => ({ ...entry })), replayed: true };
    }
    const columns = this.listColumns(ctx, boardId);
    const config = applyBoardSummarySettingsIntent(board.summary_config_jsonb, request, columns);
    board.summary_config_jsonb = config;
    board.updated_at = now();
    const result = { config: config.map((entry) => ({ ...entry })), replayed: false };
    this.summaryRequests.set(requestKey, { actorId: ctx.user.id, payload, result });
    return result;
  }

  reorderBoards(ctx: Ctx, boardIds: readonly string[], requestId: string): Board[] {
    const requestKey = `${ctx.org.id}:${requestId}`;
    const payload = JSON.stringify(boardIds);
    const prior = this.reorderedBoardRequests.get(requestKey);
    if (prior) {
      if (prior !== payload) throw new Error("보드 순서 요청을 다시 확인해 주세요.");
      return this.listBoards(ctx);
    }
    const editable = this.listBoards(ctx).filter((board) => !board.is_system);
    const expected = editable.map((board) => board.id).sort();
    const supplied = [...new Set(boardIds)].sort();
    if (expected.length !== supplied.length || expected.some((id, index) => id !== supplied[index])) {
      throw new Error("보드 순서를 저장할 대상을 다시 확인해 주세요.");
    }
    const rank = new Map(boardIds.map((id, index) => [id, index]));
    for (const board of editable) board.sort_order = rank.get(board.id) ?? board.sort_order;
    this.reorderedBoardRequests.set(requestKey, payload);
    return this.listBoards(ctx);
  }

  getDefaultDefinitionState(ctx: Ctx, boardId: string): DefaultDefinitionState | null {
    const view = db().boardViews.find((candidate) => candidate.org_id === ctx.org.id
      && candidate.board_id === boardId && candidate.user_id === null
      && candidate.name === "__mw_default_definition__");
    return ((view?.filters_jsonb as { state?: DefaultDefinitionState } | undefined)?.state) ?? null;
  }

  setDefaultDefinitionState(ctx: Ctx, boardId: string, state: DefaultDefinitionState): void {
    const existing = db().boardViews.find((candidate) => candidate.org_id === ctx.org.id
      && candidate.board_id === boardId && candidate.user_id === null
      && candidate.name === "__mw_default_definition__");
    if (existing) {
      existing.filters_jsonb = { system: "default-definition-state-v1", state };
      return;
    }
    db().boardViews.push({
      id: crypto.randomUUID(), org_id: ctx.org.id, board_id: boardId, user_id: null,
      name: "__mw_default_definition__", kind: "table",
      filters_jsonb: { system: "default-definition-state-v1", state }, sort_jsonb: [],
      visible_columns_jsonb: [], shared: false,
    });
  }

  deleteBoard(ctx: Ctx, id: string): boolean {
    const b = this.getBoard(ctx, id);
    if (!b) return false;
    const d = db();
    d.boards = d.boards.filter((x) => x.id !== id);
    const itemIds = d.boardItems.filter((i) => i.board_id === id).map((i) => i.id);
    d.boardItems = d.boardItems.filter((i) => i.board_id !== id);
    d.itemValues = d.itemValues.filter((v) => !itemIds.includes(v.item_id));
    d.boardColumns = d.boardColumns.filter((c) => c.board_id !== id);
    d.boardGroups = d.boardGroups.filter((g) => g.board_id !== id);
    d.boardViews = d.boardViews.filter((v) => v.board_id !== id);
    return true;
  }

  setBoardDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[]): Board | undefined {
    const board = this.getBoard(ctx, id);
    if (!board) return undefined;
    board.detail_layout_jsonb = normalizeDetailLayout(layout);
    board.updated_at = now();
    return board;
  }

  // ── 그룹 ──
  listGroups(ctx: Ctx, boardId: string): BoardGroup[] {
    return db()
      .boardGroups.filter((g) => g.org_id === ctx.org.id && g.board_id === boardId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  createGroup(ctx: Ctx, boardId: string, input: NewGroup): BoardGroup {
    const groups = this.listGroups(ctx, boardId);
    const group: BoardGroup = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      name: input.name,
      color: input.color ?? null,
      sort_order: input.sortOrder ?? (groups.length === 0 ? 0 : Math.max(...groups.map((group) => group.sort_order)) + 1),
    };
    db().boardGroups.push(group);
    return group;
  }

  updateGroup(ctx: Ctx, boardId: string, id: string, patch: GroupPatch): BoardGroup | undefined {
    const group = db().boardGroups.find((candidate) =>
      candidate.id === id && candidate.org_id === ctx.org.id && candidate.board_id === boardId,
    );
    if (!group) return undefined;
    if (patch.name !== undefined) group.name = patch.name;
    if (patch.color !== undefined) group.color = patch.color;
    return group;
  }

  reorderGroups(ctx: Ctx, boardId: string, groupIds: readonly string[]): BoardGroup[] {
    const groups = this.listGroups(ctx, boardId);
    if (groupIds.length !== groups.length || new Set(groupIds).size !== groups.length
      || groups.some((group) => !groupIds.includes(group.id))) {
      throw new Error("그룹 순서가 현재 보드와 일치하지 않습니다.");
    }
    const byId = new Map(groups.map((group) => [group.id, group]));
    groupIds.forEach((id, index) => { byId.get(id)!.sort_order = index; });
    return this.listGroups(ctx, boardId);
  }

  deleteGroup(ctx: Ctx, id: string): boolean {
    const d = db();
    const g = d.boardGroups.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!g) return false;
    d.boardGroups = d.boardGroups.filter((x) => x.id !== id);
    // 003: on delete set null
    for (const it of d.boardItems) if (it.group_id === id) it.group_id = null;
    return true;
  }

  setGroupDetailLayout(
    ctx: Ctx,
    id: string,
    layout: DetailLayoutEntry[] | null,
  ): BoardGroup | undefined {
    const group = db().boardGroups.find((candidate) => candidate.id === id && candidate.org_id === ctx.org.id);
    if (!group) return undefined;
    group.detail_layout_jsonb = layout === null ? null : normalizeDetailLayout(layout);
    return group;
  }

  // ── 컬럼 ──
  listColumns(ctx: Ctx, boardId: string): BoardColumn[] {
    return db()
      .boardColumns.filter((c) => c.org_id === ctx.org.id && c.board_id === boardId && !c.archived_at)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  listArchivedColumns(ctx: Ctx, boardId: string): BoardColumn[] {
    return db().boardColumns
      .filter((c) => c.org_id === ctx.org.id && c.board_id === boardId && Boolean(c.archived_at))
      .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
  }

  createColumn(ctx: Ctx, boardId: string, input: NewColumn): BoardColumn {
    const existing = db().boardColumns.filter((c) => c.org_id === ctx.org.id && c.board_id === boardId);
    // (board_id, key) unique — 충돌 시 접미사.
    const base = input.key?.trim() || slugifyKey(input.label);
    let key = base;
    let n = 2;
    while (existing.some((c) => c.key === key)) key = `${base}_${n++}`;

    const col: BoardColumn = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      key,
      label: input.label,
      type: input.type,
      source: input.source ?? "in",
      rightPinned: input.rightPinned ?? false,
      options_jsonb: input.options ? { options: input.options } : null,
      sort_order: input.sortOrder ?? existing.length,
      width: input.width ?? null,
      move_rule_jsonb: input.moveRule ?? null,
      is_readonly: input.readOnly ?? false,
    };
    db().boardColumns.push(col);
    return col;
  }

  updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): BoardColumn | undefined {
    const c = db().boardColumns.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!c) return undefined;
    if (patch.label !== undefined) c.label = patch.label;
    if (patch.source !== undefined) c.source = patch.source;
    if (patch.rightPinned !== undefined) c.rightPinned = patch.rightPinned;
    if (patch.sort_order !== undefined) c.sort_order = patch.sort_order;
    if (patch.width !== undefined) c.width = patch.width;
    if (patch.options !== undefined)
      c.options_jsonb = patch.options ? { options: patch.options } : null;
    if (patch.moveRule !== undefined) c.move_rule_jsonb = patch.moveRule;
    if (patch.readOnly !== undefined) c.is_readonly = patch.readOnly;
    return c;
  }

  reorderColumns(ctx: Ctx, boardId: string, columnIds: readonly string[]): BoardColumn[] {
    const board=this.getBoard(ctx,boardId);if(!board||board.is_system)return[];
    const active=this.listColumns(ctx,boardId);
    if(columnIds.length!==active.length||new Set(columnIds).size!==active.length||columnIds.some((id)=>!active.some((column)=>column.id===id)))throw new Error("컬럼 순서를 확인할 수 없습니다.");
    const rank=new Map(columnIds.map((id,index)=>[id,index]));for(const column of active)column.sort_order=rank.get(column.id)!;
    return this.listColumns(ctx,boardId);
  }

  /**
   * 컬럼 정의만 지운다 — 셀 값(`itemValues`)은 남긴다 (BBE-177).
   * 근거와 배경은 supabase 어댑터의 같은 메서드 주석에 적었다. 두 어댑터가 어긋나면
   * 로컬 폴백에서만 값이 사라져 재현이 안 되는 차이가 생기므로 동작을 맞춰 둔다.
   */
  deleteColumn(ctx: Ctx, id: string): boolean;
  deleteColumn(ctx: Ctx, boardId: string, id: string): boolean;
  deleteColumn(ctx: Ctx, boardIdOrId: string, columnId?: string): boolean {
    const d = db();
    const id = columnId ?? boardIdOrId;
    const boardId = columnId === undefined ? undefined : boardIdOrId;
    if (boardId !== undefined) {
      const board = d.boards.find((candidate) =>
        candidate.id === boardId && candidate.org_id === ctx.org.id,
      );
      if (!board || board.is_system) return false;
    }
    const c = d.boardColumns.find((x) =>
      x.id === id &&
      x.org_id === ctx.org.id &&
      (boardId === undefined || x.board_id === boardId),
    );
    if (!c) return false;
    c.archived_at = now();
    c.deleted_by = ctx.user.id;
    return true;
  }

  restoreColumn(ctx: Ctx, boardId: string, id: string): BoardColumn | undefined {
    const c = db().boardColumns.find((x) =>
      x.id === id && x.org_id === ctx.org.id && x.board_id === boardId && Boolean(x.archived_at),
    );
    if (!c) return undefined;
    const active = this.listColumns(ctx, boardId);
    const nextPosition = active.length === 0 ? 0 : Math.max(...active.map((column) => column.sort_order)) + 1;
    c.archived_at = null;
    c.deleted_by = null;
    c.sort_order = nextPosition;
    return c;
  }

  // ── 아이템(담당범위) ──
  listItems(ctx: Ctx, boardId: string): BoardItem[] {
    const all = db()
      .boardItems.filter((i) => i.org_id === ctx.org.id && i.board_id === boardId && !i.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order);
    return canSeeAll(ctx) ? all : all.filter((i) => i.assigned_to === ctx.user.id);
  }

  listDeletedItems(ctx: Ctx, boardId: string): BoardItem[] {
    const all = db()
      .boardItems.filter((i) => i.org_id === ctx.org.id && i.board_id === boardId && Boolean(i.deleted_at))
      .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    return canSeeAll(ctx) ? all : all.filter((i) => i.assigned_to === ctx.user.id);
  }

  getItem(ctx: Ctx, id: string): BoardItem | undefined {
    const i = db().boardItems.find((x) => x.id === id && x.org_id === ctx.org.id && !x.deleted_at);
    if (!i) return undefined;
    return canSeeAll(ctx) || i.assigned_to === ctx.user.id ? i : undefined;
  }

  createItem(ctx: Ctx, boardId: string, input: NewItem): BoardItem {
    // member+assigned 는 타인에게 배정 불가 → 본인으로 강제.
    const assigned = canSeeAll(ctx) ? (input.assigned_to ?? null) : ctx.user.id;
    const ts = now();
    const item: BoardItem = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      group_id: input.group_id ?? null,
      title: input.title,
      assigned_to: assigned,
      // BBE-235 트리거(099)는 hosted 전용 — 로컬 repo 로 만든 아이템은 자금건과 연결될 방법이
      // 없으니 항상 null(= BBE-240 원장 버튼은 로컬/데모에서는 안 뜬다, 의도된 제약).
      deal_id: null,
      sort_order: db().boardItems.filter((i) => i.board_id === boardId).length,
      deleted_at: null,
      deleted_by: null,
      created_at: ts,
      updated_at: ts,
    };
    db().boardItems.push(item);
    if (input.values) this.setValues(ctx, item.id, input.values);
    return item;
  }

  updateItem(ctx: Ctx, id: string, patch: ItemPatch): BoardItem | undefined {
    const i = this.getItem(ctx, id);
    if (!i) return undefined;
    const { assigned_to, ...rest } = patch;
    Object.assign(i, rest);
    if (assigned_to !== undefined && canSeeAll(ctx)) i.assigned_to = assigned_to;
    i.updated_at = now();
    return i;
  }

  moveRowAtomic(ctx: Ctx, boardId: string, request: RowMoveRequest): RowMoveReceipt {
    const board = this.getBoard(ctx, boardId);
    if (!board || board.is_system) throw new Error("보드를 찾을 수 없습니다.");
    if (!canSeeAll(ctx)) throw new Error("전체 행을 볼 수 있는 사용자만 행 순서를 바꿀 수 있습니다.");
    const requestKey = `${ctx.org.id}:${request.requestId}`;
    const payload = JSON.stringify({ boardId, ...request });
    const prior = this.rowMoveRequests.get(requestKey);
    if (prior) {
      if (prior.actorId !== ctx.user.id || prior.payload !== payload) {
        throw new Error("행 이동 요청 식별자가 다른 변경에 사용되었습니다.");
      }
      return { ...prior.result, replayed: true };
    }
    const currentVersion = board.row_order_version ?? 0;
    if (request.expectedVersion !== currentVersion) throw new Error("행 순서가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    const moving = db().boardItems.find((item) => item.id === request.itemId
      && item.org_id === ctx.org.id && item.board_id === boardId && item.deleted_at == null);
    if (!moving) throw new Error("아이템을 찾을 수 없습니다.");
    if (request.targetGroupId !== null && !db().boardGroups.some((group) => group.id === request.targetGroupId
      && group.org_id === ctx.org.id && group.board_id === boardId)) throw new Error("대상 그룹을 찾을 수 없습니다.");
    if (request.beforeItemId === request.itemId) throw new Error("같은 행 앞에는 놓을 수 없습니다.");
    const originalTargetIds = db().boardItems
      .filter((item) => item.org_id === ctx.org.id && item.board_id === boardId && item.deleted_at == null
        && item.group_id === request.targetGroupId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .map((item) => item.id);
    const target = db().boardItems
      .filter((item) => item.org_id === ctx.org.id && item.board_id === boardId && item.deleted_at == null
        && item.group_id === request.targetGroupId && item.id !== request.itemId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    let at = target.length;
    if (request.beforeItemId !== null) {
      at = target.findIndex((item) => item.id === request.beforeItemId);
      if (at < 0) throw new Error("놓을 위치가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    const sourceGroupId = moving.group_id;
    target.splice(at, 0, moving);
    if (sourceGroupId === request.targetGroupId
      && target.length === originalTargetIds.length
      && target.every((item,index)=>item.id===originalTargetIds[index])) {
      return {
        itemId: request.itemId,
        targetGroupId: request.targetGroupId,
        beforeItemId: request.beforeItemId,
        version: currentVersion,
        replayed: false,
      };
    }
    const source = sourceGroupId === request.targetGroupId ? [] : db().boardItems
      .filter((item) => item.org_id === ctx.org.id && item.board_id === boardId && item.deleted_at == null
        && item.group_id === sourceGroupId && item.id !== request.itemId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    moving.group_id = request.targetGroupId;
    target.forEach((item, index) => { item.sort_order = index; item.updated_at = now(); });
    source.forEach((item, index) => { item.sort_order = index; item.updated_at = now(); });
    board.row_order_version = currentVersion + 1;
    board.updated_at = now();
    const result: RowMoveReceipt = {
      itemId: request.itemId,
      targetGroupId: request.targetGroupId,
      beforeItemId: request.beforeItemId,
      version: board.row_order_version,
      replayed: false,
    };
    this.rowMoveRequests.set(requestKey, { actorId: ctx.user.id, payload, result });
    return result;
  }

  setValuesAndMoveAtomic(ctx: Ctx, boardId: string, request: AtomicValueMoveRequest): RowMoveReceipt {
    const data=db();
    const itemSnapshot=structuredClone(data.boardItems);
    const valueSnapshot=structuredClone(data.itemValues);
    const boardSnapshot=structuredClone(data.boards);
    const requestKey=`${ctx.org.id}:${request.requestId}`;
    const priorReceipt=this.rowMoveRequests.get(requestKey);
    try{
      const receipt = this.moveRowAtomic(ctx, boardId, request);
      this.setValues(ctx, request.itemId, request.values);
      return receipt;
    }catch(error){
      data.boardItems=itemSnapshot;
      data.itemValues=valueSnapshot;
      data.boards=boardSnapshot;
      if(priorReceipt)this.rowMoveRequests.set(requestKey,priorReceipt);
      else this.rowMoveRequests.delete(requestKey);
      throw error;
    }
  }

  reconcileDefinitionItemGroup(ctx:Ctx,boardId:string,itemId:string,expectedSourceGroupId:string|null,targetGroupId:string):void{
    const board=this.getBoard(ctx,boardId);const item=this.getItem(ctx,itemId);
    if(!board||board.is_system||!item||item.board_id!==boardId||item.group_id!==expectedSourceGroupId||
      !(board.source?.startsWith("core.default-tab/")||board.source?.startsWith("pack.")))throw new Error("정본 보드 그룹 조정을 확인할 수 없습니다.");
    this.moveRowAtomic(ctx,boardId,{itemId,targetGroupId,beforeItemId:null,expectedVersion:board.row_order_version??0,requestId:crypto.randomUUID()});
  }

  deleteItem(ctx: Ctx, boardId: string, id: string): boolean {
    const i = this.getItem(ctx, id);
    if (i?.board_id !== boardId) return false;
    if (!i) return false;
    i.deleted_at = now();
    i.deleted_by = ctx.user.id;
    i.updated_at = now();
    return true;
  }

  restoreItem(ctx: Ctx, boardId: string, id: string): BoardItem | undefined {
    const i = db().boardItems.find(
      (candidate) => candidate.id === id
        && candidate.board_id === boardId
        && candidate.org_id === ctx.org.id
        && Boolean(candidate.deleted_at),
    );
    if (!i || (!canSeeAll(ctx) && i.assigned_to !== ctx.user.id)) return undefined;
    i.deleted_at = null;
    i.deleted_by = null;
    i.updated_at = now();
    return i;
  }

  // ── 셀 값 ──
  listValues(ctx: Ctx, itemIds: string[]): ItemValue[] {
    const set = new Set(itemIds);
    return db().itemValues.filter((v) => v.org_id === ctx.org.id && set.has(v.item_id));
  }

  setValues(ctx: Ctx, itemId: string, patch: Record<string, CellValue>): void {
    if (!this.getItem(ctx, itemId)) return; // 가시성 없는 아이템은 무시
    const d = db();
    for (const [column_key, value_jsonb] of Object.entries(patch)) {
      const existing = d.itemValues.find(
        (v) => v.item_id === itemId && v.column_key === column_key,
      );
      if (existing) existing.value_jsonb = value_jsonb;
      else d.itemValues.push({ org_id: ctx.org.id, item_id: itemId, column_key, value_jsonb });
    }
    const item = d.boardItems.find((i) => i.id === itemId);
    if (item) item.updated_at = now();
  }

  // ── 뷰 ──
  listViews(ctx: Ctx, boardId: string): BoardView[] {
    return db().boardViews.filter(
      (v) =>
        v.org_id === ctx.org.id &&
        v.board_id === boardId &&
        (v.shared || v.user_id === ctx.user.id || v.user_id === null) &&
        !isGroupLayoutView(v) &&
        v.name !== "__mw_default_definition__",
    );
  }

  /** 단건 조회 — 가시성 규칙은 listViews 와 동일(공유뷰 ∪ 내 개인뷰). */
  getView(ctx: Ctx, id: string): BoardView | undefined {
    return db().boardViews.find(
      (v) =>
        v.id === id &&
        v.org_id === ctx.org.id &&
        (v.shared || v.user_id === ctx.user.id || v.user_id === null) &&
        !isGroupLayoutView(v) &&
        v.name !== "__mw_default_definition__",
    );
  }

  createView(ctx: Ctx, boardId: string, input: NewView): BoardView {
    const view: BoardView = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      board_id: boardId,
      user_id: ctx.user.id,
      name: input.name,
      kind: input.kind,
      filters_jsonb: input.filters ?? {},
      sort_jsonb: input.sort ?? [],
      visible_columns_jsonb: input.visibleColumns ?? [],
      shared: input.shared ?? false,
    };
    db().boardViews.push(view);
    return view;
  }

  updateView(ctx: Ctx, id: string, patch: ViewPatch): BoardView | undefined {
    const v = db().boardViews.find(
      (candidate) =>
        candidate.id === id &&
        candidate.org_id === ctx.org.id &&
        candidate.user_id === ctx.user.id,
    );
    if (!v || isGroupLayoutView(v)) return undefined;
    if (patch.name !== undefined) v.name = patch.name;
    if (patch.kind !== undefined) v.kind = patch.kind;
    if (patch.filters !== undefined) v.filters_jsonb = patch.filters;
    if (patch.sort !== undefined) v.sort_jsonb = patch.sort;
    if (patch.visibleColumns !== undefined) v.visible_columns_jsonb = patch.visibleColumns;
    if (patch.shared !== undefined) v.shared = patch.shared;
    return v;
  }

  deleteView(ctx: Ctx, id: string): boolean {
    const d = db();
    const v = d.boardViews.find(
      (x) => x.id === id && x.org_id === ctx.org.id && x.user_id === ctx.user.id,
    );
    if (!v || isGroupLayoutView(v)) return false;
    d.boardViews = d.boardViews.filter((x) => x.id !== id);
    return true;
  }

  getGroupColumnOrder(ctx: Ctx, boardId: string): Record<string, string[]> {
    const view = db().boardViews.find(
      (candidate) => candidate.org_id === ctx.org.id
        && candidate.board_id === boardId
        && isGroupLayoutView(candidate),
    );
    return decodeGroupColumnOrder(view?.visible_columns_jsonb);
  }

  setGroupColumnOrder(
    ctx: Ctx,
    boardId: string,
    groupKey: string,
    columnKeys: readonly string[],
  ): void {
    const rows = db().boardViews;
    let view = rows.find(
      (candidate) => candidate.org_id === ctx.org.id
        && candidate.board_id === boardId
        && isGroupLayoutView(candidate),
    );
    const next = decodeGroupColumnOrder(view?.visible_columns_jsonb);
    if (columnKeys.length === 0) delete next[groupKey];
    else next[groupKey] = [...columnKeys];

    if (!view) {
      view = {
        id: crypto.randomUUID(),
        org_id: ctx.org.id,
        board_id: boardId,
        user_id: null,
        name: GROUP_LAYOUT_VIEW_NAME,
        kind: "table",
        filters_jsonb: { system: GROUP_LAYOUT_MARKER },
        sort_jsonb: [],
        visible_columns_jsonb: encodeGroupColumnOrder(next),
        shared: true,
      };
      rows.push(view);
      return;
    }
    view.visible_columns_jsonb = encodeGroupColumnOrder(next);
  }
}

// 프로세스 단일 인스턴스(공유 db() 사용) — 환경 미설정 테스트/오프라인 전용.
const globalBoardsRepo = globalThis as unknown as { __moaworkBoardsRepo?: BoardsRepo };

/** Keep the deterministic local store synchronous while exposing the production async port. */
export function toAsyncBoardsRepo(local: LocalBoardsRepo): BoardsRepo {
  return new Proxy(local, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => Reflect.apply(value, target, args);
    },
  }) as unknown as BoardsRepo;
}

export async function getBoardsRepo(): Promise<BoardsRepo> {
  // ★ 조건은 `canUseLocalSeedFallback()` 이다(BBE-203). env 유무«만» 보면 안 된다 —
  //   운영에서 ANON_KEY 가 빠지면 이 분기가 아래 LocalBoardsRepo(시드)로 가고,
  //   사용자는 시드 보드를 «자기 회사 데이터» 로 본다. 운영에서는 시끄럽게 실패해야 한다.
  if (!canUseLocalSeedFallback()) {
    const [{ createClient }, { SupabaseBoardsRepo }] = await Promise.all([
      import("@/lib/supabase/server"),
      import("@/lib/repo/supabase/boardsRepo"),
    ]);
    return new SupabaseBoardsRepo(await createClient());
  }
  if (process.env.NODE_ENV !== "production") {
    if (!globalBoardsRepo.__moaworkBoardsRepo) {
      globalBoardsRepo.__moaworkBoardsRepo = toAsyncBoardsRepo(new LocalBoardsRepo());
    }
    return globalBoardsRepo.__moaworkBoardsRepo;
  }
  throw new Error("LocalBoardsRepo is disabled in production");
}
