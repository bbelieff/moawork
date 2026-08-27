import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "@/lib/boards/structured-field";
import { OtherInfoCell } from "./OtherInfoCell";

describe("Issue #601 other-info collapsed cell", () => {
  it("renders an exact 0건 summary for an empty structured value", () => {
    const html = renderToStaticMarkup(<OtherInfoCell value={emptyOtherInfoValue()} readOnly />);

    expect(html).toContain("0건");
    expect(html).not.toContain("<button");
  });

  it("counts only checked entries and exposes their names", () => {
    let value = updateOtherInfoEntry(emptyOtherInfoValue(), "closedHistory", { checked: true, text: "2024년" });
    value = updateOtherInfoEntry(value, "export", { checked: true, text: "일본" });
    value = updateOtherInfoEntry(value, "certifications", { checked: false, text: "보존되는 메모" });
    const html = renderToStaticMarkup(<OtherInfoCell value={value} onOpen={vi.fn()} />);

    expect(html).toContain("2건");
    expect(html).toContain("폐업이력 · 수출여부");
    expect(html).not.toContain("보유인증");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("projects legacy values without mutating them", () => {
    const html = renderToStaticMarkup(
      <OtherInfoCell value={null} legacy={{ closed_business: "영업 중", export_status: "수출 중" }} readOnly />,
    );

    expect(html).toContain("1건");
    expect(html).toContain("수출여부");
  });

  it("announces an error without changing the summary", () => {
    const html = renderToStaticMarkup(
      <OtherInfoCell value={emptyOtherInfoValue()} error="저장 실패" onOpen={vi.fn()} />,
    );

    expect(html).toContain('data-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("저장 실패");
    expect(html).toContain("0건");
  });
});
