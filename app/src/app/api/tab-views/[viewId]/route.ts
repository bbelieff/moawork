import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { parsePersonScopeInput, parseSavedBoardViewConfig, savedBoardViewFromRow } from "@/lib/view/board-saved";
import { requireActiveFixedPerson } from "@/lib/view/server";

type Params = { params: Promise<{ viewId: string }> };
const COLS = "id,name,visibility,owner_id,person_scope,person_scope_user_id,config_jsonb,is_default,last_used_at,board_id";

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    const body = await readJson(req) as Record<string, unknown>;
    if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
      return Response.json({ error: "저장된 보기는 연결된 워크스페이스가 필요합니다." }, { status: 503 });
    }
    const db = await createClient();
    if (body.selected === true) {
      const { data: selected, error: selectedError } = await db.from("tab_views").select(COLS)
        .eq("id", viewId).eq("org_id", ctx.org.id).single();
      if (selectedError) throw selectedError;
      const { error: preferenceError } = await db.from("tab_view_selections").upsert({
        org_id: ctx.org.id, board_id: selected.board_id, user_id: ctx.user.id,
        view_id: viewId, selected_at: new Date().toISOString(),
      }, { onConflict: "org_id,board_id,user_id" });
      if (preferenceError) throw preferenceError;
      return jsonOk(savedBoardViewFromRow(selected as Record<string, unknown>));
    }
    if (body.isDefault === true) {
      const { error } = await db.rpc("set_tab_view_default", { p_view_id: viewId });
      if (error) throw error;
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.visibility === "private" || body.visibility === "shared") patch.visibility = body.visibility;
    if (body.personScope !== undefined || body.personScopeUserId !== undefined) {
      const scope = parsePersonScopeInput(body.personScope, body.personScopeUserId);
      await requireActiveFixedPerson(ctx.org.id, scope, async (orgId, userId) => {
        const { data, error } = await db.from("org_members").select("user_id").eq("org_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle();
        if (error) throw error;
        return { active: data?.user_id === userId };
      });
      patch.person_scope = scope.personScope;
      patch.person_scope_user_id = scope.personScopeUserId;
    }
    if (body.config !== undefined) {
      const config = parseSavedBoardViewConfig(body.config);
      patch.config_jsonb = config;
      patch.kind = config.kind === "table" ? "flat" : config.kind === "calendar" ? "cal" : "board";
      patch.filters_jsonb = config.filters.byColumn;
      patch.sort_jsonb = config.sorts;
      patch.hidden_columns_jsonb = config.hiddenColumns;
      patch.column_order_jsonb = config.columnOrder;
      patch.calendar_field_key = config.calendarFieldKey;
    }
    if (body.touch === true) patch.last_used_at = new Date().toISOString();
    const { data, error } = await db.from("tab_views").update(patch)
      .eq("id", viewId).eq("org_id", ctx.org.id).select(COLS).single();
    if (error) throw error;
    return jsonOk(savedBoardViewFromRow(data as Record<string, unknown>, true));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { viewId } = await params;
    if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
      return Response.json({ error: "저장된 보기는 연결된 워크스페이스가 필요합니다." }, { status: 503 });
    }
    const db = await createClient();
    const { data: current, error: readError } = await db.from("tab_views")
      .select("board_id").eq("id", viewId).eq("org_id", ctx.org.id).single();
    if (readError) throw readError;
    const { error } = await db.from("tab_views").delete().eq("id", viewId).eq("org_id", ctx.org.id);
    if (error) throw error;
    const { data: preference } = await db.from("tab_view_selections").select("view_id")
      .eq("org_id", ctx.org.id).eq("board_id", current.board_id).eq("user_id", ctx.user.id).maybeSingle();
    let fallback = null;
    if (preference?.view_id) {
      const { data } = await db.from("tab_views").select(COLS).eq("id", preference.view_id).maybeSingle();
      fallback = data;
    }
    const { data: orderedFallback, error: fallbackError } = await db.from("tab_views").select(COLS)
      .eq("org_id", ctx.org.id).eq("board_id", current.board_id)
      .order("is_default", { ascending: false })
      .order("last_used_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (fallbackError) throw fallbackError;
    return jsonOk({ deleted: true, fallback: fallback || orderedFallback ? savedBoardViewFromRow((fallback ?? orderedFallback) as Record<string, unknown>) : null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
