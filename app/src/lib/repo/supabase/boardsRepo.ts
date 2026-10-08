import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import type {
  Board, BoardColumn, BoardGroup, BoardItem, BoardTrashImpact, BoardView, CellValue, DefaultTabDismissal, ItemValue,
} from "@/lib/boards/types";
import type {
  AtomicValueMoveRequest, BoardPatch, BoardsRepo, ColumnPatch, DefaultDefinitionState, GroupPatch, ItemPatch, NewBoard, NewColumn,
  NewGroup, NewItem, NewView, RowMoveReceipt, RowMoveRequest, ViewPatch,
} from "@/lib/boards/store";
import { slugifyKey } from "@/lib/repo/local/boardsRepo";
import { toBoardTrashError } from "@/lib/boards/trash-errors";
import { isSectionPresetSource } from "@/lib/presets/section-presets";
import { normalizeDetailLayout, type DetailLayoutEntry } from "@/lib/boards/detail-layout";
import {
  decodeGroupColumnOrder,
  GROUP_LAYOUT_MARKER,
  GROUP_LAYOUT_VIEW_NAME,
  isGroupLayoutView,
} from "@/lib/boards/group-layout-store";
import {
  parseBoardSummaryConfig,
  type BoardSummarySettingsRequest,
  type BoardSummarySettingsReceipt,
} from "@/lib/boards/summary-settings";

type Row = Record<string, unknown>;
const DEFAULT_DEFINITION_VIEW = "__mw_default_definition__";
function canSeeAll(ctx: Ctx): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
}

function one<T>(data: unknown, error: { message?: string } | null): T {
  if (error) throw new Error(error.message ?? "Supabase boards query failed");
  if (!data) throw new Error("Supabase boards query returned no row");
  return data as T;
}

function many<T>(data: unknown, error: { message?: string } | null): T[] {
  if (error) throw new Error(error.message ?? "Supabase boards query failed");
  return (data ?? []) as T[];
}

/** 휴지통 RPC 는 boards 행 하나를 돌려준다. 오류는 사람 말로 바꾼다. */
function trashRow(data: unknown, error: { message?: string; code?: string } | null): Board {
  if (error) throw toBoardTrashError(error);
  return one<Board>(Array.isArray(data) ? data[0] : data, null);
}

/** RPC 의 integer·jsonb 숫자 → 0 이상 정수. 모르는 값은 0. */
function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function columnRow(row: Row): BoardColumn {
  return {
    ...(row as unknown as BoardColumn),
    source: (row.source as BoardColumn["source"] | null) ?? "in",
    rightPinned: Boolean(row.right_pinned),
    move_rule_jsonb: (row.move_rule_jsonb as Record<string, string> | null) ?? null,
    is_readonly: Boolean(row.is_readonly),
  };
}

/** Request-scoped authenticated adapter. The injected client carries the user's cookies; RLS owns isolation. */
/**
 * 행에 값을 묶어 읽는 select. item_values → items 외래키가 둘이라(003 의 item_id 단일 키, 087 의
 * (org_id,item_id) 복합 키) 이름 없이 `item_values(*)` 로 묶으면 PostgREST 가 PGRST201(관계 모호)로
 * 거부한다(운영 실측). 회사 일치까지 보장하는 087 복합 키로 고정한다.
 */
export const ITEMS_WITH_VALUES_SELECT = "*, item_values!item_values_org_item_fkey(*)";

export class SupabaseBoardsRepo implements BoardsRepo {
  constructor(private readonly client: SupabaseClient) {}

  // #849 — 휴지통 탭(deleted_at)은 보통 읽기에서 뺀다. 휴지통 목록은 listTrashedBoards.
  async listBoards(ctx: Ctx): Promise<Board[]> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).is("deleted_at", null).order("sort_order");
    return many<Board>(q.data, q.error).filter((board) => !isSectionPresetSource(board.source));
  }
  async listSectionPresetBoards(ctx: Ctx): Promise<Board[]> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).is("deleted_at", null).like("source", "user.section-preset/%").order("sort_order");
    return many<Board>(q.data, q.error);
  }
  async getBoard(ctx: Ctx, id: string): Promise<Board | undefined> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).eq("id", id).is("deleted_at", null).maybeSingle();
    if (q.error) throw new Error(q.error.message); return (q.data ?? undefined) as Board | undefined;
  }
  async createBoard(ctx: Ctx, input: NewBoard, requestId = crypto.randomUUID()): Promise<Board> {
    const q = await this.client.rpc("create_workspace_board", {
      p_org_id: ctx.org.id,
      p_name: input.name,
      p_description: input.description ?? null,
      p_icon: input.icon ?? null,
      p_source: input.source ?? null,
      p_request_id: requestId,
      // 자리를 고른 사용자 탭만 넘긴다. 기본 탭·프리셋 만들기는 169 이전 6인자 RPC 로도 돈다.
      ...(input.nav_section ? { p_nav_section: input.nav_section } : {}),
    });
    // 지운 기본 탭만 종류를 붙인다. 나머지 오류는 지금처럼 원문 그대로.
    if (q.error?.message?.includes("default_tab_dismissed")) throw toBoardTrashError(q.error);
    return one<Board>(Array.isArray(q.data) ? q.data[0] : q.data, q.error);
  }
  async updateBoard(ctx: Ctx, id: string, patch: BoardPatch): Promise<Board | undefined> {
    const q = await this.client.from("boards").update({ ...patch, updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id).eq("id", id).select("*").maybeSingle();
    if (q.error) throw new Error(q.error.message); return (q.data ?? undefined) as Board | undefined;
  }
  async reorderBoards(ctx: Ctx, boardIds: readonly string[], requestId: string): Promise<Board[]> {
    const q = await this.client.rpc("reorder_workspace_boards", {
      p_org_id: ctx.org.id,
      p_board_ids: boardIds,
      p_request_id: requestId,
    });
    if (q.error) throw new Error(q.error.message);
    // listBoards 와 같게 휴지통 탭은 뺀다.
    return ((q.data ?? []) as Board[]).filter((board) => !board.deleted_at);
  }
  async getDefaultDefinitionState(ctx: Ctx, boardId: string): Promise<DefaultDefinitionState | null> {
    const q = await this.client.rpc("read_default_board_definition_state", { p_org_id: ctx.org.id, p_board_id: boardId });
    if (q.error) throw new Error(q.error.message);
    return (q.data as DefaultDefinitionState | null) ?? null;
  }
  async setDefaultDefinitionState(ctx: Ctx, boardId: string, state: DefaultDefinitionState): Promise<void> {
    const q = await this.client.rpc("write_default_board_definition_state", { p_org_id: ctx.org.id, p_board_id: boardId, p_state: state });
    if (q.error) throw new Error(q.error.message);
  }
  async deleteBoard(ctx: Ctx, id: string): Promise<boolean> { const q = await this.client.from("boards").delete().eq("org_id", ctx.org.id).eq("id", id).select("id"); if (q.error) throw new Error(q.error.message); return (q.data?.length ?? 0) > 0; }

  // ── #849 휴지통 (169 RPC) ──
  async trashBoard(ctx: Ctx, id: string): Promise<Board> {
    const q = await this.client.rpc("trash_workspace_board", { p_org_id: ctx.org.id, p_board_id: id });
    return trashRow(q.data, q.error);
  }
  async restoreBoard(ctx: Ctx, id: string): Promise<Board> {
    const q = await this.client.rpc("restore_workspace_board", { p_org_id: ctx.org.id, p_board_id: id });
    return trashRow(q.data, q.error);
  }
  async purgeBoard(ctx: Ctx, id: string): Promise<number> {
    const q = await this.client.rpc("purge_workspace_board", { p_org_id: ctx.org.id, p_board_id: id });
    if (q.error) throw toBoardTrashError(q.error);
    return count(q.data);
  }
  async purgeExpiredBoards(ctx: Ctx): Promise<number> {
    const q = await this.client.rpc("purge_expired_workspace_boards", { p_org_id: ctx.org.id });
    if (q.error) throw toBoardTrashError(q.error);
    return count(q.data);
  }
  async listTrashedBoards(ctx: Ctx): Promise<Board[]> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    return many<Board>(q.data, q.error).filter((board) => !isSectionPresetSource(board.trashed_source));
  }
  async readBoardTrashImpact(ctx: Ctx, id: string): Promise<BoardTrashImpact> {
    const q = await this.client.rpc("read_board_trash_impact", { p_org_id: ctx.org.id, p_board_id: id });
    if (q.error) throw toBoardTrashError(q.error);
    const row = (q.data ?? {}) as Record<string, unknown>;
    return {
      groups: count(row.groups), rows: count(row.rows), memos: count(row.memos), files: count(row.files),
      views: count(row.views), automations: count(row.automations), messaging: count(row.messaging),
    };
  }
  async listDefaultTabDismissals(ctx: Ctx): Promise<DefaultTabDismissal[]> {
    const q = await this.client.from("default_tab_dismissals").select("org_id,source,dismissed_at,dismissed_by").eq("org_id", ctx.org.id).order("dismissed_at", { ascending: false });
    return many<DefaultTabDismissal>(q.data, q.error);
  }
  async clearDefaultTabDismissal(ctx: Ctx, source: string): Promise<boolean> {
    const q = await this.client.rpc("clear_default_tab_dismissal", { p_org_id: ctx.org.id, p_source: source });
    if (q.error) throw toBoardTrashError(q.error);
    return q.data === true;
  }
  async listStoragePurgeQueue(ctx: Ctx, limit = 100): Promise<string[]> {
    const q = await this.client.rpc("list_board_storage_purge_queue", { p_org_id: ctx.org.id, p_limit: limit });
    if (q.error) throw toBoardTrashError(q.error);
    return ((q.data ?? []) as unknown[]).filter((path): path is string => typeof path === "string");
  }
  async ackStoragePurge(ctx: Ctx, paths: readonly string[]): Promise<number> {
    if (paths.length === 0) return 0;
    const q = await this.client.rpc("ack_board_storage_purge", { p_org_id: ctx.org.id, p_paths: [...paths] });
    if (q.error) throw toBoardTrashError(q.error);
    return count(q.data);
  }
  async setBoardDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[]): Promise<Board | undefined> {
    const q = await this.client.from("boards").update({ detail_layout_jsonb: normalizeDetailLayout(layout), updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id).eq("id", id).select("*").maybeSingle();
    if (q.error) throw new Error(q.error.message);
    return (q.data ?? undefined) as Board | undefined;
  }
  async applyBoardSummarySettings(ctx: Ctx, boardId: string, request: BoardSummarySettingsRequest): Promise<BoardSummarySettingsReceipt> {
    const q = await this.client.rpc("apply_board_summary_settings", {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_request_id: request.requestId,
      p_intent: request.intent,
    });
    if (q.error) throw new Error(q.error.message);
    const row = (Array.isArray(q.data) ? q.data[0] : q.data) as Record<string, unknown> | null;
    if (!row || typeof row.replayed !== "boolean") throw new Error("요약 설정 응답을 확인할 수 없습니다.");
    return { config: parseBoardSummaryConfig(row.config), replayed: row.replayed };
  }

  async listGroups(ctx: Ctx, boardId: string): Promise<BoardGroup[]> { const q = await this.client.from("board_groups").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).order("sort_order"); return many<BoardGroup>(q.data, q.error); }
  async createGroup(ctx: Ctx, boardId: string, input: NewGroup): Promise<BoardGroup> { const rows = await this.listGroups(ctx, boardId); const next = rows.length === 0 ? 0 : Math.max(...rows.map((group) => group.sort_order)) + 1; const q = await this.client.from("board_groups").insert({ org_id: ctx.org.id, board_id: boardId, name: input.name, color: input.color ?? null, sort_order: input.sortOrder ?? next }).select("*").single(); return one<BoardGroup>(q.data, q.error); }
  async updateGroup(ctx: Ctx, boardId: string, id: string, patch: GroupPatch): Promise<BoardGroup | undefined> { const q = await this.client.from("board_groups").update(patch).eq("org_id", ctx.org.id).eq("board_id", boardId).eq("id", id).select("*").maybeSingle(); if (q.error) throw new Error(q.error.message); return (q.data as BoardGroup | null) ?? undefined; }
  async reorderGroups(ctx: Ctx, boardId: string, groupIds: readonly string[]): Promise<BoardGroup[]> { const q = await this.client.rpc("reorder_board_groups", { p_org_id: ctx.org.id, p_board_id: boardId, p_group_ids: [...groupIds] }); if (q.error) throw new Error(q.error.message); return many<BoardGroup>(q.data, null); }
  async deleteGroup(ctx: Ctx, id: string): Promise<boolean> { const q = await this.client.from("board_groups").delete().eq("org_id", ctx.org.id).eq("id", id).select("id"); if (q.error) throw new Error(q.error.message); return (q.data?.length ?? 0) > 0; }
  async setGroupDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[] | null): Promise<BoardGroup | undefined> {
    const q = await this.client.from("board_groups").update({ detail_layout_jsonb: layout === null ? null : normalizeDetailLayout(layout) }).eq("org_id", ctx.org.id).eq("id", id).select("*").maybeSingle();
    if (q.error) throw new Error(q.error.message);
    return (q.data ?? undefined) as BoardGroup | undefined;
  }

  async listColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]> { const q = await this.client.from("board_columns").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).is("archived_at",null).order("sort_order"); return many<Row>(q.data, q.error).map(columnRow); }
  async listArchivedColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]> { const q = await this.client.from("board_columns").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).not("archived_at","is",null).order("archived_at",{ascending:false}); return many<Row>(q.data,q.error).map(columnRow); }
  async createColumn(ctx: Ctx, boardId: string, input: NewColumn): Promise<BoardColumn> {
    const all = await this.client.from("board_columns").select("key").eq("org_id",ctx.org.id).eq("board_id",boardId); const existing=many<{key:string}>(all.data,all.error); const base = input.key?.trim() || slugifyKey(input.label); let key = base; let n = 2; while (existing.some((c) => c.key === key)) key = `${base}_${n++}`;
    const q = await this.client.from("board_columns").insert({ org_id: ctx.org.id, board_id: boardId, key, label: input.label, type: input.type, source: input.source ?? "in", right_pinned: input.rightPinned ?? false, options_jsonb: input.options ? { options: input.options } : null, sort_order: input.sortOrder ?? existing.length, width: input.width ?? null, move_rule_jsonb: input.moveRule ?? null, is_readonly: input.readOnly ?? false }).select("*").single();
    return columnRow(one<Row>(q.data, q.error));
  }
  async updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): Promise<BoardColumn | undefined> { const dbPatch: Row = {}; if (patch.label !== undefined) dbPatch.label=patch.label; if (patch.source !== undefined) dbPatch.source=patch.source; if (patch.rightPinned !== undefined) dbPatch.right_pinned=patch.rightPinned; if (patch.options !== undefined) dbPatch.options_jsonb=patch.options ? {options:patch.options}:null; if (patch.sort_order !== undefined) dbPatch.sort_order=patch.sort_order; if (patch.width !== undefined) dbPatch.width=patch.width; if (patch.moveRule !== undefined) dbPatch.move_rule_jsonb=patch.moveRule; if (patch.readOnly !== undefined) dbPatch.is_readonly=patch.readOnly; const q=await this.client.from("board_columns").update(dbPatch).eq("org_id",ctx.org.id).eq("id",id).select("*").maybeSingle(); if(q.error) throw new Error(q.error.message); return q.data ? columnRow(q.data as Row):undefined; }
  async reorderColumns(ctx:Ctx,boardId:string,columnIds:readonly string[]):Promise<BoardColumn[]>{const q=await this.client.rpc("reorder_board_columns_atomic",{p_org_id:ctx.org.id,p_board_id:boardId,p_column_ids:[...columnIds]});if(q.error)throw new Error(q.error.message);return many<Row>(q.data,null).map(columnRow);}
  /**
   * 컬럼 정의를 보관한다 — 셀 값(`item_values`)과 원본 key를 모두 보존한다 (BBE-221).
   *
   * 전에는 여기서 그 key 의 `item_values` 를 먼저 DELETE 했다. DB 가 시킨 일이 아니었다:
   * `item_values` 는 `board_columns` 를 FK 로 참조하지 않고 `(item_id, column_key)` 만 쥔다
   * (`003_boards_engine.sql`). 애플리케이션이 스스로 고른 물리 삭제였고, 그래서 컬럼을 한 번
   * 지우면 그 열의 값이 영구 소실됐다 — 되돌릴 근거가 DB 에 남지 않았다.
   *
   * 값을 남겨도 화면에 새지 않는다. `BoardsService.compose` 가 정의된 컬럼 key 만 싣고 나머지는
   * 버린다. 남은 값은 잠들어 있다가 같은 key 로 컬럼이 돌아오면 다시 붙는다 — 조인이 컬럼 id 가
   * 아니라 key 로 일어나기 때문이다.
   */
  async deleteColumn(ctx: Ctx, id: string): Promise<boolean>;
  async deleteColumn(ctx: Ctx, boardId: string, id: string): Promise<boolean>;
  async deleteColumn(ctx: Ctx, boardIdOrId: string, columnId?: string): Promise<boolean> {
    const id = columnId ?? boardIdOrId;
    const boardId = columnId === undefined ? undefined : boardIdOrId;
    if (boardId !== undefined) {
      const board = await this.getBoard(ctx, boardId);
      if (!board || board.is_system) return false;
    }
    let query = this.client
      .from("board_columns")
      .update({archived_at:new Date().toISOString(),deleted_by:ctx.user.id})
      .eq("org_id", ctx.org.id);
    if (boardId !== undefined) query = query.eq("board_id", boardId);
    const q = await query
      .eq("id", id)
      .is("archived_at",null)
      .select("id");
    if (q.error) throw new Error(q.error.message);
    return (q.data?.length ?? 0) > 0;
  }

  async restoreColumn(ctx:Ctx,boardId:string,id:string):Promise<BoardColumn|undefined>{
    const board=await this.getBoard(ctx,boardId);if(!board||board.is_system)return undefined;
    const active=await this.listColumns(ctx,boardId);
    const nextPosition=active.length===0?0:Math.max(...active.map((column)=>column.sort_order))+1;
    const q=await this.client.from("board_columns").update({archived_at:null,deleted_by:null,sort_order:nextPosition}).eq("org_id",ctx.org.id).eq("board_id",boardId).eq("id",id).not("archived_at","is",null).select("*").maybeSingle();
    if(q.error)throw new Error(q.error.message);return q.data?columnRow(q.data as Row):undefined;
  }

  async listItems(ctx: Ctx, boardId: string): Promise<BoardItem[]> { const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).is("deleted_at",null).is("archived_at",null).order("sort_order"); return many<BoardItem>(q.data,q.error); }
  async listDeletedItems(ctx: Ctx, boardId: string): Promise<BoardItem[]> { const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).not("deleted_at","is",null).order("deleted_at",{ascending:false}); return many<BoardItem>(q.data,q.error); }
  async listArchivedItems(ctx: Ctx, boardId: string): Promise<BoardItem[]> { const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).is("deleted_at",null).not("archived_at","is",null).order("archived_at",{ascending:false}); return many<BoardItem>(q.data,q.error); }
  async listItemsWithValues(ctx: Ctx, boardId: string, scope: "active" | "deleted" | "archived"): Promise<{ items: BoardItem[]; values: ItemValue[] }> {
    // Issue 857 — 행과 값을 한 왕복으로. 값은 같은 RLS 아래 행에 묶여 온다(각 행의 값이라 행 수 제한에 함께 묶이지 않는다).
    const base = () => this.client.from("items").select(ITEMS_WITH_VALUES_SELECT).eq("org_id", ctx.org.id).eq("board_id", boardId);
    const result = scope === "active"
      ? await base().is("deleted_at", null).is("archived_at", null).order("sort_order")
      : scope === "deleted"
        ? await base().not("deleted_at", "is", null).order("deleted_at", { ascending: false })
        : await base().is("deleted_at", null).not("archived_at", "is", null).order("archived_at", { ascending: false });
    const rows = many<BoardItem & { item_values?: ItemValue[] | null }>(result.data, result.error);
    const items: BoardItem[] = [];
    const values: ItemValue[] = [];
    for (const { item_values: embedded, ...item } of rows) {
      items.push(item);
      for (const value of embedded ?? []) if (value.org_id === ctx.org.id) values.push(value);
    }
    return { items, values };
  }
  async getItem(ctx: Ctx,id:string):Promise<BoardItem|undefined>{const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("id",id).is("deleted_at",null).is("archived_at",null).maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  async getArchivedItem(ctx: Ctx,id:string):Promise<BoardItem|undefined>{const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("id",id).is("deleted_at",null).not("archived_at","is",null).maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  async createItem(ctx:Ctx,boardId:string,input:NewItem):Promise<BoardItem>{const rows=await this.listItems(ctx,boardId);const assignedTo=canSeeAll(ctx)?(input.assigned_to??null):ctx.user.id;const q=await this.client.from("items").insert({org_id:ctx.org.id,board_id:boardId,group_id:input.group_id??null,title:input.title,assigned_to:assignedTo,sort_order:rows.length}).select("*").single();const item=one<BoardItem>(q.data,q.error);if(input.values)await this.setValues(ctx,item.id,input.values);return item;}
  async updateItem(ctx:Ctx,id:string,patch:ItemPatch):Promise<BoardItem|undefined>{const{assigned_to,...safePatch}=patch;const q=await this.client.from("items").update({...safePatch,...(assigned_to!==undefined&&canSeeAll(ctx)?{assigned_to}:{}),updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("id",id).is("deleted_at",null).is("archived_at",null).select("*").maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  async moveRowAtomic(ctx:Ctx,boardId:string,request:RowMoveRequest):Promise<RowMoveReceipt>{
    const q=await this.client.rpc("move_board_row_atomic",{p_org_id:ctx.org.id,p_board_id:boardId,p_item_id:request.itemId,p_target_group_id:request.targetGroupId,p_before_item_id:request.beforeItemId,p_expected_version:request.expectedVersion,p_request_id:request.requestId});
    if(q.error)throw new Error(q.error.message);
    const row=(Array.isArray(q.data)?q.data[0]:q.data) as Record<string,unknown>|null;
    if(!row||typeof row.version!=="number"||typeof row.replayed!=="boolean")throw new Error("행 이동 응답을 확인할 수 없습니다.");
    return{itemId:String(row.item_id),targetGroupId:row.target_group_id===null?null:String(row.target_group_id),beforeItemId:row.before_item_id===null?null:String(row.before_item_id),version:row.version,replayed:row.replayed};
  }
  async setValuesAndMoveAtomic(ctx:Ctx,boardId:string,request:AtomicValueMoveRequest):Promise<RowMoveReceipt>{
    const q=await this.client.rpc("set_board_item_values_with_atomic_move",{p_org_id:ctx.org.id,p_board_id:boardId,p_item_id:request.itemId,p_values:request.values,p_target_group_id:request.targetGroupId,p_before_item_id:request.beforeItemId,p_expected_version:request.expectedVersion,p_request_id:request.requestId});
    if(q.error)throw new Error(q.error.message);
    const row=(Array.isArray(q.data)?q.data[0]:q.data) as Record<string,unknown>|null;
    if(!row||typeof row.version!=="number"||typeof row.replayed!=="boolean")throw new Error("값과 행 이동 응답을 확인할 수 없습니다.");
    return{itemId:String(row.item_id),targetGroupId:row.target_group_id===null?null:String(row.target_group_id),beforeItemId:row.before_item_id===null?null:String(row.before_item_id),version:row.version,replayed:row.replayed};
  }
  async reconcileDefinitionItemGroup(ctx:Ctx,boardId:string,itemId:string,expectedSourceGroupId:string|null,targetGroupId:string):Promise<void>{const q=await this.client.rpc("reconcile_board_definition_item_group",{p_org_id:ctx.org.id,p_board_id:boardId,p_item_id:itemId,p_expected_source_group_id:expectedSourceGroupId,p_target_group_id:targetGroupId});if(q.error)throw new Error(q.error.message);}
  async deleteItem(ctx:Ctx,boardId:string,id:string):Promise<boolean>{const q=await this.client.from("items").update({deleted_at:new Date().toISOString(),deleted_by:ctx.user.id,updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("board_id",boardId).eq("id",id).is("deleted_at",null).is("archived_at",null).select("id");if(q.error)throw new Error(q.error.message);return(q.data?.length??0)>0;}
  async restoreItem(ctx:Ctx,boardId:string,id:string):Promise<BoardItem|undefined>{const q=await this.client.from("items").update({deleted_at:null,deleted_by:null,updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("board_id",boardId).eq("id",id).not("deleted_at","is",null).select("*").maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  /** 요청 클라이언트(RLS: messaging_trigger_rules_read = 조직 구성원)로 읽는다. 오류면 던진다 — 호출부가 «있다» 로 닫는다. */
  async hasEnabledMessagingTriggerRules(ctx:Ctx,boardId:string,columnKey:string):Promise<boolean>{const q=await this.client.from("messaging_trigger_rules").select("id").eq("org_id",ctx.org.id).eq("board_id",boardId).eq("column_key",columnKey).eq("enabled",true).limit(1);if(q.error)throw new Error(q.error.message);return(q.data?.length??0)>0;}
  async listValues(ctx:Ctx,itemIds:string[]):Promise<ItemValue[]>{if(itemIds.length===0)return[];const q=await this.client.from("item_values").select("*").eq("org_id",ctx.org.id).in("item_id",itemIds);return many<ItemValue>(q.data,q.error);}
  async setValues(ctx:Ctx,itemId:string,patch:Record<string,CellValue>):Promise<void>{if(!(await this.getItem(ctx,itemId)))return;const rows=Object.entries(patch).map(([column_key,value_jsonb])=>({org_id:ctx.org.id,item_id:itemId,column_key,value_jsonb}));if(rows.length===0)return;const q=await this.client.from("item_values").upsert(rows,{onConflict:"item_id,column_key"});if(q.error)throw new Error(q.error.message);const touch=await this.client.from("items").update({updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("id",itemId);if(touch.error)throw new Error(touch.error.message);}

  async listViews(ctx:Ctx,boardId:string):Promise<BoardView[]>{const q=await this.client.from("board_views").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).or(`shared.eq.true,user_id.eq.${ctx.user.id},user_id.is.null`);return many<BoardView>(q.data,q.error).filter((view)=>!isGroupLayoutView(view)&&view.name!==DEFAULT_DEFINITION_VIEW);}
  async getView(ctx:Ctx,id:string):Promise<BoardView|undefined>{const q=await this.client.from("board_views").select("*").eq("org_id",ctx.org.id).eq("id",id).or(`shared.eq.true,user_id.eq.${ctx.user.id},user_id.is.null`).maybeSingle();if(q.error)throw new Error(q.error.message);const view=(q.data??undefined)as BoardView|undefined;return view&&!isGroupLayoutView(view)?view:undefined;}
  async createView(ctx:Ctx,boardId:string,input:NewView):Promise<BoardView>{const q=await this.client.from("board_views").insert({org_id:ctx.org.id,board_id:boardId,user_id:ctx.user.id,name:input.name,kind:input.kind,filters_jsonb:input.filters??{},sort_jsonb:input.sort??[],visible_columns_jsonb:input.visibleColumns??[],shared:input.shared??false}).select("*").single();return one<BoardView>(q.data,q.error);}
  async updateView(ctx:Ctx,id:string,patch:ViewPatch):Promise<BoardView|undefined>{const dbPatch:Row={};if(patch.name!==undefined)dbPatch.name=patch.name;if(patch.kind!==undefined)dbPatch.kind=patch.kind;if(patch.filters!==undefined)dbPatch.filters_jsonb=patch.filters;if(patch.sort!==undefined)dbPatch.sort_jsonb=patch.sort;if(patch.visibleColumns!==undefined)dbPatch.visible_columns_jsonb=patch.visibleColumns;if(patch.shared!==undefined)dbPatch.shared=patch.shared;const q=await this.client.from("board_views").update(dbPatch).eq("org_id",ctx.org.id).eq("id",id).eq("user_id",ctx.user.id).select("*").maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardView|undefined;}
  async deleteView(ctx:Ctx,id:string):Promise<boolean>{const q=await this.client.from("board_views").delete().eq("org_id",ctx.org.id).eq("id",id).eq("user_id",ctx.user.id).select("id");if(q.error)throw new Error(q.error.message);return(q.data?.length??0)>0;}
  async getGroupColumnOrder(ctx:Ctx,boardId:string):Promise<Record<string,string[]>>{const q=await this.client.from("board_views").select("visible_columns_jsonb,filters_jsonb,name").eq("org_id",ctx.org.id).eq("board_id",boardId).eq("name",GROUP_LAYOUT_VIEW_NAME).eq("filters_jsonb->>system",GROUP_LAYOUT_MARKER).maybeSingle();if(q.error)throw new Error(q.error.message);return decodeGroupColumnOrder(q.data?.visible_columns_jsonb);}
  async setGroupColumnOrder(ctx:Ctx,boardId:string,groupKey:string,columnKeys:readonly string[]):Promise<void>{const q=await this.client.rpc("set_board_group_column_order",{p_board_id:boardId,p_group_key:groupKey,p_column_keys:[...columnKeys]});if(q.error)throw new Error(q.error.message);}
}
