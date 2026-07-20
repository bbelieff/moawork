import { describe, it, expect } from "vitest";
import {
  getBoardColumns,
  getWorkBoardColumns,
  listBoards,
  pipelineStageNames,
  WORK_BOARD,
} from "./board";
import { fullPresets } from "./fixture";

describe("getBoardColumns — 원본 컬럼을 BoardColumn 으로", () => {
  const cols = getBoardColumns(fullPresets(), "업무관리");

  it("컬럼 순서와 index 를 보존", () => {
    expect(cols[0]).toMatchObject({ index: 0, label: "이름", type: "title" });
    expect(cols.map((c) => c.index)).toEqual(cols.map((_, i) => i));
  });

  it("전역 프리셋 참조(ref)를 optionRef 로 해석", () => {
    const region = cols.find((c) => c.label === "지역");
    expect(region?.optionRef).toBe("region");
    const product = cols.find((c) => c.label === "진행 상품");
    expect(product?.optionRef).toBe("product");
  });

  it("인라인 옵션을 inlineOptions 로 해석", () => {
    const agency = cols.find((c) => c.label === "진행 기관");
    expect(agency?.inlineOptions).toHaveLength(18);
  });

  it("formula 컬럼의 원본 수식을 보존", () => {
    const fee = cols.find((c) => c.label === "수수료(원)");
    expect(fee?.type).toBe("formula");
    expect(fee?.formula).toBe("{실행액}×{수수료%}");
  });

  it("비공개(redacted) 컬럼을 표시", () => {
    const redacted = getBoardColumns(fullPresets(), "공지사항").find(
      (c) => c.label === "점수 미달인 업체",
    );
    expect(redacted?.redacted).toBe(true);
  });

  it("중첩 보드(회계_연도차이)는 연도로 접근", () => {
    const y25 = getBoardColumns(fullPresets(), "회계_연도차이", "25년");
    expect(y25.find((c) => c.label === "품목")?.inlineOptions).toHaveLength(28);
    // 연도 미지정 시 빈 배열
    expect(getBoardColumns(fullPresets(), "회계_연도차이")).toEqual([]);
  });
});

describe("getWorkBoardColumns / 메타", () => {
  it("업무관리 보드를 기본 대상으로", () => {
    expect(WORK_BOARD).toBe("업무관리");
    expect(getWorkBoardColumns(fullPresets()).length).toBeGreaterThan(0);
  });

  it("보드 목록과 파이프라인 단계 이름", () => {
    expect(listBoards(fullPresets())).toContain("업무관리");
    expect(pipelineStageNames(fullPresets())).toEqual([
      "신규고객",
      "컨텍관리",
      "계약",
      "업무관리",
      "수납·정산",
      "사후관리",
    ]);
  });
});
