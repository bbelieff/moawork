/**
 * #839 (대표 지시 2026-10-06) — 보드 위계·진행현황 칩·같은 회사 표시의 마크업 계약.
 * 실제 색·그림자는 globals.css(무계층 규칙)가 그리고, 여기서는 그 규칙이 붙을 자리
 * (data-board-row, data-right-pinned, 칩 한 개)와 표시 전용 칩이 데이터를 바꾸지 않는지를 고정한다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { WORKFLOW_PROGRESS_KEY } from "@/lib/workflow/progress";

function progressColumn(): BoardColumn {
  return {
    id: "col-progress:workflow-progress",
    org_id: "org",
    board_id: "b1",
    key: WORKFLOW_PROGRESS_KEY,
    label: "진행현황",
    type: "status",
    source: "act",
    rightPinned: true,
    options_jsonb: { options: [
      { id: "심사 중", label: "심사 중", color: "#9cd326" },
      { id: "📂소진공 혁신성장 대기", label: "📂소진공 혁신성장 대기", color: "#ffcb00" },
    ] },
    sort_order: 1,
    width: 180,
    move_rule_jsonb: null,
  };
}

function textColumn(): BoardColumn {
  return {
    id: "col-rep", org_id: "org", board_id: "b1", key: "rep", label: "대표자", type: "text", source: "in",
    rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
  };
}

function row(id: string, title: string, stage: string): ItemWithValues {
  return {
    id, org_id: "org", board_id: "b1", group_id: "g-review", title, assigned_to: null, deal_id: null,
    sort_order: 0, created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z",
    values: { progress_status: stage, [WORKFLOW_PROGRESS_KEY]: stage },
  };
}

function render(rows: ItemWithValues[], sameTitleCounts?: ReadonlyMap<string, number>) {
  return renderToStaticMarkup(
    <GroupTable
      boardId="b1"
      groupId="g-review"
      columns={[textColumn(), progressColumn()]}
      rows={rows}
      readOnly={false}
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
      workflowProgressKind="work"
      workflowMoveTargets={new Map([["심사 중", { groupId: "g-review", groupName: "🔂 심사 중" }]])}
      sameTitleCounts={sameTitleCounts}
    />,
  );
}

describe("GroupTable 보드 위계 (#839)", () => {
  it("진행현황 칸은 칩 하나 — select·검색칸이 칸에 없고 표시만 이모지를 걷는다", () => {
    const html = render([row("r1", "가나상사", "📂소진공 혁신성장 대기")]);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="진행현황"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain('aria-label="진행 단계 검색"');
    expect(html).toContain('data-stage-value="📂소진공 혁신성장 대기"');
    expect(html).toContain(">소진공 혁신성장 대기<");
    expect(html).toContain('name="value" value="📂소진공 혁신성장 대기"');
    // 고정 열 선은 CSS(안쪽 그림자)가 그린다 — 칸과 함께 움직이지 않는 collapse 테두리를 쓰지 않는다.
    expect(html).toContain('data-right-pinned="true"');
    expect(html).not.toContain("border-l-mw-primary");
  });

  it("행에는 위계 규칙이 붙을 표식을 달고, 제목은 13px/600 이다(500 금지)", () => {
    const html = render([row("r1", "가나상사", "심사 중")]);
    expect(html).toContain('<tr data-board-row=""');
    expect(html).toContain("text-[length:var(--fs-13)] font-semibold");
    expect(html).not.toContain("font-medium");
    expect(html).toContain("bg-mw-board-head");
  });

  it("같은 제목(회사명)이 2건 이상인 행에만 «같은 회사 N건» 을 단다 — 제목은 그대로", () => {
    const rows = [row("r1", "QA합성회사", "심사 중"), row("r2", "QA합성회사", "심사 중"), row("r3", "단독회사", "심사 중")];
    const html = render(rows, new Map([["QA합성회사", 2], ["단독회사", 1]]));
    expect(html.match(/같은 회사 2건/g)).toHaveLength(2);
    expect(html).not.toContain("같은 회사 1건");
    expect(html.match(/name="title" value="QA합성회사"/g)).toHaveLength(2);
    // 다른 보드(카운트 없음)에는 달지 않는다.
    expect(render(rows)).not.toContain("같은 회사");
  });
});
