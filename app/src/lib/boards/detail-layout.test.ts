import { describe, expect, it } from "vitest";
import {
  detailKeyFromLabel,
  moveDetailEntry,
  normalizeDetailLayout,
  resolveDetailLayout,
  unplacedDetailKeys,
} from "./detail-layout";

describe("BBE-107 상세 필드 레이아웃", () => {
  const board = [
    { key: "company", source: "column" as const },
    { key: "memo", source: "detail" as const, label: "상세 메모", type: "text" as const },
  ];

  it("오버라이드하지 않은 그룹은 보드 기본을 계속 상속하고 빈 배열은 명시적 오버라이드다", () => {
    expect(resolveDetailLayout(board, null)).toEqual({ entries: board, inherited: true });
    expect(resolveDetailLayout(board, undefined)).toEqual({ entries: board, inherited: true });
    expect(resolveDetailLayout(board, [])).toEqual({ entries: [], inherited: false });
  });

  it("그룹 A 순서를 바꿔도 보드 기본과 그룹 B의 상속 결과를 바꾸지 않는다", () => {
    const groupA = moveDetailEntry(board, "memo", -1);
    expect(groupA.map((entry) => entry.key)).toEqual(["memo", "company"]);
    expect(resolveDetailLayout(board, null).entries.map((entry) => entry.key)).toEqual(["company", "memo"]);
    expect(board.map((entry) => entry.key)).toEqual(["company", "memo"]);
  });

  it("레이아웃에서 빠진 값은 삭제하지 않고 접힘 영역의 키로 회수한다", () => {
    const values = { company: "모아", memo: "보존", legacy: "옛 값", empty: "" };
    expect(unplacedDetailKeys(values, [{ key: "company", source: "column" }])).toEqual(["legacy", "memo"]);
    expect(values).toEqual({ company: "모아", memo: "보존", legacy: "옛 값", empty: "" });
  });

  it("legacy/중복/잘못된 엔트리는 결정적으로 정규화한다", () => {
    expect(normalizeDetailLayout([
      { key: "memo", source: "detail", label: " 메모 ", type: "text" },
      { key: "memo", source: "column" },
      { key: "bad key", source: "column" },
      null,
    ])).toEqual([{ key: "memo", source: "detail", label: "메모", type: "text" }]);
    expect(detailKeyFromLabel("상세 메모")).toBe("detail_상세_메모");
  });
});
