import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/board-new",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BoardWorkspace } from "./BoardWorkspace";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";

const column = (key: string, label: string, sort_order: number) => ({
  id: `col-${key}`,
  org_id: "org-a",
  board_id: "board-new",
  key,
  label,
  type: "text",
  source: "in",
  rightPinned: false,
  options_jsonb: null,
  sort_order,
  width: null,
});

describe("Issue #542 canonical new-lead projection", () => {
  it("같은 레코드를 유지하면서 담당자·협업자를 표에 두고 컨택 이동은 오른쪽 고정 관문으로 복구한다", () => {
    const html = renderToStaticMarkup(
      <BoardWorkspace
        board={{ id: "board-new", org_id: "org-a", name: "신규리드", description: null, icon: null, source: NEW_LEAD_TAB_SOURCE, is_system: false, sort_order: 0 } as never}
        columns={[
          column("company", "회사명", 0),
          column("consult_status", "상담상황", 1),
          column("owner", "담당자", 2),
          column("collaborators", "협업자", 3),
          { ...column("delay_notice", "상담지연 메시지", 4), source: "msg", is_readonly: true },
          { ...column("absence_notice", "부재 안내", 5), source: "msg", is_readonly: true },
          { ...column("confirm2_notice", "2차 확정 안내", 6), source: "msg", is_readonly: true },
          { ...column("contact_move", "컨택 이동", 7), type: "status", rightPinned: true, options_jsonb: { options: [{ id: "컨택 대기", label: "컨택 대기", color: "#999" }, { id: "컨택 이동", label: "컨택 이동", color: "#00c875" }] } },
        ] as never}
        groups={[{ id: "group-a", org_id: "org-a", board_id: "board-new", name: "새 리드", color: null, sort_order: 0 }] as never}
        rows={[{ id: "item-a", org_id: "org-a", board_id: "board-new", group_id: "group-a", title: "대한정밀", assigned_to: "user-a", deal_id: "deal-a", sort_order: 0, created_at: "2026-08-25T00:00:00Z", updated_at: "2026-08-25T00:00:00Z", values: { company: "대한정밀", consult_status: "상담 대기", collaborators: ["user-b"], contact_move: "대기" } }] as never}
        columnOrder={{}}
        cellFlash={null}
        assigneeLabels={{ "user-a": "김담당" }}
        canEditItems
      />,
    );
    expect(html).toContain("회사명");
    expect(html).toContain("상담상황");
    expect(html).toContain("담당자");
    expect(html).toContain("대한정밀 상세 열기");
    expect(html).toContain(">출동<");
    expect(html).toContain(">메시지 보내기<");
    expect(html).not.toContain(">상담지연 메시지<");
    expect(html).not.toContain(">부재 안내<");
    expect(html).toContain(">컨택 이동<");
    expect(html).toContain('data-right-pinned="true"');
    expect(html).not.toContain("원장 열기");
  });
});
