import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedViewsController } from "./SavedViewsController";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";

const controller = readFileSync(resolve(process.cwd(), "src/components/view/SavedViewsController.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/boards/[id]/page.tsx"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/072_tab_views.sql"), "utf8");
const collectionRoute = readFileSync(resolve(process.cwd(), "src/app/api/tab-views/route.ts"), "utf8");
const itemRoute = readFileSync(resolve(process.cwd(), "src/app/api/tab-views/[viewId]/route.ts"), "utf8");

describe("saved view production consumer", () => {
  it("canonical flat consumer가 합성 금융 셀과 #618 담당자 lineage를 실제 렌더한다", () => {
    const keys = ["owner", "credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"] as const;
    const columns = keys.map((key, index) => ({
      id: `column-${key}`, org_id: "org-a", board_id: "board-a", key,
      label: key === "owner" ? "담당자" : key === "credit_score_ncb" ? "NCB" : key === "credit_score_kcb" ? "KCB" : key === "revenue_band" ? "3개년매출" : "매출(백만원)",
      type: key === "owner" ? "person" : key === "revenue_3y_million" ? "number" : "text",
      source: "in", rightPinned: false, options_jsonb: null, sort_order: index, width: null,
    })) as BoardColumn[];
    const row: ItemWithValues = {
      id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a",
      title: "테스트 회사", assigned_to: "user-a", deal_id: "deal-a", sort_order: 0,
      created_at: "", updated_at: "",
      values: { owner: "user-a", credit_score_ncb: 812, credit_score_kcb: 745, revenue_3y_million: 1234, revenue_band: "10억~30억" },
    };
    const html = renderToStaticMarkup(createElement(SavedViewsController, {
      boardId: "board-a", orgId: "org-a", currentUserId: "user-a",
      columns, rows: [row], renderMode: "flat", canEditItems: true,
      canonicalNewLead: true, memberOptions: [{ id: "user-a", label: "담당자 가" }],
      groups: [{id:"group-a",org_id:"org-a",board_id:"board-a",name:"접수",color:null,sort_order:0}],
      rowOrderVersion: 4, canMoveRows: true, canManageColumns: true, canManageSections: true,
    }));
    expect(html.match(/신용점수/g)?.length).toBeGreaterThan(0);
    expect(html.match(/매출\(백만원\)/g)?.length).toBeGreaterThan(0);
    expect(html).toContain('name="fieldKey" value="credit_score_ncb"');
    expect(html).toContain('name="fieldKey" value="credit_score_kcb"');
    expect(html).not.toContain('name="fieldKey" value="credit_scores"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("담당자 가");
    expect(html).toContain("그룹 이름 편집");
    expect(html).toContain("컬럼 이름 편집");
    expect(html).toContain('name="expectedVersion" value="4"');
    const creditHeader=html.match(/<th(?=[^>]*data-column-key="credit_scores")[\s\S]*?<\/th>/)?.[0]??"";
    expect(creditHeader).not.toContain("컬럼 이름 편집");
  });

  it("mounts all three view kinds and restores saved presentation state", () => {
    expect(controller).toContain("<ViewTabs");
    expect(controller).toContain("<ViewPicker");
    expect(controller).toContain("<SaveViewDialog");
    expect(controller).toContain("<TableView");
    expect(controller).toContain("<CalendarView");
    expect(controller).toContain("config.hiddenColumns");
    expect(controller).toContain("config.columnOrder");
    expect(controller).toContain("config.calendarFieldKey");
    expect(controller).toContain("parseSavedStringList");
    expect(controller).toContain("filters.sorts");
    expect(controller).toContain("textMode={config.textMode}");
    expect(controller).toContain("focusColumnKey={config.focusColumnKey}");
    expect(controller).toContain("applySavedPersonScope(rows, activeSaved, currentUserId, personColumnKey, teamMemberIds, canonicalNewLead)");
    expect(page).toContain("const items = applySavedPersonScope(permissionItems, personRuntime.view");
    expect(page).toContain("personRuntime.memberIds, board.source === NEW_LEAD_TAB_SOURCE)");
    expect(page).toContain("teamMemberIds={personRuntime.memberIds}");
    expect(page).toContain("applySavedKanbanView(");
    expect(page).toContain('view === "flat" || view === "calendar"');
    expect(page).toContain("parseSavedBoardLayout(sp.mwLayout)");
    expect(page).toContain("presentNewLeadSavedFilters(decodeBoardFilters(sp.mwFilters ?? null))");
    expect(page).toContain("canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined");
    expect(page.match(/canonicalNewLead=\{canonicalNewLead\}/g)).toHaveLength(3);
    expect(page.match(/memberOptions=\{memberDirectory\}/g)).toHaveLength(3);
    expect(controller).toContain("presentNewLeadColumns(columns)");
    expect(controller).toContain("presentNewLeadSavedViewConfig(view.config)");
    expect(controller).toContain("durableNewLeadSavedViewConfig(nextConfig)");
    expect(controller).toContain("applyFilters(personScopedRows, displayColumns, config.filters, filterProjection)");
    expect(controller).toContain("canonicalNewLead={canonicalNewLead} members={memberOptions}");
    expect(page).toContain("<BoardHeader");
    expect(controller).toContain("moveRowAction");
    expect(controller).toContain("rowMoveIntentRef");
    expect(controller).toContain("GroupNameEditor");
    expect(controller).toContain("renameColumnTitleAction");
  });

  it("lets a second org member select a shared view without owner-only UPDATE", () => {
    expect(migration).toMatch(/visibility = 'shared' or owner_id = auth\.uid\(\)/);
    expect(migration).toMatch(/owner_id = auth\.uid\(\) or public\.org_role/);
    expect(controller).toMatch(/savedViewUrl\([\s\S]*?saved[\s\S]*?window\.location\.href/);
    expect(controller).not.toContain("touch: true");
    expect(controller).toContain("selected: true");
    expect(controller).toContain("<BoardCell");
    expect(controller).toContain("changeCalendarField");
  });

  it("keeps normalized DB columns in sync and exposes editability without weakening RLS", () => {
    expect(collectionRoute).toContain('ctx.role === "owner" || ctx.role === "admin"');
    expect(collectionRoute).toContain("row.owner_id === ctx.user.id || canManageShared");
    expect(collectionRoute).toContain("sort_jsonb: config.sorts");
    expect(collectionRoute).toContain("person_scope: scope.personScope");
    expect(collectionRoute).toContain("person_scope_user_id: scope.personScopeUserId");
    expect(controller).toContain("personScope: input.personScope");
    expect(itemRoute).toContain("patch.sort_jsonb = config.sorts");
    expect(itemRoute).toContain("patch.person_scope = scope.personScope");
    expect(collectionRoute).toContain("requireActiveFixedPerson(ctx.org.id, scope");
    expect(itemRoute).toContain("requireActiveFixedPerson(ctx.org.id, scope");
    expect(collectionRoute).toContain('.eq("org_id", orgId).eq("user_id", userId).eq("status", "active")');
    expect(itemRoute).toContain('.eq("org_id", orgId).eq("user_id", userId).eq("status", "active")');
    expect(itemRoute).toContain("patch.hidden_columns_jsonb = config.hiddenColumns");
    expect(itemRoute).toContain("patch.column_order_jsonb = config.columnOrder");
    expect(migration).toMatch(/public\.is_org_member\(org_id\)/);
    expect(migration).toMatch(/owner_id = auth\.uid\(\) or public\.org_role/);
  });
});
