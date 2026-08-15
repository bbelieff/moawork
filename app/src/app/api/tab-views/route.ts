import { createRequestBoards } from "@/lib/boards/server";
import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";
import { createClient } from "@/lib/supabase/server";
import { parseSavedBoardViewConfig, savedBoardViewFromRow } from "@/lib/view/board-saved";

const COLS = "id,name,visibility,owner_id,config_jsonb,is_default,last_used_at";


async function assertBoardAccess(boardId: string) {
  const ctx = await requireCtx();
  const { service } = await createRequestBoards();
  await service.getBoardDetail(ctx, boardId);
  return ctx;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const boardId = new URL(req.url).searchParams.get("boardId") ?? "";
    const ctx = await assertBoardAccess(boardId);
    const db = await createClient();
    const { data, error } = await db.from("tab_views").select(COLS)
      .eq("org_id", ctx.org.id).eq("board_id", boardId)
      .order("is_default", { ascending: false })
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return jsonOk((data ?? []).map((row) => savedBoardViewFromRow(row as Record<string, unknown>)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJson(req) as Record<string, unknown>;
    const boardId = typeof body.boardId === "string" ? body.boardId : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const visibility = body.visibility === "shared" ? "shared" : "private";
    if (!name || !boardId) return Response.json({ error: "boardId와 이름이 필요합니다." }, { status: 400 });
    const ctx = await assertBoardAccess(boardId);
    const config = parseSavedBoardViewConfig(body.config);
    const db = await createClient();
    const { data, error } = await db.from("tab_views").insert({
      org_id: ctx.org.id,
      board_id: boardId,
      board_key: boardId,
      owner_id: ctx.user.id,
      name,
      kind: config.kind === "table" ? "flat" : config.kind === "calendar" ? "cal" : "board",
      visibility,
      person_scope: "viewer",
      filters_jsonb: config.filters.byColumn,
      sort_jsonb: config.filters.sortKey ? [{ columnKey: config.filters.sortKey, direction: config.filters.sortDir }] : [],
      hidden_columns_jsonb: config.hiddenColumns,
      column_order_jsonb: config.columnOrder,
      calendar_field_key: config.calendarFieldKey,
      config_jsonb: config,
      last_used_at: new Date().toISOString(),
    }).select(COLS).single();
    if (error) throw error;
    return jsonOk(savedBoardViewFromRow(data as Record<string, unknown>), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
