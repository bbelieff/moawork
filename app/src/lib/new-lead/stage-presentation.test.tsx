// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/boards/b", useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
import { presentNewLeadColumns, NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import { presentWorkflowProgressColumns, withWorkflowProgressValues } from "@/lib/workflow/progress";
import { buildNewLeadStageBlocks, durableNewLeadBlockKey } from "@/components/board/blocks";
import { applyFilters, EMPTY_FILTERS } from "@/components/board/filters";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const statuses = ["상담 전", "1차 부재", "2차 상담예약", "2차 상담완료", "보류", "거절", "직접 만든 값", ""];
const board = { id: "b", org_id: "o", name: "신규리드", source: NEW_LEAD_TAB.source, is_system: false, sort_order: 0 } as Board;
const groups = [{ id: "g", board_id: "b", org_id: "o", name: "원본 사용자 그룹", color: null, sort_order: 0 }] as BoardGroup[];
const columns = [{ id: "c", org_id: "o", board_id: "b", key: "consult_status", label: "상담 상황", type: "status", source: "in", sort_order: 0, rightPinned: false, width: 160,
  options_jsonb: { options: statuses.filter(Boolean).map((id) => ({ id, label: id, color: "#999" })) }, move_rule_jsonb: { "2차 상담예약": "g", "2차 상담완료": "g" },
}] as BoardColumn[];
const rows = statuses.map((value, index) => ({ id: `r${index}`, org_id: "o", board_id: "b", group_id: "g", title: `합성 행 ${index}`, assigned_to: null, deal_id: null, sort_order: index, created_at: "", updated_at: "", values: { consult_status: value } })) as ItemWithValues[];

describe("v17 new-lead stage presentation", () => {
  it("shares labels across board and saved-view columns without changing option IDs, rules or input", () => {
    const before = JSON.stringify(columns);
    const saved = presentNewLeadColumns(columns)[0];
    const boardColumn = presentWorkflowProgressColumns("new-lead", columns)[0];
    expect(saved.options_jsonb?.options).toEqual(boardColumn.options_jsonb?.options);
    expect(saved.options_jsonb?.options.map((option) => option.label)).toEqual(["통화대기", "부재", "재통화", "통화완료", "보류", "거절", "직접 만든 값"]);
    expect(saved.options_jsonb?.options.map((option) => option.id)).toEqual(statuses.filter(Boolean));
    expect(saved.move_rule_jsonb).toEqual(columns[0].move_rule_jsonb);
    expect(JSON.stringify(columns)).toBe(before);
  });
  it("preserves an explicitly customized label and all raw values", () => {
    const custom = { ...columns[0], options_jsonb: { options: [{ id: "상담 전", label: "우리 팀 접수" }] } };
    expect(presentNewLeadColumns([custom])[0].options_jsonb?.options[0].label).toBe("우리 팀 접수");
    expect(withWorkflowProgressValues("new-lead", rows).map((row) => row.values.consult_status)).toEqual(statuses);
  });
  it("separates reservation and completion even in the same physical group, preserving every remaining row", () => {
    const before = JSON.stringify(rows);
    const blocks = buildNewLeadStageBlocks(groups, rows);
    expect(blocks.slice(0, 4).map((block) => [block.name, block.rows.map((row) => row.id)])).toEqual([
      ["통화대기", ["r0"]], ["부재", ["r1"]], ["재통화", ["r2"]], ["통화완료", ["r3"]],
    ]);
    expect(blocks[4].group).toBe(groups[0]);
    expect(blocks.map((block) => durableNewLeadBlockKey(block, groups))).toEqual(Array(5).fill("g"));
    expect(blocks.flatMap((block) => block.rows).map((row) => row.id).sort()).toEqual(rows.map((row) => row.id));
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("searches the displayed label and keeps existing raw-ID saved filters valid", () => {
    const saved = presentNewLeadColumns(columns);
    expect(applyFilters(rows, saved, { ...EMPTY_FILTERS, q: "재통화" }).map((row) => row.id)).toEqual(["r2"]);
    expect(applyFilters(rows, saved, { ...EMPTY_FILTERS, byColumn: { consult_status: ["2차 상담완료"] } }).map((row) => row.id)).toEqual(["r3"]);
    const displayed = withWorkflowProgressValues("new-lead", rows);
    expect(applyFilters(displayed, presentWorkflowProgressColumns("new-lead", columns), { ...EMPTY_FILTERS, q: "통화완료" }).map((row) => row.id)).toEqual(["r3"]);
  });
  it("renders actual board groups and status select aliases while submitting original IDs", async () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<BoardWorkspace board={board} columns={columns} groups={groups} rows={rows} columnOrder={{}} cellFlash={null} assigneeLabels={{}} canEditItems canMoveRows />));
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="진행현황"]')!;
      expect(select).not.toBeNull();
      expect(select.value).toBe("상담 전");
      expect(select.selectedOptions[0].textContent).toBe("통화대기");
      expect(new FormData(select.form!).get("columnKey")).toBe("consult_status");
      expect(new FormData(select.form!).get("value")).toBe("상담 전");
      expect(host.textContent).toContain("원본 사용자 그룹");
      expect(host.querySelectorAll('input[type="checkbox"][aria-label$=" 선택"]').length).toBeGreaterThanOrEqual(8);
      expect(host.querySelector('[aria-label="합성 행 0 위로 이동"]')).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
