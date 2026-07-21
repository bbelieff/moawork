import { describe, expect, it } from "vitest";
import type { Deal, Stage } from "@/lib/types";
import {
  dealsForBoard,
  getStageBoard,
  groupByStage,
  STAGE_BOARDS,
  stagesForBoard,
} from "./stageBoards";

function stage(id: string, kind: Stage["kind"], sort_order = 0): Stage {
  return { id, pipeline_id: "p1", name: id, sort_order, kind };
}

function deal(id: string, stage_id: string | null): Deal {
  return {
    id,
    org_id: "o1",
    company_id: null,
    pipeline_id: "p1",
    stage_id,
    assigned_to: null,
    title: id,
    amount: null,
    status_note: null,
    applied_on: null,
    custom: {},
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
  };
}

describe("STAGE_BOARDS", () => {
  it("B2 대상 3개 보드를 002 시드 단계명/kind 로 정의한다", () => {
    expect(STAGE_BOARDS.map((b) => [b.slug, b.title, b.kind])).toEqual([
      ["newcust", "신규고객", "marketing"],
      ["contract", "컨텍관리", "meeting"],
      ["work", "업무관리", "work"],
    ]);
  });

  it("slug 로 보드를 찾고, 없으면 undefined", () => {
    expect(getStageBoard("work")?.title).toBe("업무관리");
    expect(getStageBoard("nope")).toBeUndefined();
  });
});

describe("stagesForBoard", () => {
  it("해당 kind 만 골라 sort_order 순으로 준다", () => {
    const stages = [
      stage("b", "work", 2),
      stage("a", "work", 1),
      stage("x", "marketing", 0),
    ];
    expect(stagesForBoard(stages, "work").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const stages = [stage("b", "work", 2), stage("a", "work", 1)];
    stagesForBoard(stages, "work");
    expect(stages.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("일치하는 단계가 없으면 빈 배열", () => {
    expect(stagesForBoard([stage("x", "marketing")], "settle")).toEqual([]);
  });
});

describe("dealsForBoard", () => {
  const stages = [stage("s1", "work"), stage("s2", "work")];

  it("보드 단계에 속한 딜만 남긴다", () => {
    const deals = [deal("d1", "s1"), deal("d2", "other"), deal("d3", "s2")];
    expect(dealsForBoard(deals, stages).map((d) => d.id)).toEqual(["d1", "d3"]);
  });

  it("단계 미배정(stage_id=null) 딜은 어느 보드에도 넣지 않는다", () => {
    expect(dealsForBoard([deal("d1", null)], stages)).toEqual([]);
  });

  it("보드에 단계가 없으면 빈 배열", () => {
    expect(dealsForBoard([deal("d1", "s1")], [])).toEqual([]);
  });
});

describe("groupByStage", () => {
  it("단계 순서대로 묶고, 빈 단계도 컬럼으로 남긴다", () => {
    const stages = [stage("s1", "work", 0), stage("s2", "work", 1)];
    const grouped = groupByStage([deal("d1", "s1")], stages);
    expect(grouped.map((g) => [g.stage.id, g.deals.length])).toEqual([
      ["s1", 1],
      ["s2", 0],
    ]);
  });
});
