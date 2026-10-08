import { jsonError, jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import {
  canOverwriteSavedView,
  parsePersonScopeInput,
  parseSavedBoardViewConfig,
  savedBoardViewFromRow,
  tabViewDbKind,
} from "@/lib/view/board-saved";
import { requireActiveFixedPerson } from "@/lib/view/server";
import type { Ctx } from "@/lib/types";

type Params = { params: Promise<{ viewId: string }> };
const COLS = "id,name,visibility,owner_id,person_scope,person_scope_user_id,config_jsonb,is_default,last_used_at,board_id";
const OVERWRITE_DENIED = "이 뷰는 만든 사람과 관리자만 바꿀 수 있어요.";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * #845 6단계 — 뷰를 덮어쓰거나(조건·이름·공개 범위·기본값) 지우는 것은 만든 사람과 워크스페이스 소유자·관리자만.
 * 화면이 「이 뷰에 저장」 을 감추는 것만으로는 막히지 않으므로 서버가 먼저 읽어 거절한다(RLS 072 도 같은 규칙).
 * 읽을 수 없는 뷰(남의 나만 뷰·다른 회사)는 «없음» 이다.
 */
async function overwriteRefusal(db: Db, ctx: Ctx, viewId: string): Promise<Response | null> {
  const { data, error } = await db.from("tab_views").select("owner_id")
    .eq("id", viewId).eq("org_id", ctx.org.id).maybeSingle();
  if (error) throw error;
  if (!data) return jsonError("뷰를 찾지 못했어요.", 404);
  const ownerId = typeof data.owner_id === "string" ? data.owner_id : null;
  return canOverwriteSavedView({ ownerId }, { userId: ctx.user.id, role: ctx.role })
    ? null
    : jsonError(OVERWRITE_DENIED, 403);
}

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
    const refusal = await overwriteRefusal(db, ctx, viewId);
    if (refusal) return refusal;
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
      patch.kind = tabViewDbKind(config.kind);
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
    const refusal = await overwriteRefusal(db, ctx, viewId);
    if (refusal) return refusal;
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
