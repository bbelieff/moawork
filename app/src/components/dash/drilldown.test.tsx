import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Deal } from "@/lib/types";
import {
  DashboardEvidenceList,
  DashboardStateNotice,
  DashboardUnavailableNotice,
  TodayTaskList,
  parseTaskRetryIntent,
} from "./drilldown";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const DEAL_ID_1 = "10000000-0000-4000-8000-000000000001";
const DEAL_ID_2 = "10000000-0000-4000-8000-000000000002";

function deal(id: string): Deal {
  return {
    id,
    org_id: "org-1",
    company_id: null,
    pipeline_id: "pipeline-1",
    stage_id: null,
    assigned_to: "user-1",
    title: `업무 ${id}`,
    amount: null,
    status_note: null,
    fee_terms: null,
    applied_on: null,
    custom: { due_date: "2026-08-31" },
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
}

describe("dashboard drilldown states", () => {
  it("distinguishes zero, delayed, and retryable unknown states", () => {
    const empty = renderToStaticMarkup(
      <DashboardEvidenceList deals={[]} pipelines={[]} />,
    );
    const delayed = renderToStaticMarkup(
      <DashboardStateNotice result={null} overdueCount={2} />,
    );
    const unknown = renderToStaticMarkup(
      <DashboardStateNotice result="retryable_unknown" overdueCount={0} />,
    );

    expect(empty).toContain("업무가 0건이에요");
    expect(delayed).toContain("기한이 지난 업무가 2건 있어요");
    expect(unknown).toContain("같은 작업을 다시 누르면 중복 없이 결과를 확인해요");
  });

  it("shows a distinct unavailable state", () => {
    const html = renderToStaticMarkup(<DashboardUnavailableNotice />);
    expect(html).toContain("업무 현황을 불러오지 못했어요");
    expect(html).toContain("새로고침해 주세요");
  });

  it("parses retry state only for an exact valid intent and clears it after terminal or success", () => {
    expect(parseTaskRetryIntent({
      result: "retryable_unknown",
      retryDealId: DEAL_ID_1,
      retryKind: "complete",
      retryRequestId: REQUEST_ID,
    })).toEqual({ dealId: DEAL_ID_1, kind: "complete", requestId: REQUEST_ID });
    expect(parseTaskRetryIntent({
      result: "completed",
      retryDealId: DEAL_ID_1,
      retryKind: "complete",
      retryRequestId: REQUEST_ID,
    })).toBeNull();
    expect(parseTaskRetryIntent({ result: "failed", retryRequestId: REQUEST_ID })).toBeNull();
    expect(parseTaskRetryIntent({
      result: "retryable_unknown",
      retryDealId: DEAL_ID_1,
      retryKind: "postpone",
      retryRequestId: REQUEST_ID,
    })).toBeNull();
    expect(parseTaskRetryIntent({
      result: "retryable_unknown",
      retryDealId: "not-a-uuid",
      retryKind: "complete",
      retryRequestId: REQUEST_ID,
    })).toBeNull();
    expect(parseTaskRetryIntent({
      result: "retryable_unknown",
      retryDealId: DEAL_ID_1,
      retryKind: "postpone",
      retryRequestId: REQUEST_ID,
      retryDueDate: "2026-02-30",
    })).toBeNull();
  });

  it("re-renders the exact retry identity on only the matching row and form", () => {
    const html = renderToStaticMarkup(
      <TodayTaskList
        deals={[deal(DEAL_ID_1), deal(DEAL_ID_2)]}
        assignees={[]}
        canChangeAssignee={false}
        returnTo="/dash/tasks"
        today="2026-08-31"
        retryIntent={{ dealId: DEAL_ID_1, kind: "complete", requestId: REQUEST_ID }}
      />,
    );
    expect(html.match(new RegExp(REQUEST_ID, "g"))).toHaveLength(1);
    expect(html).toContain(`name="dealId" value="${DEAL_ID_2}"`);
  });

  it("keeps the postponed snapshot so the action can distinguish a changed date", () => {
    const html = renderToStaticMarkup(
      <TodayTaskList
        deals={[deal(DEAL_ID_1)]}
        assignees={[]}
        canChangeAssignee={false}
        returnTo="/dash/tasks"
        today="2026-08-31"
        retryIntent={{ dealId: DEAL_ID_1, kind: "postpone", dueDate: "2026-09-01", requestId: REQUEST_ID }}
      />,
    );
    expect(html).toContain(`name="requestId" value="${REQUEST_ID}"`);
    expect(html).toContain('name="retryDueDate" value="2026-09-01"');
    expect(html).toContain('min="2026-08-31"');
    expect(html).toContain('name="dueDate" value="2026-09-01"');
  });
});
