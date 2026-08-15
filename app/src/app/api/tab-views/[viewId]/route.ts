import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";
import { createClient } from "@/lib/supabase/server";
import { parseSavedBoardViewConfig } from "@/lib/view/board-saved";

type Params = { params: Promise<{ viewId: string }> };
const COLS = "id,name,visibility,owner_id,config_jsonb,is_default,last_used_at,board_id";

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    const body = await readJson(req) as Record<string, unknown>;
    const db = await createClient();
    if (body.isDefault === true) {
      const { error } = await db.rpc("set_tab_view_default", { p_view_id: viewId });
      if (error) throw error;
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.visibility === "private" || body.visibility === "shared") patch.visibility = body.visibility;
    if (body.config !== undefined) patch.config_jsonb = parseSavedBoardViewConfig(body.config);
    if (body.touch === true) patch.last_used_at = new Date().toISOString();
    const { data, error } = await db.from("tab_views").update(patch)
      .eq("id", viewId).eq("org_id", ctx.org.id).select(COLS).single();
    if (error) throw error;
    return jsonOk(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    const db = await createClient();
    const { data: current, error: readError } = await db.from("tab_views")
      .select("board_id").eq("id", viewId).eq("org_id", ctx.org.id).single();
    if (readError) throw readError;
    const { error } = await db.from("tab_views").delete().eq("id", viewId).eq("org_id", ctx.org.id);
    if (error) throw error;
    const { data: fallback, error: fallbackError } = await db.from("tab_views").select(COLS)
      .eq("org_id", ctx.org.id).eq("board_id", current.board_id)
      .order("is_default", { ascending: false })
      .order("last_used_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (fallbackError) throw fallbackError;
    return jsonOk({ deleted: true, fallback });
  } catch (error) {
    return toErrorResponse(error);
  }
}
