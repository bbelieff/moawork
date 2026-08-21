import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCombobox, matchProductLabel } from "./ProductCombobox";

describe("BBE-261 진행상품 콤보박스", () => {
  const labels = ["일반운전자금", "혁신성장_일반형", "소공인특화자금"];
  it("공백·기호와 가까운 오타를 정본 라벨로 매칭한다", () => {
    expect(matchProductLabel("혁신성장 일반형", labels)).toBe("혁신성장_일반형");
    expect(matchProductLabel("일반운전금", labels)).toBe("일반운전자금");
  });
  it("목록에 없는 값은 새 상품 이름으로 보존한다", () => expect(matchProductLabel("새 지원 상품", labels)).toBe("새 지원 상품"));
  it("드롭다운과 직접입력 소비 UI를 함께 렌더한다", () => {
    const html = renderToStaticMarkup(<ProductCombobox labels={labels} onSelect={vi.fn()} />);
    expect(html).toContain("<datalist");
    expect(html).toContain("선택하거나 직접 입력");
    expect(html).toContain("일반운전자금");
  });
});
