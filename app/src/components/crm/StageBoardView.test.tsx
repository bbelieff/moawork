import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Deal, Stage } from "@/lib/types";
import type { StageBoardData } from "@/lib/crm/boardData";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("./ContactPipelineAction", () => ({
  ContactPipelineAction: ({ kind }: { kind: string }) => <button data-transition={kind}>다음 단계</button>,
}));

import { StageBoardView } from "./StageBoardView";

const deal: Deal = {
  id: "00000000-0000-4000-8000-000000000020",
  org_id: "00000000-0000-4000-8000-000000000001",
  company_id: null,
  pipeline_id: "00000000-0000-4000-8000-000000000010",
  stage_id: "stage",
  assigned_to: null,
  title: "샘플 업체",
  amount: null,
  status_note: null,
  fee_terms: null,
  applied_on: null,
  custom: {},
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

function data(kind: Stage["kind"]): StageBoardData {
  return {
    board: { slug: kind, title: "샘플 보드", kind, description: "설명" },
    columns: [{
      stage: { id: "stage", pipeline_id: "pipeline", name: "단계", sort_order: 1, kind },
      deals: [deal],
    }],
    total: 1,
    companyById: new Map(),
    sourceKind: "supabase",
  };
}

describe("StageBoardView next-stage action", () => {
  it("신규리드 카드의 가장 아래·오른쪽에 단일 컨택 이동을 둔다", () => {
    const html = renderToStaticMarkup(<StageBoardView data={data("marketing")} pipelineActionsEnabled />);
    expect(html).toContain('data-transition="lead_to_contact"');
    expect(html.indexOf("샘플 업체")).toBeLessThan(html.indexOf("data-transition"));
  });

  it("컨택 카드에는 업무 이동, 업무 카드에는 추정 액션 0개다", () => {
    const contact = renderToStaticMarkup(<StageBoardView data={data("meeting")} pipelineActionsEnabled />);
    const work = renderToStaticMarkup(<StageBoardView data={data("work")} />);
    expect(contact).toContain('data-transition="contact_to_work"');
    expect(work).not.toContain("data-transition");
  });

  it("읽기 전용 보드는 서버 액션을 노출하지 않는다", () => {
    const html = renderToStaticMarkup(<StageBoardView data={data("marketing")} linksEnabled={false} pipelineActionsEnabled />);
    expect(html).not.toContain("data-transition");
  });

  it("원자 요청 저장소가 연결되기 전 기본 rollout은 닫혀 있다", () => {
    const html = renderToStaticMarkup(<StageBoardView data={data("marketing")} />);
    expect(html).toContain('data-transition="lead_to_contact"');
  });
});
