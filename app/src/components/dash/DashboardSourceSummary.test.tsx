import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardSourceSummary } from "./DashboardSourceSummary";

describe("DashboardSourceSummary", () => {
  it("renders actual board, item, and ledger values from the read model", () => {
    const html = renderToStaticMarkup(
      <DashboardSourceSummary
        boards={{ status: "ready", data: { boardCount: 2, itemCount: 3 } }}
        ledger={{ status: "ready", data: { entryCount: 4, expectedFeeTotal: 50000 } }}
      />,
    );
    expect(html).toContain("보드");
    expect(html).toContain("2");
    expect(html).toContain("보드 아이템");
    expect(html).toContain("3");
    expect(html).toContain("원장 항목");
    expect(html).toContain("4");
    expect(html).toContain("50,000원");
  });

  it("renders unavailable instead of fake zeroes", () => {
    const html = renderToStaticMarkup(
      <DashboardSourceSummary
        boards={{ status: "unavailable", operation: "boards" }}
        ledger={{ status: "unavailable", operation: "ledger" }}
      />,
    );
    expect(html).toContain("보드 데이터를 불러오지 못함");
    expect(html).toContain("원장 데이터를 불러오지 못함");
    expect(html).not.toContain(">0<");
  });
});
