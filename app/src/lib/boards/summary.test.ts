import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "./types";
import {
  boardSummaryCandidates,
  buildBoardSummaryModel,
  normalizeBoardSummaryConfig,
  type BoardSummaryMetricConfig,
} from "./summary";

function column(key: string, label: string, type: BoardColumn["type"], options: BoardColumn["options_jsonb"] = null): BoardColumn {
  return {
    id: `column-${key}`, org_id: "org", board_id: "board", key, label, type,
    source: "in", rightPinned: false, options_jsonb: options, sort_order: 0, width: null,
  };
}

function row(id: string, values: ItemWithValues["values"]): ItemWithValues {
  return {
    id, org_id: "org", board_id: "board", group_id: "group", title: id,
    assigned_to: null, deal_id: null, sort_order: 0,
    created_at: "2026-08-27T00:00:00Z", updated_at: "2026-08-27T00:00:00Z", values,
  };
}

const configs: BoardSummaryMetricConfig[] = [
  { id: "status", kind: "distribution", columnKey: "status" },
  { id: "amount", kind: "sum", columnKey: "amount" },
];

describe("Issue #605 board summary domain", () => {
  it("keeps ordered unique ids and targets and enforces maximum three", () => {
    expect(normalizeBoardSummaryConfig([
      ...configs,
      { id: "status-copy", kind: "distribution", columnKey: "status" },
      { id: "amount", kind: "sum", columnKey: "duplicate-id" },
      { id: "quantity", kind: "sum", columnKey: "quantity" },
      { id: "fourth", kind: "sum", columnKey: "fourth" },
    ]).map((metric) => metric.id)).toEqual(["status", "amount", "quantity"]);
  });

  it("aggregates option ids and keeps empty and unknown values explicit", () => {
    const model = buildBoardSummaryModel({
      config: configs.slice(0, 1),
      columns: [column("status", "상담상황", "status", { options: [
        { id: "waiting", label: "상담 대기" },
        { id: "done", label: "상담 완료", archived: true },
      ] })],
      rows: [row("1", { status: "waiting" }), row("2", { status: "done" }), row("3", { status: null }), row("4", { status: "legacy" })],
      coverage: { state: "complete" },
      scope: { kind: "filtered", totalCount: 9 },
    });
    expect(model.scopeLabel).toBe("필터 결과 · 4/9건");
    expect(model.metrics[0]).toMatchObject({ status: "ready", kind: "distribution", buckets: [
      { id: "waiting", label: "상담 대기", count: 1, kind: "option" },
      { id: "done", label: "상담 완료", count: 1, kind: "option" },
      { id: "__empty__", label: "미입력", count: 1, kind: "empty" },
      { id: "__unknown__", label: "알 수 없음", count: 1, kind: "unknown" },
    ] });
  });

  it("sums only finite typed number and money values and reports exclusions", () => {
    const model = buildBoardSummaryModel({
      config: configs.slice(1),
      columns: [column("amount", "계약금", "money")],
      rows: [
        row("1", { amount: 1200 }), row("2", { amount: -200 }), row("3", { amount: null }),
        row("4", { amount: "300" }), row("5", { amount: Number.POSITIVE_INFINITY }),
      ],
      coverage: { state: "complete" }, scope: { kind: "all" },
    });
    expect(model.metrics[0]).toMatchObject({
      status: "ready",
      kind: "sum",
      valueType: "money",
      total: 1000,
      includedCount: 2,
      emptyCount: 1,
      invalidCount: 2,
      excludedCount: 0,
    });
  });

  it("distinguishes null-only values from a real numeric zero", () => {
    const columns = [column("amount", "계약금", "money")];
    const empty = buildBoardSummaryModel({
      config: configs.slice(1), columns, rows: [row("empty", { amount: null })],
      coverage: { state: "complete" }, scope: { kind: "all" },
    });
    const zero = buildBoardSummaryModel({
      config: configs.slice(1), columns, rows: [row("zero", { amount: 0 })],
      coverage: { state: "complete" }, scope: { kind: "all" },
    });

    expect(empty.metrics[0]).toMatchObject({ status: "ready", total: 0, includedCount: 0, emptyCount: 1 });
    expect(zero.metrics[0]).toMatchObject({ status: "ready", total: 0, includedCount: 1, emptyCount: 0 });
  });

  it("classifies arithmetic overflow separately from empty and invalid values", () => {
    const model = buildBoardSummaryModel({
      config: configs.slice(1),
      columns: [column("amount", "계약금", "money")],
      rows: [
        row("included", { amount: Number.MAX_VALUE }),
        row("excluded", { amount: Number.MAX_VALUE }),
        row("empty", { amount: null }),
        row("invalid", { amount: "not-a-number" }),
      ],
      coverage: { state: "complete" }, scope: { kind: "all" },
    });

    expect(model.metrics[0]).toMatchObject({
      status: "ready",
      includedCount: 1,
      emptyCount: 1,
      invalidCount: 1,
      excludedCount: 1,
    });
  });

  it("does not disguise failed or partial coverage as a truthful zero", () => {
    const columns = [column("amount", "계약금", "money")];
    const failed = buildBoardSummaryModel({ config: configs.slice(1), columns, rows: [], coverage: { state: "failed", message: "timeout" }, scope: { kind: "all" } });
    expect(failed.metrics[0]).toMatchObject({ status: "unavailable", reason: "coverage-failed" });
    expect(failed.scopeLabel).toBe("전체 · 건수 확인 불가");

    const partial = buildBoardSummaryModel({ config: configs.slice(1), columns, rows: [row("1", { amount: 10 })], coverage: { state: "partial" }, scope: { kind: "saved-view" } });
    expect(partial.coverage.state).toBe("partial");
    expect(partial.metrics[0]).toMatchObject({ status: "ready", total: 10 });
  });

  it("rejects hidden, missing and mistyped summary targets instead of substituting another column", () => {
    const hidden = { ...column("amount", "계약금", "money"), summary_hidden: true };
    const model = buildBoardSummaryModel({
      config: [
        { id: "hidden", kind: "sum", columnKey: "amount" },
        { id: "wrong", kind: "sum", columnKey: "status" },
        { id: "gone", kind: "sum", columnKey: "gone" },
      ],
      columns: [hidden, column("status", "상담상황", "status")], rows: [], coverage: { state: "complete" }, scope: { kind: "all" },
    });
    expect(model.metrics.map((metric) => metric.status === "unavailable" ? metric.reason : "ready"))
      .toEqual(["hidden-column", "unsupported-type", "missing-column"]);
  });

  it("offers only typed, visible, unselected candidates", () => {
    expect(boardSummaryCandidates([
      column("status", "상담상황", "status"),
      column("amount", "계약금", "money"),
      { ...column("quantity", "수량", "number"), summary_hidden: true },
      column("memo", "메모", "text"),
    ], configs.slice(0, 1))).toEqual([{ kind: "sum", columnKey: "amount", label: "계약금", valueType: "money" }]);
  });
});
