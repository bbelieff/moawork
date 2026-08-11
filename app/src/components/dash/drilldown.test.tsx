import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardEvidenceList, DashboardStateNotice, DashboardUnavailableNotice } from "./drilldown";

describe("dashboard drilldown states", () => {
  it("distinguishes zero, delayed, and partial failure states", () => {
    const empty = renderToStaticMarkup(
      <DashboardEvidenceList deals={[]} pipelines={[]} />,
    );
    const delayed = renderToStaticMarkup(
      <DashboardStateNotice result={null} overdueCount={2} />,
    );
    const partial = renderToStaticMarkup(
      <DashboardStateNotice result="partial" overdueCount={0} />,
    );

    expect(empty).toContain("업무가 0건이에요");
    expect(delayed).toContain("기한이 지난 업무가 2건 있어요");
    expect(partial).toContain("업무는 저장됐지만 활동 기록 일부를 남기지 못했어요");
  });

  it("shows a distinct unavailable state", () => {
    const html = renderToStaticMarkup(<DashboardUnavailableNotice />);
    expect(html).toContain("업무 현황을 불러오지 못했어요");
    expect(html).toContain("새로고침해 주세요");
  });
});
