import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { completionOf, type ChecklistItem } from "@/lib/policyfund/checklist";
import { ChecklistCompletionCell } from "./ChecklistCompletionCell";

function item(id: string, checked: boolean): ChecklistItem {
  return { id, label: id, order: 0, checked };
}

describe("ChecklistCompletionCell", () => {
  it("항목이 없으면 — 로 표시한다(0% 와 구분)", () => {
    const html = renderToStaticMarkup(<ChecklistCompletionCell items={[]} />);
    expect(html).toContain("—");
    expect(html).not.toContain("0%");
  });

  it("완료율은 lib/policyfund/checklist 의 completionOf 와 동일한 값을 그린다", () => {
    const items = [item("a", true), item("b", false), item("c", false)];
    const expected = completionOf(items);
    const html = renderToStaticMarkup(<ChecklistCompletionCell items={items} />);
    expect(html).toContain(`${expected.checked}/${expected.total}`);
    expect(html).toContain(`${expected.percent}%`);
  });

  it("compact 모드는 보이는 텍스트에 퍼센트만 남긴다(1/2 는 title 로만)", () => {
    const items = [item("a", true), item("b", false)];
    const html = renderToStaticMarkup(<ChecklistCompletionCell items={items} compact />);
    expect(html).toContain("50%");
    expect(html).toContain('title="1/2 완료"'); // 접근성 상 상세 수치는 title 로 유지
    // title 속성을 제거한 나머지(=화면에 보이는 텍스트)엔 분수가 없어야 한다.
    const withoutTitle = html.replace(/title="[^"]*"/, "");
    expect(withoutTitle).not.toMatch(/\d\/\d/);
  });

  it("100% 완료는 success 색을 쓴다", () => {
    const items = [item("a", true)];
    const html = renderToStaticMarkup(<ChecklistCompletionCell items={items} />);
    expect(html).toContain("--mw-success");
  });
});
