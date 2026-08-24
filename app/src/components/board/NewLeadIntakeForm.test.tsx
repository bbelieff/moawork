import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/new-lead-actions", () => ({ createNewLeadAction: vi.fn() }));
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";

describe("Issue #542 new lead quick create", () => {
  it("필수 두 값과 선택 연락처·담당자만 먼저 받는다", () => {
    const html = renderToStaticMarkup(
      <NewLeadIntakeForm
        boardId="board-a"
        groupId="group-a"
        members={[{ id: "user-a", label: "김담당" }]}
        currentUserId="user-a"
      />,
    );
    expect(html).toContain("업체명");
    expect(html).toContain("사업자 구분");
    expect(html).toContain('name="business_registration_type"');
    expect(html).toContain("연락처");
    expect(html).toContain("담당자");
    expect(html).toContain("먼저 등록한 뒤 상세 화면에서 대표자, 이메일, 지역, 협업자와 나머지 정보를 보완할 수 있어요.");
    expect(html).not.toContain("매출 구간");
    expect(html).not.toContain("상세 주소");
    expect(html).not.toContain('name="collaborator_ids"');
    expect(html).toMatch(/<summary[^>]*min-h-11/);
    expect(html).toMatch(/<select[^>]*name="assigned_to"[^>]*h-11/);
  });
});
