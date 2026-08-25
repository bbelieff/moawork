import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/new-lead-actions", () => ({ createNewLeadAction: vi.fn() }));
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";

describe("Issue #542 new lead quick create", () => {
  it("회사명·사업자 구분을 필수로 받고 보드의 회사 정보를 한 번에 받는다", () => {
    const html = renderToStaticMarkup(
      <NewLeadIntakeForm
        boardId="board-a"
        groupId="group-a"
        members={[{ id: "user-a", label: "김담당" }]}
        currentUserId="user-a"
      />,
    );
    expect(html).toContain("회사명");
    expect(html).toContain("사업자 구분");
    expect(html).toContain('name="business_registration_type"');
    expect(html).toContain("연락처");
    expect(html).toContain("담당자");
    expect(html).toContain("매출 구간");
    expect(html).toContain("상세 주소");
    expect(html).toContain("광고 명");
    expect(html).toContain('name="collaborator_ids"');
    expect(html).toMatch(/<summary[^>]*min-h-11/);
    expect(html).toContain('type="radio" name="assigned_to"');
  });
});
