import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import type {
  Board, BoardColumn, BoardGroup, BoardItem, BoardView, CellValue, ItemValue,
} from "@/lib/boards/types";
import type {
  BoardPatch, BoardsRepo, ColumnPatch, ItemPatch, NewBoard, NewColumn,
  NewGroup, NewItem, NewView, ViewPatch,
} from "@/lib/boards/store";
import { slugifyKey } from "@/lib/repo/local/boardsRepo";
import { isSectionPresetSource } from "@/lib/presets/section-presets";
import { normalizeDetailLayout, type DetailLayoutEntry } from "@/lib/boards/detail-layout";

type Row = Record<string, unknown>;

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
export class SupabaseBoardsRepo implements BoardsRepo {
  constructor(private readonly client: SupabaseClient) {}

  async listBoards(ctx: Ctx): Promise<Board[]> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).order("sort_order");
    return many<Board>(q.data, q.error).filter((board) => !isSectionPresetSource(board.source));
  }
  async listSectionPresetBoards(ctx: Ctx): Promise<Board[]> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).like("source", "user.section-preset/%").order("sort_order");
    return many<Board>(q.data, q.error);
  }
  async getBoard(ctx: Ctx, id: string): Promise<Board | undefined> {
    const q = await this.client.from("boards").select("*").eq("org_id", ctx.org.id).eq("id", id).maybeSingle();
    if (q.error) throw new Error(q.error.message); return (q.data ?? undefined) as Board | undefined;
  }
  async createBoard(ctx: Ctx, input: NewBoard): Promise<Board> {
    const count = await this.client.from("boards").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id);
    if (count.error) throw new Error(count.error.message);
    const q = await this.client.from("boards").insert({ org_id: ctx.org.id, name: input.name, description: input.description ?? null, icon: input.icon ?? null, source: input.source ?? null, created_by: ctx.user.id, sort_order: count.count ?? 0 }).select("*").single();
    return one<Board>(q.data, q.error);
  }
  async updateBoard(ctx: Ctx, id: string, patch: BoardPatch): Promise<Board | undefined> {
    const q = await this.client.from("boards").update({ ...patch, updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id).eq("id", id).select("*").maybeSingle();
    if (q.error) throw new Error(q.error.message); return (q.data ?? undefined) as Board | undefined;
  }
  async deleteBoard(ctx: Ctx, id: string): Promise<boolean> { const q = await this.client.from("boards").delete().eq("org_id", ctx.org.id).eq("id", id).select("id"); if (q.error) throw new Error(q.error.message); return (q.data?.length ?? 0) > 0; }
  async setBoardDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[]): Promise<Board | undefined> {
    const q = await this.client.from("boards").update({ detail_layout_jsonb: normalizeDetailLayout(layout), updated_at: new Date().toISOString() }).eq("org_id", ctx.org.id).eq("id", id).select("*").maybeSingle();
    if (q.error) throw new Error(q.error.message);
    return (q.data ?? undefined) as Board | undefined;
  }

  async listGroups(ctx: Ctx, boardId: string): Promise<BoardGroup[]> { const q = await this.client.from("board_groups").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).order("sort_order"); return many<BoardGroup>(q.data, q.error); }
  async createGroup(ctx: Ctx, boardId: string, input: NewGroup): Promise<BoardGroup> { const rows = await this.listGroups(ctx, boardId); const q = await this.client.from("board_groups").insert({ org_id: ctx.org.id, board_id: boardId, name: input.name, color: input.color ?? null, sort_order: rows.length }).select("*").single(); return one<BoardGroup>(q.data, q.error); }
  async deleteGroup(ctx: Ctx, id: string): Promise<boolean> { const q = await this.client.from("board_groups").delete().eq("org_id", ctx.org.id).eq("id", id).select("id"); if (q.error) throw new Error(q.error.message); return (q.data?.length ?? 0) > 0; }
  async setGroupDetailLayout(ctx: Ctx, id: string, layout: DetailLayoutEntry[] | null): Promise<BoardGroup | undefined> {
    const q = await this.client.from("board_groups").update({ detail_layout_jsonb: layout === null ? null : normalizeDetailLayout(layout) }).eq("org_id", ctx.org.id).eq("id", id).select("*").maybeSingle();
    if (q.error) throw new Error(q.error.message);
    return (q.data ?? undefined) as BoardGroup | undefined;
  }

  async listColumns(ctx: Ctx, boardId: string): Promise<BoardColumn[]> { const q = await this.client.from("board_columns").select("*").eq("org_id", ctx.org.id).eq("board_id", boardId).order("sort_order"); return many<Row>(q.data, q.error).map(columnRow); }
  async createColumn(ctx: Ctx, boardId: string, input: NewColumn): Promise<BoardColumn> {
    const existing = await this.listColumns(ctx, boardId); const base = input.key?.trim() || slugifyKey(input.label); let key = base; let n = 2; while (existing.some((c) => c.key === key)) key = `${base}_${n++}`;
    const q = await this.client.from("board_columns").insert({ org_id: ctx.org.id, board_id: boardId, key, label: input.label, type: input.type, source: input.source ?? "in", right_pinned: input.rightPinned ?? false, options_jsonb: input.options ? { options: input.options } : null, sort_order: existing.length, width: input.width ?? null, move_rule_jsonb: input.moveRule ?? null, is_readonly: input.readOnly ?? false }).select("*").single();
    return columnRow(one<Row>(q.data, q.error));
  }
  async updateColumn(ctx: Ctx, id: string, patch: ColumnPatch): Promise<BoardColumn | undefined> { const dbPatch: Row = {}; if (patch.label !== undefined) dbPatch.label=patch.label; if (patch.source !== undefined) dbPatch.source=patch.source; if (patch.rightPinned !== undefined) dbPatch.right_pinned=patch.rightPinned; if (patch.options !== undefined) dbPatch.options_jsonb=patch.options ? {options:patch.options}:null; if (patch.sort_order !== undefined) dbPatch.sort_order=patch.sort_order; if (patch.width !== undefined) dbPatch.width=patch.width; if (patch.moveRule !== undefined) dbPatch.move_rule_jsonb=patch.moveRule; if (patch.readOnly !== undefined) dbPatch.is_readonly=patch.readOnly; const q=await this.client.from("board_columns").update(dbPatch).eq("org_id",ctx.org.id).eq("id",id).select("*").maybeSingle(); if(q.error) throw new Error(q.error.message); return q.data ? columnRow(q.data as Row):undefined; }
  async deleteColumn(ctx: Ctx, id: string): Promise<boolean> {
    const columnQuery = await this.client
      .from("board_columns")
      .select("board_id,key")
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .maybeSingle();
    if (columnQuery.error) throw new Error(columnQuery.error.message);
    if (!columnQuery.data) return false;

    const itemsQuery = await this.client
      .from("items")
      .select("id")
      .eq("org_id", ctx.org.id)
      .eq("board_id", columnQuery.data.board_id);
    if (itemsQuery.error) throw new Error(itemsQuery.error.message);
    const itemIds = (itemsQuery.data ?? []).map((item) => item.id);
    if (itemIds.length > 0) {
      const valuesQuery = await this.client
        .from("item_values")
        .delete()
        .eq("org_id", ctx.org.id)
        .eq("column_key", columnQuery.data.key)
        .in("item_id", itemIds);
      if (valuesQuery.error) throw new Error(valuesQuery.error.message);
    }

    const q = await this.client
      .from("board_columns")
      .delete()
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .select("id");
    if (q.error) throw new Error(q.error.message);
    return (q.data?.length ?? 0) > 0;
  }

  async listItems(ctx: Ctx, boardId: string): Promise<BoardItem[]> { const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).is("deleted_at",null).order("sort_order"); return many<BoardItem>(q.data,q.error); }
  async listDeletedItems(ctx: Ctx, boardId: string): Promise<BoardItem[]> { const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).not("deleted_at","is",null).order("deleted_at",{ascending:false}); return many<BoardItem>(q.data,q.error); }
  async getItem(ctx: Ctx,id:string):Promise<BoardItem|undefined>{const q=await this.client.from("items").select("*").eq("org_id",ctx.org.id).eq("id",id).is("deleted_at",null).maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  async createItem(ctx:Ctx,boardId:string,input:NewItem):Promise<BoardItem>{const rows=await this.listItems(ctx,boardId);const assignedTo=canSeeAll(ctx)?(input.assigned_to??null):ctx.user.id;const q=await this.client.from("items").insert({org_id:ctx.org.id,board_id:boardId,group_id:input.group_id??null,title:input.title,assigned_to:assignedTo,sort_order:rows.length}).select("*").single();const item=one<BoardItem>(q.data,q.error);if(input.values)await this.setValues(ctx,item.id,input.values);return item;}
  async updateItem(ctx:Ctx,id:string,patch:ItemPatch):Promise<BoardItem|undefined>{const{assigned_to,...safePatch}=patch;const q=await this.client.from("items").update({...safePatch,...(assigned_to!==undefined&&canSeeAll(ctx)?{assigned_to}:{}),updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("id",id).is("deleted_at",null).select("*").maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  async deleteItem(ctx:Ctx,boardId:string,id:string):Promise<boolean>{const q=await this.client.from("items").update({deleted_at:new Date().toISOString(),deleted_by:ctx.user.id,updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("board_id",boardId).eq("id",id).is("deleted_at",null).select("id");if(q.error)throw new Error(q.error.message);return(q.data?.length??0)>0;}
  async restoreItem(ctx:Ctx,boardId:string,id:string):Promise<BoardItem|undefined>{const q=await this.client.from("items").update({deleted_at:null,deleted_by:null,updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("board_id",boardId).eq("id",id).not("deleted_at","is",null).select("*").maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardItem|undefined;}
  async listValues(ctx:Ctx,itemIds:string[]):Promise<ItemValue[]>{if(itemIds.length===0)return[];const q=await this.client.from("item_values").select("*").eq("org_id",ctx.org.id).in("item_id",itemIds);return many<ItemValue>(q.data,q.error);}
  async setValues(ctx:Ctx,itemId:string,patch:Record<string,CellValue>):Promise<void>{if(!(await this.getItem(ctx,itemId)))return;const rows=Object.entries(patch).map(([column_key,value_jsonb])=>({org_id:ctx.org.id,item_id:itemId,column_key,value_jsonb}));if(rows.length===0)return;const q=await this.client.from("item_values").upsert(rows,{onConflict:"item_id,column_key"});if(q.error)throw new Error(q.error.message);const touch=await this.client.from("items").update({updated_at:new Date().toISOString()}).eq("org_id",ctx.org.id).eq("id",itemId);if(touch.error)throw new Error(touch.error.message);}

  async listViews(ctx:Ctx,boardId:string):Promise<BoardView[]>{const q=await this.client.from("board_views").select("*").eq("org_id",ctx.org.id).eq("board_id",boardId).or(`shared.eq.true,user_id.eq.${ctx.user.id},user_id.is.null`);return many<BoardView>(q.data,q.error);}
  async getView(ctx:Ctx,id:string):Promise<BoardView|undefined>{const q=await this.client.from("board_views").select("*").eq("org_id",ctx.org.id).eq("id",id).or(`shared.eq.true,user_id.eq.${ctx.user.id},user_id.is.null`).maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardView|undefined;}
  async createView(ctx:Ctx,boardId:string,input:NewView):Promise<BoardView>{const q=await this.client.from("board_views").insert({org_id:ctx.org.id,board_id:boardId,user_id:ctx.user.id,name:input.name,kind:input.kind,filters_jsonb:input.filters??{},sort_jsonb:input.sort??[],visible_columns_jsonb:input.visibleColumns??[],shared:input.shared??false}).select("*").single();return one<BoardView>(q.data,q.error);}
  async updateView(ctx:Ctx,id:string,patch:ViewPatch):Promise<BoardView|undefined>{const dbPatch:Row={};if(patch.name!==undefined)dbPatch.name=patch.name;if(patch.kind!==undefined)dbPatch.kind=patch.kind;if(patch.filters!==undefined)dbPatch.filters_jsonb=patch.filters;if(patch.sort!==undefined)dbPatch.sort_jsonb=patch.sort;if(patch.visibleColumns!==undefined)dbPatch.visible_columns_jsonb=patch.visibleColumns;if(patch.shared!==undefined)dbPatch.shared=patch.shared;const q=await this.client.from("board_views").update(dbPatch).eq("org_id",ctx.org.id).eq("id",id).eq("user_id",ctx.user.id).select("*").maybeSingle();if(q.error)throw new Error(q.error.message);return(q.data??undefined)as BoardView|undefined;}
  async deleteView(ctx:Ctx,id:string):Promise<boolean>{const q=await this.client.from("board_views").delete().eq("org_id",ctx.org.id).eq("id",id).eq("user_id",ctx.user.id).select("id");if(q.error)throw new Error(q.error.message);return(q.data?.length??0)>0;}
}
