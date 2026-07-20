import { describe, it, expect } from "vitest";
import type { BoardItem } from "./types";
import {
  filterByStage,
  sortByStage,
  countByStage,
  groupByStage,
} from "./pipeline";

const COL = "contract_status";
// 단계 순서는 호출부가 주입(시드 옵션 순서 모사). 실 도메인 값 아님.
const ORDER = ["상담중", "계약대기", "진행중", "완료"] as const;

const items: BoardItem[] = [
  { id: "a", cells: { [COL]: "진행중" } },
  { id: "b", cells: { [COL]: "상담중" } },
  { id: "c", cells: { [COL]: "완료" } },
  { id: "d", cells: { [COL]: "상담중" } },
  { id: "e", cells: { [COL]: null } }, // 미지정
];

describe("filterByStage", () => {
  it("해당 단계 아이템만 남긴다", () => {
    expect(filterByStage(items, COL, "상담중").map((i) => i.id)).toEqual([
      "b",
      "d",
    ]);
  });

  it("없는 단계는 빈 배열", () => {
    expect(filterByStage(items, COL, "없는단계")).toEqual([]);
  });
});

describe("sortByStage", () => {
  it("단계 순서대로 정렬하고 미지정은 뒤로", () => {
    expect(sortByStage(items, COL, ORDER).map((i) => i.id)).toEqual([
      "b", // 상담중
      "d", // 상담중 (입력 순서 유지 · 안정)
      "a", // 진행중
      "c", // 완료
      "e", // 미지정 → 맨 뒤
    ]);
  });
});

describe("countByStage", () => {
  it("단계별 개수를 집계한다(미지정 제외)", () => {
    expect(countByStage(items, COL)).toEqual({
      진행중: 1,
      상담중: 2,
      완료: 1,
    });
  });
});

describe("groupByStage", () => {
  it("단계 순서대로 그룹화하고 빈 단계도 포함", () => {
    const groups = groupByStage(items, COL, ORDER);
    expect(groups.map((g) => g.stage)).toEqual([
      "상담중",
      "계약대기",
      "진행중",
      "완료",
    ]);
    expect(groups.map((g) => g.items.length)).toEqual([2, 0, 1, 1]);
  });
});
