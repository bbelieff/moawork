/**
 * 저장된 뷰 CRUD (BBE-117). `tab_views`(035) 에 직접 붙는다.
 * RLS가 읽기 범위(공용|본인)를 걸러주므로 여기서는 org_id/board_key 로만 좁힌다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewTabViewInput, TabView, TabViewRow, ViewFilterMap, ViewSort, Visibility } from "./contracts";
import { parseTabView, parseTabViews } from "./contracts";

export class ViewServiceError extends Error {
  constructor(
    readonly op: string,
    readonly cause: { message: string; code?: string },
  ) {
    super(`[view/${op}] ${cause.message}`);
    this.name = "ViewServiceError";
  }
}

const COLUMNS =
  "id, org_id, board_key, owner_id, name, kind, visibility, person_scope, person_scope_user_id, filters_jsonb, sort_jsonb, hidden_columns_jsonb, column_order_jsonb, calendar_field_key, created_at, updated_at";

function toRow(input: NewTabViewInput): Record<string, unknown> {
  return {
    org_id: input.orgId,
    board_key: input.boardKey,
    owner_id: input.ownerId,
    name: input.name,
    kind: input.kind,
    visibility: input.visibility,
    person_scope: input.personScope,
    person_scope_user_id: input.personScopeUserId ?? null,
    filters_jsonb: input.filters,
    sort_jsonb: input.sort ?? [],
    hidden_columns_jsonb: input.hiddenColumns ?? [],
    column_order_jsonb: input.columnOrder ?? [],
    calendar_field_key: input.calendarFieldKey ?? null,
  };
}

export class ViewService {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, error: { message: string; code?: string }): never {
    throw new ViewServiceError(op, error);
  }

  /** 한 탭(board_key)의 저장된 뷰 전체 — 공용 + 본인 뷰(RLS가 그 이상은 안 준다). */
  async list(orgId: string, boardKey: string): Promise<TabView[]> {
    const { data, error } = await this.db
      .from("tab_views")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("board_key", boardKey)
      .order("created_at");
    if (error) this.fail("list", error);
    return parseTabViews((data ?? []) as TabViewRow[]);
  }

  async create(input: NewTabViewInput): Promise<TabView> {
    const { data, error } = await this.db.from("tab_views").insert(toRow(input)).select(COLUMNS).single();
    if (error) this.fail("create", error);
    const view = parseTabView(data as TabViewRow);
    if (!view) this.fail("create", { message: "저장 직후 응답을 해석하지 못했습니다." });
    return view;
  }

  async rename(id: string, name: string): Promise<TabView> {
    const { data, error } = await this.db
      .from("tab_views")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) this.fail("rename", error);
    const view = parseTabView(data as TabViewRow);
    if (!view) this.fail("rename", { message: "저장 직후 응답을 해석하지 못했습니다." });
    return view;
  }

  async setVisibility(id: string, visibility: Visibility): Promise<TabView> {
    const { data, error } = await this.db
      .from("tab_views")
      .update({ visibility, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) this.fail("setVisibility", error);
    const view = parseTabView(data as TabViewRow);
    if (!view) this.fail("setVisibility", { message: "저장 직후 응답을 해석하지 못했습니다." });
    return view;
  }

  async updateCondition(
    id: string,
    patch: { filters?: ViewFilterMap; sort?: readonly ViewSort[]; hiddenColumns?: readonly string[]; columnOrder?: readonly string[] },
  ): Promise<TabView> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.filters !== undefined) row.filters_jsonb = patch.filters;
    if (patch.sort !== undefined) row.sort_jsonb = patch.sort;
    if (patch.hiddenColumns !== undefined) row.hidden_columns_jsonb = patch.hiddenColumns;
    if (patch.columnOrder !== undefined) row.column_order_jsonb = patch.columnOrder;
    const { data, error } = await this.db.from("tab_views").update(row).eq("id", id).select(COLUMNS).single();
    if (error) this.fail("updateCondition", error);
    const view = parseTabView(data as TabViewRow);
    if (!view) this.fail("updateCondition", { message: "저장 직후 응답을 해석하지 못했습니다." });
    return view;
  }

  /** 복제 — 이름 뒤에 " 사본"을 붙이고 항상 나만 보기로 만든다(공용을 함부로 늘리지 않음). */
  async duplicate(view: TabView, ownerId: string): Promise<TabView> {
    return this.create({
      orgId: view.orgId,
      boardKey: view.boardKey,
      ownerId,
      name: `${view.name} 사본`,
      kind: view.kind,
      visibility: "private",
      personScope: view.personScope,
      personScopeUserId: view.personScopeUserId,
      filters: view.filters,
      sort: view.sort,
      hiddenColumns: view.hiddenColumns,
      columnOrder: view.columnOrder,
      calendarFieldKey: view.calendarFieldKey,
    });
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("tab_views").delete().eq("id", id);
    if (error) this.fail("remove", error);
  }
}
