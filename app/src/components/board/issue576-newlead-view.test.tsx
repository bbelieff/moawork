import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import {
  NEW_LEAD_AUTOFILL_COLUMN_KEYS,
  NEW_LEAD_PRIMARY_COLUMN_KEYS,
  NEW_LEAD_TAB,
  presentNewLeadColumnKeys,
  presentNewLeadColumns,
} from "@/lib/default-tabs/new-lead";
import { selectVisibleColumns } from "./filters";

function column(key: string, index: number): BoardColumn {
  return {
    id: `column-${key}`, org_id: "org-a", board_id: "board-a", key,
    label: NEW_LEAD_TAB.columns.find((entry) => entry.key === key)?.label ?? key,
    type: "text", source: "in", rightPinned: false, options_jsonb: null,
    sort_order: index, width: null,
  };
}

describe("Issue #576 신규리드 순서와 표시 컬럼", () => {
  it("회사명 다음 21개 열은 사용자 확정 순서와 exact이고 자동입력 표시는 편집 가능 출처다", () => {
    expect(NEW_LEAD_TAB.columns.slice(0, NEW_LEAD_PRIMARY_COLUMN_KEYS.length).map((entry) => entry.key))
      .toEqual([...NEW_LEAD_PRIMARY_COLUMN_KEYS]);
    expect(NEW_LEAD_TAB.columns.find((entry) => entry.key === "revenue_band")?.label).toBe("3개년매출");
    for (const key of NEW_LEAD_AUTOFILL_COLUMN_KEYS) {
      expect(NEW_LEAD_TAB.columns.find((entry) => entry.key === key)?.source, key).toBe("auto");
    }
  });

  it("앞 N개가 아니라 컬럼 이름의 정확한 집합을 선택한다", () => {
    const columns = NEW_LEAD_PRIMARY_COLUMN_KEYS.slice(0, 4).map(column);
    expect(selectVisibleColumns(columns, ["phone", "applied_on"]).map((entry) => entry.key))
      .toEqual(["applied_on", "phone"]);
    expect(selectVisibleColumns(columns, [])).toEqual([]);
    expect(selectVisibleColumns(columns, null)).toEqual(columns);
  });

  it("도구줄은 8/12/16을 없애고 전체 보기와 실제 컬럼 이름을 설명한다", () => {
    const source = readFileSync(new URL("./BoardToolbar.tsx", import.meta.url), "utf8");
    expect(source).toContain('label="표시 컬럼"');
    expect(source).toContain("전체 보기");
    expect(source).toContain("column.label");
    expect(source).toContain("현재 주소에 남습니다");
    expect(source).not.toContain("COLUMN_LIMITS");
    expect(source).not.toContain("8개");
    expect(source).not.toContain("12개");
    expect(source).not.toContain("16개");
  });

  it("화면은 회사가 저장한 컬럼 순서를 다시 덮어쓰지 않는다", () => {
    const source = readFileSync(new URL("./BoardWorkspace.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("orderNewLeadColumnsLikeMonday(");
    expect(source).toContain("resolveColumnOrder(tableColumns, storedOrder ?? undefined)");
    expect(source).toContain("selectVisibleColumns(resolved, displayFilters.visibleColumnKeys)");
    expect(source).toContain("const shown = columnsForBlock(block.key)");
  });

  it("과거 저장 뷰 alias를 합성 키로 복원하고 BoardWorkspace에서만 finance projection을 적용한다", () => {
    expect(presentNewLeadColumnKeys([
      "owner", "credit_score_ncb", "credit_score_kcb", "revenue_band", "phone",
    ])).toEqual(["owner", "credit_scores", "revenue_3y_million", "phone"]);
    const physical = ["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"].map(column);
    expect(presentNewLeadColumns(physical).map((entry) => entry.key))
      .toEqual(["credit_scores", "revenue_3y_million"]);
    const source = readFileSync(new URL("./BoardWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain("canonicalNewLead ? NEW_LEAD_SAVED_FILTER_PROJECTION : undefined");
    expect(source).toContain("presentNewLeadSavedFilters(filters)");
    expect(source).toContain("presentNewLeadDetailLayout(rawBoardDetailLayout)");
    expect(source).toContain("durableNewLeadColumnKeys(keys)");
    expect(source).toContain("canonicalNewLead && rawFocusColumnKey");
    expect(source).toContain("newLeadPresentationKey(rawFocusColumnKey)");
    expect(source).toContain("legacyFacetLabels={canonicalNewLead ? NEW_LEAD_LEGACY_FACET_LABELS : undefined}");
  });

  it("조건부 필수 매출 입력도 라벨 옆 빨간 별표를 보인다", () => {
    const source = readFileSync(new URL("./NewLeadIntakeFields.tsx", import.meta.url), "utf8");
    expect(source).toContain(
      '<span>정확한 매출액 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>',
    );
    expect(source).toMatch(/name="revenue_band_custom" required/);
  });
});
