import { describe, it, expect } from "vitest";
import { getBundledPresets } from "./bundled";
import { loadOptionCategories, validatePresetCounts } from "./presets";
import { getWorkBoardColumns, pipelineStageNames } from "./board";

// 번들 스냅샷(app/src/data/policyfund-presets.json)이 002_seed 실측 스펙과
// 일치하는지 가드한다. 시드 변경 후 스냅샷 재생성 누락 시 여기서 실패.
describe("번들 프리셋 스냅샷 = 002_seed 정합 가드", () => {
  const presets = getBundledPresets();

  it("7개 선택지 카테고리 개수가 실측 스펙과 일치", () => {
    const cats = loadOptionCategories(presets);
    expect(validatePresetCounts(cats)).toEqual([]);
  });

  it("업무관리 보드 = 31컬럼", () => {
    expect(getWorkBoardColumns(presets)).toHaveLength(31);
  });

  it("파이프라인 6단계", () => {
    expect(pipelineStageNames(presets)).toEqual([
      "신규고객",
      "컨텍관리",
      "계약",
      "업무관리",
      "수납·정산",
      "사후관리",
    ]);
  });

  it("정산 수식 정의를 담는다", () => {
    expect(presets.formulas?.fee_amount).toBe("round(실행액 * 수수료% / 100)");
    expect(presets.formulas?.total_revenue).toBe("계약금 + 수수료(원)");
  });
});
