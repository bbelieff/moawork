// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { newLeadPresentationKey, presentNewLeadColumns } from "@/lib/default-tabs/new-lead";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

const keys = [
  "owner", "collaborators", "applied_on", "rep_name", "phone", "email", "industry",
  "credit_scores", "founded_month", "revenue_3y_million", "contact_move",
] as const;
const columns: BoardColumn[] = keys.map((key, index) => ({
  id: `c-${key}`,
  org_id: "org-a",
  board_id: "board-a",
  key,
  label: key === "industry" ? "업종" : key,
  type: key === "phone" ? "phone" : key === "owner" ? "person" : key === "collaborators" ? "people" : key === "applied_on" ? "date" : key === "revenue_3y_million" ? "number" : "text",
  source: key === "industry" ? "auto" : "in",
  rightPinned: key === "contact_move",
  options_jsonb: null,
  sort_order: index,
  width: null,
}));

const row: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a",
  title: "예시 리드", assigned_to: null, deal_id: "deal-a", sort_order: 0,
  created_at: "2026-08-21T00:00:00Z", updated_at: "2026-08-21T00:00:00Z",
  values: {
    industry: "기존 업종",
    credit_score_ncb: 812,
    credit_score_kcb: 745,
    founded_month: "2024-02-29",
    revenue_3y_million: 1234,
    revenue_band: "10억~30억",
  },
};

function render(
  focusColumnKey: string | null = null,
  renderedColumns: readonly BoardColumn[] = columns,
  renderedRows: readonly ItemWithValues[] = [row],
) {
  return renderToStaticMarkup(
    <GroupTable
      boardId="board-a" groupId="group-a" columns={renderedColumns} rows={renderedRows} readOnly={false}
      canonicalNewLead
      newLeadMembers={[{ id: "user-a", label: "담당자 가" }]}
      currentUserId="user-a"
      focusColumnKey={focusColumnKey}
      rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null}
      canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}}
    />,
  );
}

describe("BBE-171 new-lead GroupTable wiring", () => {
  it("보드 컬럼을 바로 채울 수 있는 회사 등록 필드와 동일한 사람 선택 UI를 보여준다", () => {
    const html = render();
    expect(html).toContain("＋ 새 항목");
    expect(html).toContain("회사명");
    expect(html).toContain("필수");
    expect(html).toContain("사업자유형");
    expect(html).toContain("개인사업자");
    expect(html).toContain("법인사업자");
    expect(html).toContain("그외");
    expect(html).toContain("연락처");
    expect(html).toContain("담당자 가 (나)");
    expect(html).toContain("대표자명");
    expect(html).toContain("이메일");
    expect(html).toContain("업종");
    expect(html).toContain("담당자 1명");
    expect(html).toContain("연관담당 · 알림받는 사람 여러 명");
    expect(html).not.toContain("등록과 동시에 준비되는 값");
    expect(html).toContain("취소");
  });

  it("does not infer a canonical board from matching custom columns", () => {
    const html = renderToStaticMarkup(<GroupTable boardId="board-a" groupId="group-a" columns={columns} rows={[row]} readOnly={false} rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null} canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}} />);
    expect(html).not.toContain('name="dealId"');
    expect(html).not.toContain("＋ 새 회사");
  });

  it("keeps canonical metadata editable while routing owner through assignment lineage only", () => {
    const html = render();
    expect(html).toContain('name="dealId" value="deal-a"');
    expect(html).toContain('name="field" value="industry"');
    expect(html).toContain('name="value" value="기존 업종"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("미배정");
    expect(html).not.toContain('name="field" value="owner"');
    expect(html).not.toContain('name="kind" value="person"');
    expect(html).toContain('name="field" value="collaborators"');
    expect(html).toContain('name="field" value="applied_on"');
  });

  it("keeps the deal ledger out of the new-lead row while preserving the detail opener", () => {
    const html = render();
    expect(html).toContain("열기");
    expect(html).not.toContain("원장");
  });

  it("합성 금융 셀을 table leaf로 연결하고 generic credit_scores 쓰기를 만들지 않는다", () => {
    const html = render();
    expect(html).toContain("NCB");
    expect(html).toContain("KCB");
    expect(html).toContain('name="fieldKey" value="credit_score_ncb"');
    expect(html).toContain('name="fieldKey" value="credit_score_kcb"');
    expect(html).not.toContain('name="columnKey" value="credit_scores"');
    expect(html).not.toContain('name="fieldKey" value="credit_scores"');
    expect(html).toContain('value="2024-02-29"');
    expect(html).toContain('value="1,234"');
    expect(html).toContain("백만원");
  });

  it("canManageColumns여도 합성 credit header는 구조 menu·resize·drag를 노출하지 않는다", () => {
    const html = render();
    const creditHeader = html.match(/<th(?=[^>]*data-column-key="credit_scores")[\s\S]*?<\/th>/)?.[0] ?? "";
    const ownerHeader = html.match(/<th(?=[^>]*data-column-key="owner")[\s\S]*?<\/th>/)?.[0] ?? "";
    expect(creditHeader).not.toBe("");
    expect(creditHeader).not.toContain('draggable="true"');
    expect(creditHeader).not.toContain("credit_scores 컬럼 메뉴");
    expect(creditHeader).not.toContain("cursor-col-resize");
    expect(ownerHeader).toContain('draggable="true"');
    expect(ownerHeader).toContain("owner 컬럼 메뉴");
    expect(ownerHeader).toContain("cursor-col-resize");
  });

  it("numeric 매출 컬럼 archive fallback만 구조 제어를 잠그고 restore하면 물리 제어를 되돌린다", () => {
    const bandColumn: BoardColumn = {
      ...columns[0],
      id: "band-real",
      key: "revenue_band",
      label: "기존 매출구간",
      type: "select",
    };
    const numericColumn: BoardColumn = {
      ...columns[0],
      id: "revenue-real",
      key: "revenue_3y_million",
      label: "3개년매출(백만원)",
      type: "number",
    };
    const fallbackColumns = presentNewLeadColumns([bandColumn]);
    const fallbackRow = { ...row, values: { revenue_band: "10억~30억" } };
    const fallbackHtml = render(null, fallbackColumns, [fallbackRow]);
    const fallbackHeader = fallbackHtml.match(/<th(?=[^>]*data-column-key="revenue_3y_million")[\s\S]*?<\/th>/)?.[0] ?? "";

    expect(fallbackColumns[0].id).toBe("band-real:revenue-3y-million");
    expect(fallbackHtml).toContain("10억~30억");
    expect(fallbackHeader).not.toContain('draggable="true"');
    expect(fallbackHeader).not.toContain("컬럼 메뉴");
    expect(fallbackHeader).not.toContain("cursor-col-resize");

    const restoredColumns = presentNewLeadColumns([bandColumn, numericColumn]);
    const restoredHtml = render(null, restoredColumns);
    const restoredHeader = restoredHtml.match(/<th(?=[^>]*data-column-key="revenue_3y_million")[\s\S]*?<\/th>/)?.[0] ?? "";
    expect(restoredColumns[0].id).toBe("revenue-real");
    expect(restoredHeader).toContain('draggable="true"');
    expect(restoredHeader).toContain("3개년매출(백만원) 컬럼 메뉴");
    expect(restoredHeader).toContain("cursor-col-resize");
  });

  it("presentation-only revenue fallback은 다른 물리 컬럼의 drop target도 되지 않는다", async () => {
    const bandColumn: BoardColumn = {
      ...columns[0], id: "band-real", key: "revenue_band", label: "기존 매출구간", type: "select",
    };
    const ownerColumn = columns.find((column) => column.key === "owner")!;
    const renderedColumns = [ownerColumn, ...presentNewLeadColumns([bandColumn])];
    const onColumnDrop = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(
      <GroupTable
        boardId="board-a" groupId="group-a" columns={renderedColumns} rows={[row]} readOnly={false}
        canonicalNewLead rowDragEnabled={false} cellFlash={null} onColumnDrop={onColumnDrop}
        dragRowId={null} canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}}
        onRowDrop={() => {}}
      />,
    ));
    const ownerHeader = host.querySelector<HTMLElement>('[data-column-key="owner"]')!;
    const fallbackHeader = host.querySelector<HTMLElement>('[data-column-key="revenue_3y_million"]')!;
    await act(async () => {
      ownerHeader.dispatchEvent(new Event("dragstart", { bubbles: true }));
      fallbackHeader.dispatchEvent(new Event("dragover", { bubbles: true }));
      fallbackHeader.dispatchEvent(new Event("drop", { bubbles: true }));
    });

    expect(onColumnDrop).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it.each([
    ["credit_score_ncb", "credit_scores"],
    ["credit_score_kcb", "credit_scores"],
    ["revenue_band", "revenue_3y_million"],
    ["revenue_3y_million", "revenue_3y_million"],
  ])("physical saved focus %s highlights the logical %s header and cell", (physical, presentation) => {
    const html = render(newLeadPresentationKey(physical));
    expect(newLeadPresentationKey(physical)).toBe(presentation);
    expect(html.match(/data-view-focus="true"/g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`data-view-focus="true"[^>]*data-column-key="${presentation}"|data-column-key="${presentation}"[^>]*data-view-focus="true"`));
  });
});
