import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { BoardSummaryStrip } from "./BoardSummaryStrip";

function column(key: string, label: string, type: BoardColumn["type"], options: BoardColumn["options_jsonb"] = null): BoardColumn {
  return { id: key, org_id: "org", board_id: "board", key, label, type, source: "in", rightPinned: false, options_jsonb: options, sort_order: 0, width: null };
}
function row(id: string, values: ItemWithValues["values"]): ItemWithValues {
  return { id, org_id: "org", board_id: "board", group_id: "group", title: id, assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "", values };
}

const columns = [
  column("status", "상담상황", "status", { options: [{ id: "waiting", label: "대기" }, { id: "done", label: "완료" }, { id: "hold", label: "보류" }] }),
  column("amount", "계약금", "money"),
];
const config = [
  { id: "status", kind: "distribution" as const, columnKey: "status" },
  { id: "amount", kind: "sum" as const, columnKey: "amount" },
];

describe("Issue #605 BoardSummaryStrip", () => {
  it("keeps scope, compact metrics and settings on one truncating line", () => {
    const formatter = vi.fn((value: number, type: "number" | "money") => type === "money" ? `${value}원` : String(value));
    const html = renderToStaticMarkup(
      <BoardSummaryStrip
        config={config}
        columns={columns}
        rows={[row("1", { status: "waiting", amount: 1000 }), row("2", { status: "done", amount: 500 }), row("3", { status: "hold", amount: null })]}
        coverage={{ state: "complete" }}
        scope={{ kind: "filtered", totalCount: 8 }}
        formatValue={formatter}
        settings={<button type="button">요약 설정</button>}
      />,
    );
    expect(html).toContain("필터 결과 · 3/8건");
    expect(html).toContain("상담상황 대기 1 · 완료 1 · 외 1종");
    expect(html).toContain("계약금 1500원");
    expect(html).toContain("요약 설정");
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("data-summary-settings");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="상담상황: 대기 1 · 완료 1 · 보류 1"');
    expect(formatter).toHaveBeenCalledWith(1500, "money");
  });

  it("renders null-only money as missing but preserves a real numeric zero", () => {
    const formatter = vi.fn((value: number) => `${value}원`);
    const missing = renderToStaticMarkup(
      <BoardSummaryStrip
        config={config.slice(1)} columns={columns} rows={[row("missing", { amount: null })]}
        coverage={{ state: "complete" }} scope={{ kind: "all" }} formatValue={formatter}
        settings={<button>요약 설정</button>}
      />,
    );
    expect(missing).toContain("계약금 · 미입력");
    expect(missing).not.toContain("계약금 0원");
    expect(formatter).not.toHaveBeenCalled();

    const zero = renderToStaticMarkup(
      <BoardSummaryStrip
        config={config.slice(1)} columns={columns} rows={[row("zero", { amount: 0 })]}
        coverage={{ state: "complete" }} scope={{ kind: "all" }} formatValue={formatter}
        settings={<button>요약 설정</button>}
      />,
    );
    expect(zero).toContain("계약금 0원");
    expect(formatter).toHaveBeenCalledWith(0, "money");
  });

  it("labels partial coverage and excluded values without turning either into zero", () => {
    const html = renderToStaticMarkup(
      <BoardSummaryStrip
        config={config.slice(1)} columns={columns}
        rows={[row("1", { amount: "1000" })]}
        coverage={{ state: "partial", message: "page limit" }} scope={{ kind: "saved-view" }}
        formatValue={(value) => String(value)} settings={<button>요약 설정</button>}
      />,
    );
    expect(html).toContain("현재 뷰 · 1건");
    expect(html).toContain("일부 데이터 기준");
    expect(html).toContain("일부 값 제외 1건");
  });

  it("renders a failed read as unavailable instead of a truthful zero", () => {
    const html = renderToStaticMarkup(
      <BoardSummaryStrip
        config={config.slice(1)} columns={columns} rows={[]}
        coverage={{ state: "failed", message: "timeout" }} scope={{ kind: "all" }}
        formatValue={(value) => String(value)} settings={<button>요약 설정</button>}
      />,
    );
    expect(html).toContain("요약 조회 실패");
    expect(html).toContain("전체 · 건수 확인 불가");
    expect(html).toContain("계약금 · 조회 실패");
    expect(html).not.toContain("0건");
    expect(html).not.toContain("계약금 0");
  });
});
