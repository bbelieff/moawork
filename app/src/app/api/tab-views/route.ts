import { createRequestBoards } from "@/lib/boards/server";
import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/boards/http";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { parsePersonScopeInput, parseSavedBoardViewConfig, savedBoardViewFromRow } from "@/lib/view/board-saved";
import { requireActiveFixedPerson } from "@/lib/view/server";

const COLS = "id,name,visibility,owner_id,person_scope,person_scope_user_id,config_jsonb,is_default,last_used_at";


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
    // ★ BBE-209 — 저장된 보기는 tab_views 테이블에만 산다. 로컬 시드에는 그 저장소가 «없다».
    //   저장소가 없으면 저장된 보기도 있을 수 없으므로 빈 목록이 사실이다
    //   (형제 엔드포인트 /api/boards/[boardId]/views 도 로컬에서 이미 빈 목록을 돌려준다).
    //   예전엔 여기서 createClient() 가 던져 원문 오류가 화면에 새어 나왔다 —
    //   사용자 화면에 NEXT_PUBLIC_SUPABASE_URL·app/.env.local 이 그대로 보였다.
    if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
      return jsonOk([]);
    }
    const db = await createClient();
    const { data, error } = await db.from("tab_views").select(COLS)
      .eq("org_id", ctx.org.id).eq("board_id", boardId)
      .order("is_default", { ascending: false })
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const canManageShared = ctx.role === "owner" || ctx.role === "admin";
    return jsonOk((data ?? []).map((row) => savedBoardViewFromRow(
      row as Record<string, unknown>,
      row.owner_id === ctx.user.id || canManageShared,
    )));
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
    const scope = parsePersonScopeInput(body.personScope, body.personScopeUserId);
    // 저장은 «쓰기» 다. 로컬 시드에는 저장소가 없으므로 조용히 성공한 척하지 않고 사유를 돌려준다 —
    // 「저장했다」고 해놓고 사라지면 그게 제일 나쁘다.
    if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
      return Response.json({ error: "저장된 보기는 연결된 워크스페이스가 필요합니다." }, { status: 503 });
    }
    const db = await createClient();
    await requireActiveFixedPerson(ctx.org.id, scope, async (orgId, userId) => {
      const { data, error } = await db.from("org_members").select("user_id").eq("org_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle();
      if (error) throw error;
      return { active: data?.user_id === userId };
    });
    const { data, error } = await db.from("tab_views").insert({
      org_id: ctx.org.id,
      board_id: boardId,
      board_key: boardId,
      owner_id: ctx.user.id,
      name,
      kind: config.kind === "table" ? "flat" : config.kind === "calendar" ? "cal" : "board",
      visibility,
      person_scope: scope.personScope,
      person_scope_user_id: scope.personScopeUserId,
      filters_jsonb: config.filters.byColumn,
      sort_jsonb: config.sorts,
      hidden_columns_jsonb: config.hiddenColumns,
      column_order_jsonb: config.columnOrder,
      calendar_field_key: config.calendarFieldKey,
      config_jsonb: config,
      last_used_at: new Date().toISOString(),
    }).select(COLS).single();
    if (error) throw error;
    return jsonOk(savedBoardViewFromRow(data as Record<string, unknown>, true), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
